"""Studio template library.

Each template is a reference design: a theme plus a layout recipe the model is
asked to follow. "default" is the approved house template for each type and
skips the reference step; any other choice runs the full workflow
(reference -> design -> audit loop -> delivery).
"""

from typing import Dict, List, Optional

TEMPLATES: List[Dict] = [
    {
        "id": "default",
        "name": "MCIT standard",
        "kinds": ["presentation", "report", "infographic", "summary", "spreadsheet"],
        "theme": "graphite",
        "brief": "",
        "description": "Approved house template. Generated directly.",
    },
    {
        "id": "executive-briefing",
        "name": "Executive briefing",
        "kinds": ["presentation", "report", "summary"],
        "theme": "midnight",
        "brief": "Open with the decision needed, then three to four key figures, then options compared side by side, "
        "then a recommendation. Prefer stats, comparison and cards layouts; keep text minimal.",
        "description": "Decision-first deck for ministers and steering committees.",
    },
    {
        "id": "data-story",
        "name": "Data story",
        "kinds": ["presentation", "report", "infographic", "spreadsheet"],
        "theme": "teal",
        "brief": "Lead with the trend. Put every series that has numbers into a chart; pair each chart with a one-line "
        "takeaway. Use chart and stats layouts wherever the material has numbers.",
        "description": "Numbers first: charts, trends and KPI callouts.",
    },
    {
        "id": "program-review",
        "name": "Program review",
        "kinds": ["presentation", "report", "summary"],
        "theme": "forest",
        "brief": "Structure as status, progress against targets, risks and issues, next steps. Use a process layout "
        "for the plan and a comparison layout for planned versus actual.",
        "description": "Status, progress, risks and next steps.",
    },
    {
        "id": "public-brief",
        "name": "Public brief",
        "kinds": ["presentation", "infographic", "summary"],
        "theme": "terracotta",
        "brief": "Plain language for citizens. Short sentences, one idea per slide, a quote or story where the "
        "material has one, and a clear call to action at the end.",
        "description": "Plain-language communication for the public.",
    },
    {
        "id": "ministry-official",
        "name": "Ministry official",
        "kinds": ["presentation", "report", "infographic", "summary", "spreadsheet"],
        "theme": "mcit",
        "brief": "Formal ministry style: background, objectives, findings, recommendations. Formal tone, no "
        "contractions, numbered recommendations.",
        "description": "Formal ministry format in MCIT navy and gold.",
    },
]


def list_templates(kind: Optional[str] = None) -> List[Dict]:
    return [t for t in TEMPLATES if not kind or kind in t["kinds"]]


def get_template(template_id: str) -> Optional[Dict]:
    return next((t for t in TEMPLATES if t["id"] == template_id), None)
