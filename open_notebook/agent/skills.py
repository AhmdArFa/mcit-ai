"""Agent skills: reusable instruction packs injected into the assistant and Studio prompts.

Two skills ship enabled by default (both MIT licensed, full originals kept next
to this file for reference):
  * no-ai-slop  — https://github.com/petergyang/no-ai-slop (Peter Yang)
  * humanizer   — https://github.com/blader/humanizer (Siqi Chen)

The local 7B model has an 8k-token window, so each skill carries a compact
"instructions" digest that is actually injected, plus the link to the full text.
Users can add, edit, disable and delete their own skills; they are stored as
JSON under the data folder so they survive container rebuilds.
"""

import json
import re
import threading
import uuid
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, Field

from open_notebook.config import DATA_FOLDER

SKILLS_FILE = Path(DATA_FOLDER) / "agent" / "skills.json"
MAX_INJECTED_CHARS = 3200
_lock = threading.Lock()


class Skill(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    description: str = ""
    instructions: str
    source_url: str = ""
    enabled: bool = True
    builtin: bool = False


BUILTIN_SKILLS: List[Skill] = [
    Skill(
        id="no-ai-slop",
        name="No AI slop",
        description="Sharp, direct, concrete writing that keeps the point and the voice.",
        source_url="https://github.com/petergyang/no-ai-slop",
        builtin=True,
        instructions=(
            "Lead with the point. Be concrete: names, numbers, dates and mechanisms beat abstractions. "
            "Every sentence must add something; cut throat-clearing, filler and empty qualifiers. "
            "Use active voice and direct verbs ('decided', not 'made a decision'). "
            "Apply the portability test: a sentence that would fit any other organisation or topic is filler. "
            "Show with facts instead of telling the reader something is important. Never invent facts."
        ),
    ),
    Skill(
        id="humanizer",
        name="Humanizer",
        description="Removes the structural and word-level tells of AI-generated text.",
        source_url="https://github.com/blader/humanizer",
        builtin=True,
        instructions=(
            "Avoid these AI tells: 'not X but Y' contrasts; one-line dramatic closers; 'the real question is', "
            "'at its core'; run-ups like 'let's dive in', 'here's what you need to know'; forced groups of three; "
            "em dashes (use commas, colons or periods); stacked hedges; the words delve, crucial, pivotal, robust, "
            "seamless, landscape, tapestry, testament, showcase, underscore, vibrant, meticulous, enhance, leverage; "
            "inflated significance ('marks a pivotal moment', 'the future looks bright'); sales language; "
            "'serves as' or 'boasts' instead of 'is' or 'has'; bold labels and Title Case headings; emojis; "
            "chatbot residue ('Great question', 'I hope this helps', 'Let me know'). "
            "Write headings in sentence case. Vary sentence length."
        ),
    ),
]


def _load_user() -> List[Skill]:
    if not SKILLS_FILE.exists():
        return []
    try:
        return [Skill(**s) for s in json.loads(SKILLS_FILE.read_text("utf-8"))]
    except Exception:
        return []


def _save_user(skills: List[Skill]) -> None:
    SKILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SKILLS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps([s.model_dump() for s in skills], indent=2), "utf-8")
    tmp.replace(SKILLS_FILE)


def _overrides() -> dict:
    """Enabled/disabled state for built-in skills is stored as user entries with builtin=True."""
    return {s.id: s for s in _load_user() if s.builtin}


def list_skills() -> List[Skill]:
    ov = _overrides()
    builtins = [
        ov.get(b.id, b).model_copy(
            update={"instructions": b.instructions, "builtin": True}
        )
        for b in BUILTIN_SKILLS
    ]
    return builtins + [s for s in _load_user() if not s.builtin]


def get_skill(skill_id: str) -> Optional[Skill]:
    return next((s for s in list_skills() if s.id == skill_id), None)


def create_skill(
    name: str, instructions: str, description: str = "", source_url: str = ""
) -> Skill:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "skill"
    with _lock:
        user = _load_user()
        existing = {s.id for s in user} | {b.id for b in BUILTIN_SKILLS}
        sid = slug if slug not in existing else f"{slug}-{uuid.uuid4().hex[:4]}"
        skill = Skill(
            id=sid,
            name=name,
            instructions=instructions,
            description=description,
            source_url=source_url,
        )
        user.append(skill)
        _save_user(user)
    return skill


def update_skill(skill_id: str, **fields) -> Optional[Skill]:
    with _lock:
        user = _load_user()
        builtin = next((b for b in BUILTIN_SKILLS if b.id == skill_id), None)
        if builtin:
            # built-ins can only be toggled
            current = next((s for s in user if s.id == skill_id), builtin.model_copy())
            if "enabled" in fields and fields["enabled"] is not None:
                current.enabled = bool(fields["enabled"])
            user = [s for s in user if s.id != skill_id] + [current]
            _save_user(user)
            return get_skill(skill_id)
        for i, s in enumerate(user):
            if s.id == skill_id:
                data = s.model_dump()
                data.update({k: v for k, v in fields.items() if v is not None})
                user[i] = Skill(**data)
                _save_user(user)
                return user[i]
    return None


def delete_skill(skill_id: str) -> bool:
    if any(b.id == skill_id for b in BUILTIN_SKILLS):
        return False
    with _lock:
        user = _load_user()
        kept = [s for s in user if s.id != skill_id]
        if len(kept) == len(user):
            return False
        _save_user(kept)
    return True


def compact_writing_rules(only: Optional[List[str]] = None) -> str:
    """Instructions from enabled skills (or exactly `only`), capped to fit a small context window."""
    pool = list_skills()
    picked = (
        [s for s in pool if s.id in only]
        if only is not None
        else [s for s in pool if s.enabled]
    )
    parts = [f"[{s.name}] {s.instructions.strip()}" for s in picked]
    if not parts:
        return ""
    text = "Writing rules you must follow:\n" + "\n".join(parts)
    return text[:MAX_INJECTED_CHARS]
