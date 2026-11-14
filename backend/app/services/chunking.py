"""Section-aware sliding-window chunker with page reference tracking."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.text import estimate_tokens, normalize_whitespace, split_sentences

_MD_HEADER = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_NUMBERED_HEADER = re.compile(r"^(\d+(?:\.\d+)*)[.)]?\s+([A-Z][^.!?]{2,88})$")
_ALLCAPS_HEADER = re.compile(r"^[A-Z][A-Z0-9][A-Z0-9 \-_/&:,()]{2,88}$")
_KNOWN_HEADER = re.compile(
    r"^(section\s+[a-z0-9]+|appendix\s+[a-z0-9]*|overview|summary|executive summary|"
    r"background|introduction|methodology|technical analysis|findings|analysis|"
    r"indicators of compromise|iocs|detection|mitigations|recommendations|"
    r"threat actor|campaign|campaigns|timeline|conclusion|references)\b[:\s-]*",
    re.IGNORECASE,
)
_COLON_HEADER = re.compile(r"^[A-Z][A-Za-z0-9 /&()\-]{2,58}:$")


@dataclass(slots=True)
class PageText:
    page_number: int
    text: str


@dataclass(slots=True)
class ChunkDraft:
    index: int
    text: str
    section_header: str | None
    page_start: int
    page_end: int
    char_count: int
    token_estimate: int
    page_refs: list[int] = field(default_factory=list)


@dataclass(slots=True)
class _Unit:
    page: int
    text: str


@dataclass(slots=True)
class _Section:
    header: str | None
    units: list[_Unit] = field(default_factory=list)


def _header_level_and_title(line: str) -> tuple[int, str] | None:
    stripped = line.strip()
    if not stripped or len(stripped) > 140:
        return None

    match = _MD_HEADER.match(stripped)
    if match:
        return len(match.group(1)), match.group(2).strip()

    match = _NUMBERED_HEADER.match(stripped)
    if match:
        depth = match.group(1).count(".") + 1
        title = f"{match.group(1)} {match.group(2).strip()}"
        return min(depth, 6), title

    # Known section keywords are strong signals.
    if _KNOWN_HEADER.match(stripped) and not stripped.endswith("."):
        return 1, stripped.rstrip(":").strip()

    if _COLON_HEADER.match(stripped) and len(stripped.split()) <= 8:
        return 2, stripped.rstrip(":").strip()

    if _ALLCAPS_HEADER.match(stripped) and not stripped.endswith("."):
        # Require at least two words to avoid treating single tokens as headers.
        if len(stripped.split()) >= 2:
            return 1, stripped.title()
    return None


def _breadcrumb(stack: list[tuple[int, str]], limit: int = 3) -> str | None:
    if not stack:
        return None
    titles = [title for _, title in stack[-limit:]]
    return " > ".join(titles)


def _line_units(page_number: int, line: str) -> list[_Unit]:
    """Split a physical line into sentence-sized units attached to a page."""
    if not line.strip():
        return []
    # Short bullets / table rows stay intact.
    if len(line) <= 220 or line.lstrip().startswith(("-", "*", "•", "|")):
        return [_Unit(page=page_number, text=line.strip())]
    return [
        _Unit(page=page_number, text=sentence)
        for sentence in split_sentences(line)
        if sentence.strip()
    ]


def _emit(units: list[_Unit], index: int, header: str | None) -> ChunkDraft | None:
    body = normalize_whitespace(" ".join(unit.text for unit in units))
    if not body:
        return None
    text = f"{header}\n{body}" if header else body
    pages = sorted({unit.page for unit in units})
    return ChunkDraft(
        index=index,
        text=text,
        section_header=header,
        page_start=pages[0] if pages else 1,
        page_end=pages[-1] if pages else 1,
        char_count=len(text),
        token_estimate=estimate_tokens(text),
        page_refs=pages,
    )


def _hard_split(unit: _Unit, size: int, overlap: int) -> list[_Unit]:
    text = unit.text
    step = max(1, size - overlap)
    return [
        _Unit(page=unit.page, text=text[start : start + size])
        for start in range(0, len(text), step)
        if text[start : start + size].strip()
    ]


def _chunk_section(section: _Section, size: int, overlap: int) -> list[ChunkDraft]:
    drafts: list[ChunkDraft] = []
    window: list[_Unit] = []
    window_chars = 0

    def flush(min_size: int = 0) -> None:
        nonlocal window, window_chars
        if not window:
            return
        body_len = sum(len(unit.text) for unit in window)
        if body_len < min_size and drafts:
            window, window_chars = [], 0
            return
        draft = _emit(window, len(drafts), section.header)
        if draft:
            drafts.append(draft)
        # Build overlap tail from the emitted window.
        tail: list[_Unit] = []
        tail_chars = 0
        for unit in reversed(window):
            if tail_chars >= overlap or tail_chars + len(unit.text) > size // 2:
                break
            tail.insert(0, unit)
            tail_chars += len(unit.text)
        window = tail
        window_chars = tail_chars

    for raw_unit in section.units:
        units = (
            _hard_split(raw_unit, size, overlap)
            if len(raw_unit.text) > size
            else [raw_unit]
        )
        for unit in units:
            projected = window_chars + len(unit.text)
            if window and projected > size:
                flush(min_size=0)
                # Avoid re-adding the exact same unit in the overlap window.
                if window and window[-1].text == unit.text:
                    window, window_chars = [], 0
            window.append(unit)
            window_chars += len(unit.text)

    if window:
        flush(min_size=0)
    return drafts


def chunk_document(
    pages: list[PageText],
    *,
    chunk_size: int = 1400,
    chunk_overlap: int = 220,
    min_chunk_size: int = 120,
) -> list[ChunkDraft]:
    """Convert ordered pages into section-aware, overlapping chunks.

    - Markdown/numbered/ALL-CAPS headings are detected and tracked as a breadcrumb.
    - Each chunk records the inclusive page range it was drawn from.
    - Windows slide with a configurable overlap, without crossing section boundaries.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    overlap = max(0, min(chunk_overlap, chunk_size // 2))
    min_chunk_size = max(0, min(min_chunk_size, chunk_size // 2))

    sections: list[_Section] = []
    current = _Section(header=None)
    stack: list[tuple[int, str]] = []

    for page in pages:
        for line in page.text.split("\n"):
            header = _header_level_and_title(line)
            if header is not None:
                level, title = header
                while stack and stack[-1][0] >= level:
                    stack.pop()
                stack.append((level, title))
                if current.units:
                    sections.append(current)
                current = _Section(header=_breadcrumb(stack))
                continue
            current.units.extend(_line_units(page.page_number, line))
        # Preserve page boundaries as soft separators.
        if current.units:
            current.units.append(_Unit(page=page.page_number, text=""))

    if current.units:
        sections.append(current)

    drafts: list[ChunkDraft] = []
    for section in sections:
        section.units = [unit for unit in section.units if unit.text.strip()]
        if not section.units:
            continue
        drafts.extend(_chunk_section(section, chunk_size, overlap))

    # Enforce a minimum size by merging tiny trailing chunks into the previous one.
    merged: list[ChunkDraft] = []
    for draft in drafts:
        if merged and draft.char_count < min_chunk_size and merged[-1].section_header == draft.section_header:
            previous = merged[-1]
            previous.text = f"{previous.text}\n{draft.text}"
            previous.char_count = len(previous.text)
            previous.token_estimate = estimate_tokens(previous.text)
            previous.page_end = max(previous.page_end, draft.page_end)
            previous.page_refs = sorted(set(previous.page_refs) | set(draft.page_refs))
        else:
            merged.append(draft)

    for index, draft in enumerate(merged):
        draft.index = index
    return merged
