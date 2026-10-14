"""Thoth, the MCIT agent: a tool-calling loop over the whole app.

All statuses come from the engine (open_notebook.agent.engine): a step opens
when the model is called or a tool starts, progress lines are written by the
code doing the work, and token counts come from provider-reported usage.
"""

import json
import re
import uuid
from typing import Any, Dict, List, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from loguru import logger

from open_notebook.agent import engine
from open_notebook.agent.skills import compact_writing_rules, list_skills
from open_notebook.agent.tools import TOOL_LABELS, ToolContext, build_tools
from open_notebook.ai.provision import provision_langchain_model

MAX_STEPS = 14

SYSTEM_PROMPT = """You are Thoth, the MCIT agent of the Ministry of Communications and Information Technology.
You are confident, precise and direct. You operate the MCIT AI app through tools: notebooks, sources,
uploaded files, search, notes, Studio documents (presentations, PDF reports, infographics, Excel
dashboards, executive summaries) and podcasts.

How to work:
- Act. When the user asks for a file, call generate_file; for several files, call it once per file.
- Pass the exact notebook id returned by tools (it looks like notebook:abc123). Work in order: create the
  notebook if needed, add sources, then generate.
- If the user refers to "this notebook" and no current notebook is set, call list_notebooks and pick the
  best match. Never create an empty notebook just to generate from it.
- Attached files are already ingested as sources; read them with read_source when you need their content.
- To answer questions, use read_notebook, read_source or search_knowledge and cite source titles.
- Map wording to options: deck/slides -> presentation; report/PDF -> report (length short|medium|long);
  Excel/spreadsheet/dashboard -> spreadsheet; infographic -> infographic; summary/brief -> summary.
  template "default" unless the user names a style (executive-briefing, data-story, program-review,
  public-brief, ministry-official).
- Finish with a short plain reply: what you did, the files produced, and any open audit issues.
- Never invent facts, numbers or sources.
{rules}
{context}"""

_TEXT_CALL = re.compile(
    r"\{\s*\"name\"\s*:\s*\"(\w+)\"\s*,\s*\"arguments\"\s*:\s*(\{.*?\})\s*\}", re.S
)


def _fallback_tool_calls(content: str, names: set) -> List[Dict[str, Any]]:
    calls = []
    for m in _TEXT_CALL.finditer(content or ""):
        if m.group(1) in names:
            try:
                calls.append(
                    {
                        "name": m.group(1),
                        "args": json.loads(m.group(2)),
                        "id": uuid.uuid4().hex[:8],
                    }
                )
            except json.JSONDecodeError:
                continue
    return calls


def get_run(run_id: str):
    return engine.get_run(run_id)


async def _apply_reasoning(
    llm, model_id: Optional[str], level: Optional[str], run: engine.Run
) -> None:
    if not level or level == "off":
        return
    from open_notebook.ai.capabilities import get_model_capabilities, reasoning_kwargs
    from open_notebook.ai.models import DefaultModels

    mid = model_id or (await DefaultModels.get_instance()).default_tools_model
    caps = await get_model_capabilities(mid) if mid else None
    kwargs = reasoning_kwargs(caps.get("provider") if caps else "", caps, level)
    if not kwargs:
        await run.progress(
            f"Thinking level {level} is not supported by this model; running without extended reasoning"
        )
        return
    for k, v in kwargs.items():
        if hasattr(llm, k):
            setattr(llm, k, v)
        else:
            mk = dict(getattr(llm, "model_kwargs", {}) or {})
            mk[k] = v
            llm.model_kwargs = mk
    await run.progress(f"Thinking level: {level}")


