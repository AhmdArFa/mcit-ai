"""Tools the MCIT AI assistant can call. They drive the whole app: notebooks,
sources, notes, search, Studio files and podcasts.

Most tools go through the app's own REST API (same contract the UI uses), so
ingestion, embeddings and podcasts run through the unchanged pipelines.
Studio generation is called in-process to avoid HTTP timeouts on long jobs.
"""

import asyncio
import json
import os
from typing import Any, Dict, List, Literal, Optional

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

INTERNAL_API = os.environ.get("AGENT_INTERNAL_API_URL", "http://127.0.0.1:5055").rstrip(
    "/"
)

TOOL_LABELS = {
    "list_notebooks": "Looking up notebooks",
    "create_notebook": "Creating a notebook",
    "list_sources": "Listing sources",
    "add_source": "Adding a source",
    "read_notebook": "Reading the notebook",
    "read_source": "Reading a file",
    "search_knowledge": "Searching sources",
    "create_note": "Saving a note",
    "generate_file": "Generating a document",
    "list_files": "Listing files",
    "process_sources": "Reprocessing sources",
    "generate_podcast": "Starting a podcast",
}


class ToolContext:
    def __init__(
        self,
        auth_header: Optional[str],
        run: Any,
        default_notebook: Optional[str],
    ):
        self.headers = {"Authorization": auth_header} if auth_header else {}
        self.run = run
        self.default_notebook = default_notebook

    async def api(self, method: str, path: str, **kw) -> Any:
        async with httpx.AsyncClient(
            base_url=INTERNAL_API, timeout=120, headers=self.headers
        ) as c:
            r = await c.request(method, f"/api{path}", **kw)
            if r.status_code >= 400:
                raise RuntimeError(f"{method} {path} failed ({r.status_code})")
            return r.json() if r.content else {}

    async def nb(self, notebook_id: Optional[str]) -> str:
        """Resolve a notebook reference the model gave us.

        Small models often pass a notebook *name* or a made-up id. Accept a real
        id, else match by name, else fall back to the current notebook (the one
        just created or selected in the UI).
        """
        ref = (notebook_id or "").strip()
        if ref:
            nbs = await self.api("GET", "/notebooks")
            ids = {n["id"]: n for n in nbs}
            cand = ref if ref.startswith("notebook:") else f"notebook:{ref}"
            if cand in ids:
                return cand
            bare = ref.removeprefix("notebook:").strip().lower()
            for n in nbs:
                if n["name"].strip().lower() == bare:
                    return n["id"]
            for n in nbs:
                if bare and (bare in n["name"].lower() or n["name"].lower() in bare):
                    return n["id"]
        if self.default_notebook:
            return self.default_notebook
        raise RuntimeError(
            "No notebook found. Call list_notebooks or create_notebook first."
        )


# ----------------------------------------------------------------------------- schemas


class NoArgs(BaseModel):
    pass


class CreateNotebookArgs(BaseModel):
    name: str = Field(description="Notebook name")
    description: str = Field("", description="One line description")


class NotebookArg(BaseModel):
    notebook_id: Optional[str] = Field(
        None,
        description="Notebook id like notebook:abc. Defaults to the current notebook.",
    )


class AddSourceArgs(BaseModel):
    notebook_id: Optional[str] = Field(
        None, description="Target notebook id. Defaults to the current notebook."
    )
    url: Optional[str] = Field(
        None, description="Web page, YouTube or file URL to ingest"
    )
    text: Optional[str] = Field(
        None, description="Raw text to add as a source (use when no URL)"
    )
    title: Optional[str] = Field(None, description="Optional title")


class SearchArgs(BaseModel):
    query: str = Field(description="What to look for")
    notebook_id: Optional[str] = Field(
        None, description="Limit to one notebook (optional)"
    )


class NoteArgs(BaseModel):
    notebook_id: Optional[str] = Field(
        None, description="Notebook id. Defaults to the current notebook."
    )
    title: str
    content: str = Field(description="Markdown content of the note")


class SourceArg(BaseModel):
    source_id: str = Field(description="Source id like source:abc")


class GenerateFileArgs(BaseModel):
    notebook_id: Optional[str] = Field(
        None,
        description="Notebook to use as material. Defaults to the current notebook.",
    )
    kind: Literal["report", "presentation", "infographic", "summary", "spreadsheet"] = (
        Field(description="What to produce")
    )
    template: Literal[
        "default",
        "executive-briefing",
        "data-story",
        "program-review",
        "public-brief",
        "ministry-official",
    ] = Field(
        "default",
        description="Template from the library; default is the house template",
    )
    formats: List[
        Literal["pdf", "docx", "pptx", "svg", "xlsx", "html", "md", "txt"]
    ] = Field(
        default_factory=list,
        description="File formats. Defaults: report=pdf, presentation=pptx, infographic=svg, summary=docx, spreadsheet=xlsx",
    )
    theme: Literal["graphite", "midnight", "teal", "terracotta", "forest", "mcit"] = (
        Field("graphite", description="Visual style")
    )
    slide_count: int = Field(
        8, ge=4, le=20, description="Total slides for presentations"
    )
    length: Literal["short", "medium", "long"] = "medium"
    audience: str = "senior leadership"
    tone: Literal["formal", "neutral", "persuasive", "plain"] = "formal"
    instructions: Optional[str] = Field(
        None, description="Extra focus or requirements from the user"
    )


