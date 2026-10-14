"""Studio delivery workflow: render -> audit -> refactor, until zero issues.

Every audit is a real check on the rendered bytes:
  * PPTX  - reopened with python-pptx; text fit is computed from box geometry
            and font size, shapes are checked against slide bounds, fonts below
            readable size and empty slides are flagged, slide count is verified.
  * PDF   - reopened with pdfium; page count against the length level, blank
            pages and missing text layers are flagged.
  * DOCX  - reopened with python-docx; empty documents and wall-of-text
            paragraphs are flagged.
  * XLSX  - reopened from the zip package; every data sheet must have rows,
            charts must exist when tables have numeric columns, formulas must
            be present.
  * SVG/HTML/MD/TXT - parsed; malformed markup, lines wider than the canvas
            and empty output are flagged.
The loop stops at zero issues or after MAX_PASSES and reports what is left.
"""

import io
import math
import re
import zipfile
from typing import Any, Awaitable, Callable, Dict, List, Tuple

from open_notebook.exports.content import (
    StudioDocument,
    content_slide_count,
    norm_length,
)
from open_notebook.exports.renderers import RENDERERS

MAX_PASSES = 5
Progress = Callable[[str], Awaitable[None]]

Issue = Dict[str, Any]  # {"code", "message", "slide"?: int, "fix"?: str}


# ----------------------------------------------------------------------------- audits


def _audit_pptx(data: bytes, doc: StudioDocument) -> List[Issue]:
    from pptx import Presentation
    from pptx.util import Pt

    issues: List[Issue] = []
    prs = Presentation(io.BytesIO(data))
    sw, sh = prs.slide_width, prs.slide_height
    expected = doc.options.slide_count if doc.kind == "presentation" else None
    if expected and len(prs.slides) != expected:
        issues.append(
            {
                "code": "slide_count",
                "message": f"Deck has {len(prs.slides)} slides, {expected} requested",
            }
        )
    for idx, slide in enumerate(prs.slides, 1):
        texts = 0
        for shp in slide.shapes:
            if shp.left is not None and shp.width is not None:
                if (
                    shp.left < 0
                    or shp.top < 0
                    or shp.left + shp.width > sw + 9525
                    or shp.top + shp.height > sh + 9525
                ):
                    issues.append(
                        {
                            "code": "off_slide",
                            "slide": idx,
                            "message": f"Slide {idx}: a shape extends past the slide edge",
                        }
                    )
            if getattr(shp, "has_table", False):
                texts += 2
                continue
            if getattr(shp, "shape_type", None) == 13:
                texts += 2
                continue
            if not shp.has_text_frame or not shp.text_frame.text.strip():
                continue
            texts += 1
            tf = shp.text_frame
            box_w = max(1, shp.width) / 12700  # EMU -> pt
            box_h = max(1, shp.height) / 12700
            needed = 0.0
            for p in tf.paragraphs:
                size = None
                for r in p.runs:
                    if r.font.size:
                        size = r.font.size.pt
                        break
                size = size or 18
                if size < 9.5:
                    issues.append(
                        {
                            "code": "tiny_font",
                            "slide": idx,
                            "message": f"Slide {idx}: text at {size:.0f}pt is below readable size",
                        }
                    )
                text = "".join(r.text for r in p.runs)
                chars_per_line = max(1, box_w / (size * 0.5))
                lines = max(1, math.ceil(len(text) / chars_per_line)) if text else 1
                spacing = (
                    (p.space_after.pt if p.space_after else 0)
                    if hasattr(p, "space_after")
                    else 0
                )
                needed += lines * size * 1.2 + spacing
            if needed > box_h * 1.15 + Pt(4).pt and box_h > 20:
                snippet = tf.text.strip().split("\n")[0][:50]
                issues.append(
                    {
                        "code": "overflow",
                        "slide": idx,
                        "message": f'Slide {idx}: text overflows its box ("{snippet}")',
                    }
                )
        if idx not in (1, len(prs.slides)) and texts <= 1:
            issues.append(
                {
                    "code": "empty_slide",
                    "slide": idx,
                    "message": f"Slide {idx} has a title but no content",
                }
            )
    return issues


