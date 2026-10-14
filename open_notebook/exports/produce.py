"""One Studio production job: template -> skills -> design -> audit loop -> delivery."""

from typing import Any, Dict, List, Optional

from open_notebook.agent.engine import Run
from open_notebook.domain.notebook import Notebook
from open_notebook.exports import storage
from open_notebook.exports.content import StudioOptions, generate_document
from open_notebook.exports.templates import get_template
from open_notebook.exports.workflow import deliver

DEFAULT_FORMAT = {
    "report": "pdf",
    "presentation": "pptx",
    "infographic": "svg",
    "summary": "docx",
    "spreadsheet": "xlsx",
}


async def produce(
    run: Run,
    notebook_id: str,
    kind: str,
    formats: Optional[List[str]],
    options: StudioOptions,
    model_id: Optional[str] = None,
) -> Dict[str, Any]:
    from open_notebook.agent.skills import list_skills

    nb = await Notebook.get(notebook_id)
    fmts = list(dict.fromkeys(formats or [DEFAULT_FORMAT[kind]]))

    run.step("Selecting the template", "template")
    if options.template in ("", "default"):
        await run.progress(
            "Default selected: using the approved MCIT standard template"
        )
    else:
        tpl = get_template(options.template)
        if not tpl:
            raise ValueError(f"Template '{options.template}' is not in the library")
        await run.progress(
            f'Loaded reference design "{tpl["name"]}" from the template library'
        )
        await run.progress(f"Reference brief: {tpl['brief']}")
        if options.theme in ("", "graphite"):
            options.theme = tpl["theme"]
            await run.progress(f'Applied the reference theme "{tpl["theme"]}"')

    skills = [s for s in list_skills() if s.enabled]
    if skills:
        sid = run.step("Applying writing skills", "skill")
        for s in skills:
            run.emit("skill", name=s.name)
            await run.progress(f"Using skill: {s.name}")
        run.end_step(sid)

    run.step(f"Designing the {kind}", "think")
    doc = await generate_document(nb, kind, options, model_id, progress=run.progress)  # type: ignore[arg-type]
    doc_id = storage.save_document(doc)

    run.step("Auditing and delivering", "render")

    def store(working, ext, data):
        item = storage.store_bytes(working, ext, data, notebook_id, doc_id)
        meta = item.model_dump() | {"url": f"/api/studio/files/{item.id}/download"}
        run.emit("file", file=meta)
        return meta

    files, remaining = await deliver(doc, fmts, run.progress, store)
    for f in files:
        issues = remaining.get(f["format"])
        if issues:
            storage.update_meta(f["id"], audit_issues=[i["message"] for i in issues])
    return {
        "title": doc.title,
        "files": [{"id": f["id"], "filename": f["filename"]} for f in files],
        "open_issues": {k: [i["message"] for i in v] for k, v in remaining.items()},
    }