class PodcastArgs(BaseModel):
    notebook_id: Optional[str] = Field(
        None, description="Notebook id. Defaults to the current notebook."
    )
    episode_name: str = Field(description="Episode title")
    episode_profile: Literal["solo_expert", "tech_discussion", "business_analysis"] = (
        "solo_expert"
    )


# ----------------------------------------------------------------------------- implementations


def build_tools(ctx: ToolContext) -> List[StructuredTool]:
    async def list_notebooks() -> str:
        nbs = await ctx.api("GET", "/notebooks")
        return json.dumps(
            [
                {
                    "id": n["id"],
                    "name": n["name"],
                    "sources": n.get("source_count"),
                    "notes": n.get("note_count"),
                }
                for n in nbs
            ][:50]
        )

    async def create_notebook(name: str, description: str = "") -> str:
        # Reuse a notebook with the same name instead of creating duplicates
        # (small models sometimes repeat a create call after an error).
        for n in await ctx.api("GET", "/notebooks"):
            if n["name"].strip().lower() == name.strip().lower():
                ctx.default_notebook = n["id"]
                return json.dumps(
                    {"id": n["id"], "name": n["name"], "note": "already existed"}
                )
        nb = await ctx.api(
            "POST", "/notebooks", json={"name": name, "description": description}
        )
        ctx.default_notebook = nb["id"]
        return json.dumps({"id": nb["id"], "name": nb["name"]})

    async def list_sources(notebook_id: Optional[str] = None) -> str:
        nid = await ctx.nb(notebook_id)
        srcs = await ctx.api("GET", "/sources", params={"notebook_id": nid})
        return json.dumps(
            [
                {"id": s["id"], "title": s.get("title"), "status": s.get("status")}
                for s in srcs
            ][:50]
        )

    async def add_source(
        notebook_id: Optional[str] = None,
        url: Optional[str] = None,
        text: Optional[str] = None,
        title: Optional[str] = None,
    ) -> str:
        nid = await ctx.nb(notebook_id)
        if not url and not text:
            return "Provide either url or text."
        form = {
            "type": "link" if url else "text",
            "notebooks": json.dumps([nid]),
            "embed": "true",
            "async_processing": "true",
        }
        if url:
            form["url"] = url
        if text:
            form["content"] = text
        if title:
            form["title"] = title
        await ctx.run.progress(
            f"Uploading {'link ' + url if url else 'text'} to the notebook"
        )
        src = await ctx.api("POST", "/sources", data=form)
        sid = src["id"]
        status = src.get("status")
        last = None
        for _ in range(90):  # wait up to ~3 minutes for processing
            if status in ("completed", "failed", "error"):
                break
            if status != last:
                await ctx.run.progress(f"Processing status: {status}")
                last = status
            await asyncio.sleep(2)
            st = await ctx.api("GET", f"/sources/{sid}/status")
            status = st.get("status")
        await ctx.run.progress(f"Source {status}")
        info = await ctx.api("GET", f"/sources/{sid}")
        return json.dumps({"id": sid, "title": info.get("title"), "status": status})

    async def read_notebook(notebook_id: Optional[str] = None) -> str:
        from open_notebook.domain.notebook import Notebook
        from open_notebook.exports.content import gather_notebook_material

        nb = await Notebook.get(await ctx.nb(notebook_id))
        await ctx.run.progress(f'Reading notebook "{nb.name}"')
        material, titles = await gather_notebook_material(nb)
        await ctx.run.progress(
            f"Read {len(material):,} characters from {len(titles)} source(s)"
        )
        return json.dumps(
            {"notebook": nb.name, "sources": titles, "material": material[:5000]}
        )

    async def search_knowledge(query: str, notebook_id: Optional[str] = None) -> str:
        body: Dict[str, Any] = {
            "query": query,
            "type": "vector",
            "limit": 6,
            "minimum_score": 0.2,
        }
        if notebook_id or ctx.default_notebook:
            body["notebook_id"] = await ctx.nb(notebook_id)
        await ctx.run.progress(f'Vector search: "{query}"')
        try:
            res = await ctx.api("POST", "/search", json=body)
        except RuntimeError:
            await ctx.run.progress("Vector search unavailable, using text search")
            body["type"] = "text"
            res = await ctx.api("POST", "/search", json=body)
        out = []
        for r in res.get("results", [])[:6]:
            snippet = r.get("matches") or r.get("content") or ""
            if isinstance(snippet, list):
                snippet = " ... ".join(map(str, snippet))
            out.append(
                {
                    "title": r.get("title"),
                    "id": r.get("parent_id") or r.get("id"),
                    "text": str(snippet)[:600],
                }
            )
        return json.dumps(out)

    async def create_note(
        title: str, content: str, notebook_id: Optional[str] = None
    ) -> str:
        note = await ctx.api(
            "POST",
            "/notes",
            json={
                "title": title,
                "content": content,
                "note_type": "ai",
                "notebook_id": await ctx.nb(notebook_id),
            },
        )
        return json.dumps({"id": note.get("id"), "title": note.get("title")})

    async def generate_file(
        kind: str,
        notebook_id: Optional[str] = None,
        formats: Optional[List[str]] = None,
        template: str = "default",
        theme: str = "graphite",
        slide_count: int = 8,
        length: str = "medium",
        audience: str = "senior leadership",
        tone: str = "formal",
        instructions: Optional[str] = None,
    ) -> str:
        from open_notebook.exports.content import StudioOptions
        from open_notebook.exports.produce import produce

        nid = await ctx.nb(notebook_id)
        opts = StudioOptions(
            theme=theme,
            template=template or "default",
            slide_count=max(4, min(20, int(slide_count))),
            length=length,
            audience=audience,
            tone=tone,
            instructions=instructions,
        )
        result = await produce(ctx.run, nid, kind, formats, opts)
        return json.dumps(result)

    async def read_source(source_id: str) -> str:
        sid = source_id if source_id.startswith("source:") else f"source:{source_id}"
        await ctx.run.progress(f"Reading {sid}")
        src = await ctx.api("GET", f"/sources/{sid}")
        text = (src.get("full_text") or "").strip()
        await ctx.run.progress(
            f'Read {len(text):,} characters from "{src.get("title")}"'
        )
        return json.dumps(
            {
                "title": src.get("title"),
                "status": src.get("status"),
                "text": text[:6000],
            }
        )

    async def process_sources(notebook_id: Optional[str] = None) -> str:
        nid = await ctx.nb(notebook_id)
        srcs = await ctx.api("GET", "/sources", params={"notebook_id": nid})
        retried = []
        for s_ in srcs:
            if s_.get("status") in ("failed", "error") or not s_.get("embedded"):
                await ctx.run.progress(f'Reprocessing "{s_.get("title")}"')
                try:
                    await ctx.api("POST", f"/sources/{s_['id']}/retry")
                    retried.append(s_.get("title"))
                except RuntimeError as e:
                    await ctx.run.progress(f"Could not reprocess: {e}")
        return json.dumps({"reprocessing": retried, "total_sources": len(srcs)})

    async def list_files(notebook_id: Optional[str] = None) -> str:
        from open_notebook.exports import storage

        items = storage.list_files((await ctx.nb(notebook_id)) if notebook_id else None)
        return json.dumps(
            [
                {
                    "id": i.id,
                    "filename": i.filename,
                    "kind": i.kind,
                    "created": i.created,
                }
                for i in items[:30]
            ]
        )

    async def generate_podcast(
        episode_name: str,
        notebook_id: Optional[str] = None,
        episode_profile: str = "solo_expert",
    ) -> str:
        speaker = {
            "solo_expert": "solo_expert",
            "tech_discussion": "tech_experts",
            "business_analysis": "business_panel",
        }[episode_profile]
        job = await ctx.api(
            "POST",
            "/podcasts/generate",
            json={
                "episode_profile": episode_profile,
                "speaker_profile": speaker,
                "episode_name": episode_name,
                "notebook_id": await ctx.nb(notebook_id),
            },
        )
        return json.dumps(
            {
                "job_id": job.get("job_id"),
                "status": "started",
                "note": "Podcast renders in the background; it appears on the Podcasts page when done.",
            }
        )

    def t(fn, schema, desc):
        return StructuredTool.from_function(
            coroutine=fn, name=fn.__name__, description=desc, args_schema=schema
        )

    return [
        t(list_notebooks, NoArgs, "List all notebooks with their ids."),
        t(
            create_notebook,
            CreateNotebookArgs,
            "Create a new notebook. It becomes the current notebook.",
        ),
        t(list_sources, NotebookArg, "List sources in a notebook."),
        t(
            add_source,
            AddSourceArgs,
            "Add a web page/YouTube URL or raw text as a source to a notebook and wait until it is processed.",
        ),
        t(
            read_notebook,
            NotebookArg,
            "Read the text of a notebook's sources and notes to answer questions about them.",
        ),
        t(
            search_knowledge,
            SearchArgs,
            "Semantic search across sources and notes. Returns matching passages.",
        ),
        t(create_note, NoteArgs, "Save a note into a notebook."),
        t(
            generate_file,
            GenerateFileArgs,
            "Generate a PowerPoint presentation, PDF report (short/medium/long), infographic, Excel dashboard or executive summary from a notebook. Runs template selection, design and an audit loop, then saves the files. Call once per document.",
        ),
        t(list_files, NotebookArg, "List files already generated by Studio."),
        t(
            read_source,
            SourceArg,
            "Read the extracted text of one source or attached file.",
        ),
        t(
            process_sources,
            NotebookArg,
            "Reprocess sources in a notebook that failed or were never processed.",
        ),
        t(
            generate_podcast,
            PodcastArgs,
            "Start generating an audio podcast episode from a notebook.",
        ),
    ]