async def _work(
    run: engine.Run,
    messages: List[Dict[str, str]],
    notebook_id: Optional[str],
    auth: Optional[str],
    model_id: Optional[str],
    thinking: Optional[str],
    skill_ids: Optional[List[str]],
    attachments: List[Dict[str, str]],
) -> None:
    ctx = ToolContext(auth, run, notebook_id)
    tools = build_tools(ctx)
    by_name = {t.name: t for t in tools}

    context = ""
    if notebook_id:
        try:
            from open_notebook.domain.notebook import Notebook

            nb = await Notebook.get(notebook_id)
            context = f"Current notebook: {nb.name} (id {nb.id})."
        except Exception:
            context = f"Current notebook id: {notebook_id}."
    if attachments:
        listed = ", ".join(
            f"{a['filename']} (source id {a['source_id']})" for a in attachments
        )
        context += f"\nFiles attached to this message: {listed}."

    chosen = [
        s for s in list_skills() if s.enabled and (not skill_ids or s.id in skill_ids)
    ]
    if skill_ids:
        chosen = [s for s in list_skills() if s.id in skill_ids]
    rules = compact_writing_rules(only=[s.id for s in chosen])
    if chosen:
        sid = run.step("Loading skills", "skill")
        for s in chosen:
            run.emit("skill", name=s.name)
            await run.progress(f"Skill ready: {s.name}")
        run.end_step(sid)
    system = SYSTEM_PROMPT.format(rules=rules, context=context)

    history: List[Any] = [SystemMessage(content=system)]
    for m in messages[-12:]:
        if m.get("role") == "user":
            history.append(HumanMessage(content=m.get("content", "")))
        elif m.get("role") == "assistant" and m.get("content"):
            history.append(AIMessage(content=m["content"]))

    llm = await provision_langchain_model(
        system + json.dumps(messages[-12:]), model_id, "tools", max_tokens=1500
    )
    model_name = (
        getattr(llm, "model", None) or getattr(llm, "model_name", None) or "model"
    )
    sid = run.step("Preparing", "think")
    await _apply_reasoning(llm, model_id, thinking, run)
    run.end_step(sid)
    bound = llm.bind_tools(tools)

    for turn in range(MAX_STEPS):
        sid = run.step("Thinking" if turn == 0 else "Reviewing results", "think")
        await run.progress(f"Calling {model_name}")
        reply = await bound.ainvoke(history)
        calls = list(getattr(reply, "tool_calls", None) or [])
        if not calls:
            calls = _fallback_tool_calls(str(reply.content), set(by_name))
            if calls:
                reply = AIMessage(content="", tool_calls=calls)
        history.append(reply)
        await run.progress(
            f"Model planned {len(calls)} action(s): "
            + ", ".join(TOOL_LABELS.get(c["name"], c["name"]) for c in calls)
            if calls
            else "Model is writing the answer"
        )
        run.end_step(sid)
        if not calls:
            run.emit("message", content=str(reply.content).strip() or "Done.")
            return
        for call in calls:
            name, args = call["name"], call.get("args") or {}
            tool = by_name.get(name)
            if name != "generate_file":  # Studio jobs open their own steps
                run.step(TOOL_LABELS.get(name, name), "tool")
            run.emit("tool_call", name=name, args=args)
            try:
                if not tool:
                    raise RuntimeError(f"Unknown tool {name}")
                result, ok = await tool.ainvoke(args), True
            except Exception as e:
                logger.warning(f"Thoth tool {name} failed: {type(e).__name__}")
                result, ok = f"ERROR: {type(e).__name__}", False
                await run.progress(f"Failed: {type(e).__name__}")
            if run._step:
                run.end_step(run._step, ok)
            history.append(
                ToolMessage(
                    content=str(result)[:6000], tool_call_id=call.get("id") or name
                )
            )
    run.emit(
        "message",
        content="I stopped after the maximum number of steps. Files produced so far are listed above.",
    )


def start_run(
    messages: List[Dict[str, str]],
    notebook_id: Optional[str],
    auth: Optional[str],
    model_id: Optional[str] = None,
    thinking: Optional[str] = None,
    skill_ids: Optional[List[str]] = None,
    attachments: Optional[List[Dict[str, str]]] = None,
) -> engine.Run:
    return engine.start(
        "agent",
        lambda run: _work(
            run,
            messages,
            notebook_id,
            auth,
            model_id,
            thinking,
            skill_ids,
            attachments or [],
        ),
        feature="agent",
    )
