"""Assistant (agent) and skills API."""

import asyncio
from typing import List, Literal, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from api.models import SourceCreate
from api.routers.sources import create_source
from open_notebook.agent import runner, skills
from open_notebook.database.repository import repo_query
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import NotFoundError, UnsupportedTypeException

router = APIRouter()


class AgentMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class Attachment(BaseModel):
    source_id: str
    filename: str


class AgentRunRequest(BaseModel):
    messages: List[AgentMessage]
    notebook_id: Optional[str] = None
    model_id: Optional[str] = None
    thinking: Optional[Literal["off", "low", "medium", "high"]] = None
    skill_ids: Optional[List[str]] = None
    attachments: List[Attachment] = []


@router.post("/agent/runs")
async def create_run(body: AgentRunRequest, request: Request):
    if not body.messages or body.messages[-1].role != "user":
        raise HTTPException(
            status_code=400, detail="The last message must come from the user"
        )
    run = runner.start_run(
        [m.model_dump() for m in body.messages],
        body.notebook_id,
        request.headers.get("Authorization"),
        model_id=body.model_id,
        thinking=body.thinking,
        skill_ids=body.skill_ids,
        attachments=[a.model_dump() for a in body.attachments],
    )
    return {"id": run.id, "status": run.status}


@router.get("/agent/runs/{run_id}")
async def get_run(run_id: str, after: int = -1):
    run = runner.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run.snapshot(after)


@router.post("/agent/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    run = runner.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.task and not run.task.done():
        run.task.cancel()
    return {"id": run_id, "status": "cancelling"}


WORKSPACE_NOTEBOOK = "Thoth workspace"
_workspace_lock = asyncio.Lock()


async def _attachment_notebook(notebook_id: Optional[str]) -> str:
    if notebook_id:
        try:
            await Notebook.get(notebook_id)
        except NotFoundError:
            raise HTTPException(status_code=404, detail="Notebook not found") from None
        return notebook_id

    async with _workspace_lock:
        existing = await repo_query(
            "SELECT id FROM notebook WHERE name = $name LIMIT 1",
            {"name": WORKSPACE_NOTEBOOK},
        )
        if existing:
            return str(existing[0]["id"])
        notebook = Notebook(
            name=WORKSPACE_NOTEBOOK,
            description="Files attached in conversations with Thoth",
        )
        await notebook.save()
        return str(notebook.id)


@router.post("/agent/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    notebook_id: Optional[str] = Form(None),
):
    """Ingest a file attached in the Thoth composer as a notebook source.

    Uses the regular source pipeline (text extraction, embeddings), so the file
    is searchable and readable by the agent. Without a current notebook the file
    goes to the "Thoth workspace" notebook.
    """
    nid = await _attachment_notebook(notebook_id)
    try:
        src = await create_source(
            (
                SourceCreate(
                    type="upload",
                    notebooks=[nid],
                    embed=True,
                    async_processing=True,
                ),
                file,
            )
        )
    except UnsupportedTypeException:
        raise HTTPException(
            status_code=415,
            detail="This file type cannot be extracted by the current local processors. Configure a local extractor or choose a supported document.",
        ) from None
    return {
        "source_id": src.id,
        "filename": file.filename,
        "notebook_id": nid,
        "status": src.status,
        "size": file.size,
    }


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    instructions: str = Field(min_length=1, max_length=8000)
    description: str = ""
    source_url: str = ""


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    instructions: Optional[str] = None
    description: Optional[str] = None
    source_url: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/agent/skills", response_model=List[skills.Skill])
async def list_skills():
    return skills.list_skills()


@router.post("/agent/skills", response_model=skills.Skill)
async def create_skill(body: SkillCreate):
    return skills.create_skill(
        body.name, body.instructions, body.description, body.source_url
    )


@router.patch("/agent/skills/{skill_id}", response_model=skills.Skill)
async def update_skill(skill_id: str, body: SkillUpdate):
    s = skills.update_skill(skill_id, **body.model_dump())
    if not s:
        raise HTTPException(status_code=404, detail="Skill not found")
    return s


@router.delete("/agent/skills/{skill_id}")
async def delete_skill(skill_id: str):
    if not skills.delete_skill(skill_id):
        raise HTTPException(
            status_code=400,
            detail="Built-in skills cannot be deleted; disable them instead",
        )
    return {"deleted": skill_id}
