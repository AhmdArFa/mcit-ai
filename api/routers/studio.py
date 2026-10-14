"""MCIT AI Studio API: generate reports, decks, infographics and summaries from a
notebook, store them in a file library, and download them in any format."""

import re
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from loguru import logger
from pydantic import BaseModel

from open_notebook.config import UPLOADS_FOLDER
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import OpenNotebookError
from open_notebook.exports import storage
from open_notebook.exports.content import (
    ExportKind,
    StudioDocument,
    StudioOptions,
    generate_document,
)
from open_notebook.exports.renderers import RENDERERS
from open_notebook.exports.themes import THEMES

router = APIRouter()

ExportFormat = Literal[
    "pdf", "docx", "pptx", "svg", "xlsx", "html", "md", "txt", "json"
]

DEFAULT_FORMAT = {
    "report": "pdf",
    "presentation": "pptx",
    "infographic": "svg",
    "summary": "docx",
    "spreadsheet": "xlsx",
}


class StudioGenerateRequest(BaseModel):
    notebook_id: str
    kind: ExportKind = "report"
    options: StudioOptions = StudioOptions()
    instructions: Optional[str] = None  # kept for older clients; merged into options
    model_id: Optional[str] = None


class StudioRenderRequest(BaseModel):
    document: StudioDocument
    format: ExportFormat = "pdf"


class StudioSaveRequest(BaseModel):
    document: StudioDocument
    formats: List[ExportFormat]
    notebook_id: Optional[str] = None


@router.get("/studio/formats")
async def studio_formats():
    return {
        "kinds": list(DEFAULT_FORMAT.keys()),
        "formats": list(RENDERERS.keys()),
        "default_format": DEFAULT_FORMAT,
        "themes": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "colors": [t.dark, t.primary, t.accent, t.soft],
            }
            for t in THEMES.values()
        ],
        "lengths": ["short", "medium", "long"],
        "tones": ["formal", "neutral", "persuasive", "plain"],
        "slide_count": {"min": 4, "max": 20, "default": 8},
    }


async def run_generation(req: StudioGenerateRequest) -> StudioDocument:
    notebook = await Notebook.get(req.notebook_id)
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")
    opts = req.options
    if req.instructions and not opts.instructions:
        opts = opts.model_copy(update={"instructions": req.instructions})
    return await generate_document(notebook, req.kind, opts, req.model_id)


@router.post("/studio/generate", response_model=StudioDocument)
async def studio_generate(request: StudioGenerateRequest):
    try:
        return await run_generation(request)
    except (OpenNotebookError, HTTPException):
        raise
    except Exception as e:
        logger.error("Studio generation failed: {}", type(e).__name__)
        raise HTTPException(status_code=500, detail="Generation failed") from None


@router.post("/studio/render")
async def studio_render(request: StudioRenderRequest):
    fn, media_type, ext = RENDERERS[request.format]
    try:
        data = fn(request.document)
    except Exception as e:
        logger.error("Studio rendering failed: {}", type(e).__name__)
        raise HTTPException(status_code=500, detail="Rendering failed") from None
    slug = (
        re.sub(r"[^A-Za-z0-9]+", "-", request.document.title).strip("-")[:60]
        or "mcit-lm"
    )
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{slug}.{ext}"'},
    )


@router.post("/studio/save", response_model=List[storage.StudioFile])
async def studio_save(request: StudioSaveRequest):
    """Render a document into one or more formats and keep them in the file library."""
    doc_id = storage.save_document(request.document)
    try:
        return [
            storage.store_file(request.document, f, request.notebook_id, doc_id)
            for f in request.formats
        ]
    except Exception as e:
        logger.error("Studio saving failed: {}", type(e).__name__)
        raise HTTPException(status_code=500, detail="Rendering failed") from None


@router.get("/studio/files", response_model=List[storage.StudioFile])
async def studio_files(notebook_id: Optional[str] = None):
    return storage.list_files(notebook_id)


@router.get("/studio/files/{file_id}/download")
async def studio_download(file_id: str, inline: bool = False):
    item = storage.get_file(file_id)
    if not item or not item.path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    media = RENDERERS.get(item.format, (None, "application/octet-stream", ""))[1]
    return FileResponse(
        item.path,
        media_type=media,
        filename=item.filename,
        content_disposition_type="inline" if inline else "attachment",
    )


@router.get("/studio/files/{file_id}/document", response_model=StudioDocument)
async def studio_file_document(file_id: str):
    item = storage.get_file(file_id)
    doc = storage.load_document(item.document_id) if item and item.document_id else None
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/studio/files/{file_id}")
async def studio_delete(file_id: str):
    if not storage.delete_file(file_id):
        raise HTTPException(status_code=404, detail="File not found")
    return {"deleted": file_id}


class StudioJobRequest(BaseModel):
    notebook_id: str
    kind: ExportKind = "report"
    formats: List[ExportFormat] = []
    options: StudioOptions = StudioOptions()
    model_id: Optional[str] = None


@router.post("/studio/jobs")
async def studio_job(body: StudioJobRequest):
    """Run the full workflow in the background; poll /api/agent/runs/{id} for steps."""
    from open_notebook.agent import engine
    from open_notebook.exports.produce import produce

    async def work(run):
        result = await produce(
            run,
            body.notebook_id,
            body.kind,
            list(body.formats),
            body.options,
            body.model_id,
        )
        issues = result["open_issues"]
        msg = f'Delivered {len(result["files"])} file(s) for "{result["title"]}".'
        if issues:
            msg += " Open audit issues: " + "; ".join(
                f"{k.upper()}: {', '.join(v)}" for k, v in issues.items()
            )
        else:
            msg += " Audit: 0 issues."
        run.emit("message", content=msg)

    run = engine.start("studio", work, feature="studio")
    return {"id": run.id, "status": run.status}


@router.get("/studio/templates")
async def studio_templates(kind: Optional[str] = None):
    from open_notebook.exports.templates import list_templates

    return list_templates(kind)


@router.get("/studio/assets/{asset_path:path}")
async def studio_asset(asset_path: str):
    root = Path(UPLOADS_FOLDER).resolve()
    target = (root / asset_path).resolve()
    if not str(target).startswith(str(root)) or not target.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")
    media_type = "image/png"
    suf = target.suffix.lower()
    if suf in (".jpg", ".jpeg"):
        media_type = "image/jpeg"
    elif suf == ".webp":
        media_type = "image/webp"
    elif suf == ".svg":
        media_type = "image/svg+xml"
    return FileResponse(target, media_type=media_type)
