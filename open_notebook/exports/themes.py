"""Design themes for Studio outputs.

Each theme follows the dominance rule: one dominant colour, one supporting
tone, one sharp accent. Dark title/closing slides with light content slides
("sandwich"), no accent stripes or underlines.
"""

from dataclasses import dataclass
from typing import Dict


@dataclass(frozen=True)
class Theme:
    id: str
    name: str
    description: str
    dark: str  # title / closing background
    primary: str  # dominant brand colour on light slides
    accent: str  # one sharp accent
    soft: str  # tinted card background
    ink: str  # body text
    muted: str  # captions
    light: str  # page background
    on_dark: str  # text on dark backgrounds
    head_font: str
    body_font: str


THEMES: Dict[str, Theme] = {
    t.id: t
    for t in [
        Theme(
            "graphite",
            "Graphite",
            "Neutral, modern, product-launch feel",
            dark="18181B",
            primary="18181B",
            accent="10A37F",
            soft="F4F4F5",
            ink="27272A",
            muted="71717A",
            light="FFFFFF",
            on_dark="FAFAFA",
            head_font="Calibri",
            body_font="Calibri",
        ),
        Theme(
            "midnight",
            "Midnight Executive",
            "Deep navy with ice blue, boardroom ready",
            dark="1E2761",
            primary="1E2761",
            accent="4F7CFF",
            soft="EEF2FF",
            ink="1F2937",
            muted="6B7280",
            light="FFFFFF",
            on_dark="FFFFFF",
            head_font="Cambria",
            body_font="Calibri",
        ),
        Theme(
            "teal",
            "Teal Trust",
            "Calm teal for policy and public services",
            dark="0B3B3C",
            primary="028090",
            accent="02C39A",
            soft="E6F6F4",
            ink="1F2937",
            muted="5B6B70",
            light="FFFFFF",
            on_dark="FFFFFF",
            head_font="Calibri",
            body_font="Calibri",
        ),
        Theme(
            "terracotta",
            "Warm Terracotta",
            "Warm and human, for social impact topics",
            dark="3B1F1A",
            primary="B85042",
            accent="E9A23B",
            soft="F7EEEC",
            ink="2B2B2B",
            muted="6E6259",
            light="FFFFFF",
            on_dark="FFFFFF",
            head_font="Bookman Old Style",
            body_font="Calibri",
        ),
        Theme(
            "forest",
            "Forest & Moss",
            "Grounded green for sustainability and growth",
            dark="1D3B1E",
            primary="2C5F2D",
            accent="97BC62",
            soft="EEF4E8",
            ink="1F2A1F",
            muted="5E6B5E",
            light="FFFFFF",
            on_dark="FFFFFF",
            head_font="Cambria",
            body_font="Calibri",
        ),
        Theme(
            "mcit",
            "MCIT Official",
            "Ministry navy with gold accent",
            dark="0B2A5B",
            primary="0B2A5B",
            accent="C9A227",
            soft="EEF2F8",
            ink="1F2937",
            muted="5B6472",
            light="FFFFFF",
            on_dark="FFFFFF",
            head_font="Cambria",
            body_font="Calibri",
        ),
    ]
}

DEFAULT_THEME = "graphite"


def get_theme(theme_id: str | None) -> Theme:
    return THEMES.get(theme_id or DEFAULT_THEME, THEMES[DEFAULT_THEME])