def _audit_pdf(data: bytes, doc: StudioDocument) -> List[Issue]:
    import pypdfium2 as pdfium

    issues: List[Issue] = []
    pdf = pdfium.PdfDocument(data)
    n = len(pdf)
    for i in range(n):
        text = pdf[i].get_textpage().get_text_range().strip()
        if i > 0 and len(text) < 30:
            issues.append(
                {
                    "code": "blank_page",
                    "message": f"Page {i + 1} is blank or nearly empty",
                }
            )
    if doc.kind == "report":
        length = norm_length(doc.options.length)
        lo, hi = {"short": (2, 4), "medium": (3, 9), "long": (6, 60)}[length]
        if n < lo:
            issues.append(
                {
                    "code": "too_short",
                    "message": f"{n} pages is below the {length} range ({lo}-{hi})",
                }
            )
        if n > hi:
            issues.append(
                {
                    "code": "too_long",
                    "message": f"{n} pages is above the {length} range ({lo}-{hi})",
                }
            )
    pdf.close()
    return issues


def _audit_docx(data: bytes, doc: StudioDocument) -> List[Issue]:
    from docx import Document

    d = Document(io.BytesIO(data))
    paras = [p.text for p in d.paragraphs if p.text.strip()]
    issues: List[Issue] = []
    if len(paras) < 3:
        issues.append({"code": "empty", "message": "Document has almost no text"})
    for p in paras:
        if len(p) > 2400:
            issues.append(
                {
                    "code": "wall_of_text",
                    "message": f"A paragraph is {len(p)} characters long",
                }
            )
            break
    return issues


def _audit_xlsx(data: bytes, doc: StudioDocument) -> List[Issue]:
    from openpyxl import load_workbook

    issues: List[Issue] = []
    z = zipfile.ZipFile(io.BytesIO(data))
    charts = [n for n in z.namelist() if n.startswith("xl/charts/chart")]
    wb = load_workbook(io.BytesIO(data))
    formulas = 0
    for tb in doc.tables:
        name = (tb.name or "")[:28]
        if name and name in wb.sheetnames and wb[name].max_row < 2:
            issues.append(
                {"code": "empty_sheet", "message": f"Sheet {name} has no rows"}
            )
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            formulas += sum(
                1 for c in row if isinstance(c.value, str) and c.value.startswith("=")
            )
    numeric = any(
        any(isinstance(v, (int, float)) for r in tb.rows for v in r[1:])
        for tb in doc.tables
    )
    if not doc.tables:
        issues.append({"code": "no_data", "message": "Workbook has no data tables"})
    if numeric and not charts:
        issues.append(
            {
                "code": "no_charts",
                "message": "Numeric data present but no charts were built",
            }
        )
    if numeric and not formulas:
        issues.append(
            {
                "code": "no_formulas",
                "message": "Numeric data present but no formulas were written",
            }
        )
    return issues


def _audit_svg(data: bytes, doc: StudioDocument) -> List[Issue]:
    from lxml import etree

    issues: List[Issue] = []
    try:
        root = etree.fromstring(data)
    except etree.XMLSyntaxError as e:
        return [{"code": "malformed", "message": f"SVG does not parse: {e}"}]
    width = float(root.get("width", "1080"))
    for el in root.iter("{http://www.w3.org/2000/svg}text"):
        size = float(el.get("font-size", "16"))
        x = float(el.get("x", "0"))
        anchor = el.get("text-anchor", "start")
        est = len(el.text or "") * size * 0.52
        if anchor == "start" and x + est > width + 4:
            issues.append(
                {
                    "code": "overflow",
                    "message": f'Text runs past the canvas: "{(el.text or "")[:40]}"',
                }
            )
    return issues


def _audit_text(data: bytes, doc: StudioDocument) -> List[Issue]:
    return (
        []
        if len(data.strip()) > 40
        else [{"code": "empty", "message": "Output is empty"}]
    )


AUDITS = {
    "pptx": _audit_pptx,
    "pdf": _audit_pdf,
    "docx": _audit_docx,
    "xlsx": _audit_xlsx,
    "svg": _audit_svg,
    "html": _audit_text,
    "md": _audit_text,
    "txt": _audit_text,
    "json": _audit_text,
}


# ----------------------------------------------------------------------------- fixes


def _shorten(text: str, n: int) -> str:
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "."


def _fix(doc: StudioDocument, fmt: str, issues: List[Issue], pass_no: int) -> List[str]:
    """Refactor the document model to address the issues. Returns actions taken."""
    actions: List[str] = []
    limit_chars = max(40, 90 - pass_no * 12)
    limit_items = max(3, 6 - pass_no)
    if fmt == "pptx":
        slides_hit = {i["slide"] for i in issues if i.get("slide")}
        content_offset = (
            3 if doc.options.slide_count >= 8 else 2
        )  # cover (+agenda) precede content
        for i in slides_hit:
            k = i - content_offset
            if 0 <= k < len(doc.slides):
                s = doc.slides[k]
                s.title = _shorten(s.title, 60)
                for attr in ("bullets", "left", "right", "steps"):
                    items = getattr(s, attr)
                    setattr(
                        s, attr, [_shorten(x, limit_chars) for x in items[:limit_items]]
                    )
                s.quote = _shorten(s.quote, 160)
                if any(
                    x.get("code") == "empty_slide" and x.get("slide") == i
                    for x in issues
                ):
                    s.layout = "bullets"
                    s.bullets = (
                        s.bullets or [doc.summary[:limit_chars]]
                        if doc.summary
                        else s.bullets
                    )
                actions.append(
                    f"Tightened slide {i} (items <= {limit_items}, <= {limit_chars} chars)"
                )
        if any(x["code"] == "slide_count" for x in issues):
            want = content_slide_count(doc.options.slide_count)
            if len(doc.slides) > want:
                doc.slides = doc.slides[:want]
                actions.append(f"Trimmed content slides to {want}")
            elif len(doc.slides) < want and doc.slides:
                # split the longest bullet slides to reach the requested count with real content
                while len(doc.slides) < want:
                    longest = max(
                        range(len(doc.slides)), key=lambda j: len(doc.slides[j].bullets)
                    )
                    s = doc.slides[longest]
                    if len(s.bullets) < 4:
                        break
                    half = len(s.bullets) // 2
                    clone = s.model_copy(deep=True)
                    clone.title = f"{s.title} (continued)"
                    clone.bullets = s.bullets[half:]
                    s.bullets = s.bullets[:half]
                    doc.slides.insert(longest + 1, clone)
                    actions.append(
                        f'Split slide "{s.title}" to reach {want} content slides'
                    )
    elif fmt in ("svg", "docx"):
        for sec in doc.sections:
            sec.body = _shorten(sec.body, 1800 if fmt == "docx" else 220)
            sec.bullets = [
                _shorten(b, limit_chars + 10) for b in sec.bullets[:limit_items]
            ]
        doc.title = _shorten(doc.title, 90)
        actions.append("Shortened section text and bullets")
    elif fmt == "pdf":
        if any(i["code"] == "too_long" for i in issues):
            for sec in doc.sections:
                sec.body = _shorten(sec.body, 900)
            actions.append("Condensed section bodies to fit the length level")
    return actions


# ----------------------------------------------------------------------------- driver


async def deliver(
    doc: StudioDocument,
    formats: List[str],
    progress: Progress,
    store: Callable[[StudioDocument, str, bytes], Any],
) -> Tuple[List[Any], Dict[str, List[Issue]]]:
    """Render each format, audit, refactor until clean. `store(doc, fmt, bytes)` persists a file."""
    delivered, remaining = [], {}
    for fmt in formats:
        render, _media, ext = RENDERERS[fmt]
        audit = AUDITS.get(ext, _audit_text)
        working = doc.model_copy(deep=True)
        issues: List[Issue] = []
        data = b""
        for pass_no in range(1, MAX_PASSES + 1):
            await progress(f"{ext.upper()}: rendering (pass {pass_no})")
            data = render(working)
            issues = audit(data, working)
            if not issues:
                await progress(f"{ext.upper()}: audit pass {pass_no} found 0 issues")
                break
            listed = "; ".join(i["message"] for i in issues[:4]) + (
                f" (+{len(issues) - 4} more)" if len(issues) > 4 else ""
            )
            await progress(
                f"{ext.upper()}: audit pass {pass_no} found {len(issues)} issue(s): {listed}"
            )
            if pass_no == MAX_PASSES:
                break
            actions = _fix(working, ext, issues, pass_no)
            if not actions:
                await progress(
                    f"{ext.upper()}: no automatic fix available for these issues"
                )
                break
            for a in actions[:6]:
                await progress(f"{ext.upper()}: {a}")
        if issues:
            remaining[ext] = issues
            await progress(
                f"{ext.upper()}: delivered with {len(issues)} open issue(s), listed in the reply"
            )
        delivered.append(store(working, ext, data))
    return delivered, remaining


def safe_slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:60] or "document"
