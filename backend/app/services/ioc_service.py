"""IOC extraction, normalisation and safe defanging."""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Chunk, Document
from app.models.enums import IOCType
from app.models.ioc import IOC
from app.schemas.ioc import ExtractedIOC
from app.services.text import extract_context

_IPV4_RE = re.compile(
    r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}"
    r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\d|\.\d)"
)
_URL_RE = re.compile(r"\bhttps?://[^\s<>\"'\]\)},;]+", re.IGNORECASE)
_DOMAIN_RE = re.compile(
    r"(?<![@\w.-])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+"
    r"(?:[a-zA-Z]{2,24}|xn--[a-zA-Z0-9-]{2,40})(?![\w-]|\.\w)"
)
_SHA256_RE = re.compile(r"(?<![a-fA-F0-9])[a-fA-F0-9]{64}(?![a-fA-F0-9])")
_SHA1_RE = re.compile(r"(?<![a-fA-F0-9])[a-fA-F0-9]{40}(?![a-fA-F0-9])")
_MD5_RE = re.compile(r"(?<![a-fA-F0-9])[a-fA-F0-9]{32}(?![a-fA-F0-9])")

_FILE_EXTENSION_TLDS = {
    "pdf", "txt", "md", "markdown", "png", "jpg", "jpeg", "gif", "bmp", "svg",
    "exe", "dll", "sys", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv",
    "json", "xml", "html", "htm", "php", "js", "css", "py", "sh", "ps1", "bat",
    "zip", "rar", "7z", "gz", "tar", "bz2", "log", "bin", "dat", "tmp", "iso",
    "yaml", "yml", "ini", "cfg", "conf", "env", "sql", "db",
}

_DEFANG_SUBS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"hxxps", re.IGNORECASE), "https"),
    (re.compile(r"hxxp", re.IGNORECASE), "http"),
    (re.compile(r"\[://\]"), "://"),
    (re.compile(r"\[:\]"), ":"),
    (re.compile(r"\[\.\]"), "."),
    (re.compile(r"\(\.\)"), "."),
    (re.compile(r"\{\.\}"), "."),
    (re.compile(r"\[dot\]", re.IGNORECASE), "."),
    (re.compile(r"\(dot\)", re.IGNORECASE), "."),
)


@dataclass(slots=True)
class _Found:
    ioc_type: IOCType
    value: str
    normalized: str
    start: int
    end: int
    confidence: float


def refang(text: str) -> str:
    """Undo common CTI defanging so indicators can be extracted uniformly."""
    result = text
    for pattern, replacement in _DEFANG_SUBS:
        result = pattern.sub(replacement, result)
    return result


def defang_value(value: str, ioc_type: IOCType) -> str:
    if ioc_type is IOCType.URL:
        defanged = re.sub(r"^https", "hxxps", value, flags=re.IGNORECASE)
        defanged = re.sub(r"^http(?!s)", "hxxp", defanged, flags=re.IGNORECASE)
        scheme_end = defanged.find("://")
        if scheme_end == -1:
            return defanged.replace(".", "[.]")
        return defanged[: scheme_end + 3] + defanged[scheme_end + 3 :].replace(".", "[.]")
    if ioc_type in (IOCType.IPV4, IOCType.DOMAIN):
        return value.replace(".", "[.]")
    return value


def _trim_url(url: str) -> str:
    return url.rstrip(".,;:!?'\")]}")


def _is_plausible_domain(domain: str) -> bool:
    tld = domain.rsplit(".", 1)[-1].lower()
    if tld in _FILE_EXTENSION_TLDS:
        return False
    if re.fullmatch(r"[\d.]+", domain):
        return False
    if len(domain) > 253:
        return False
    return all(0 < len(label) <= 63 for label in domain.split("."))


def extract_iocs(text: str) -> list[ExtractedIOC]:
    """Extract IPv4, domains, URLs and MD5/SHA-1/SHA-256 hashes from raw text."""
    normalized_text = refang(text)
    found: dict[tuple[IOCType, str], _Found] = {}
    occupied_spans: list[tuple[int, int]] = []

    for match in _URL_RE.finditer(normalized_text):
        url = _trim_url(match.group(0))
        if len(url) <= 8:
            continue
        key = (IOCType.URL, url.lower())
        found[key] = _Found(
            ioc_type=IOCType.URL,
            value=url,
            normalized=url,
            start=match.start(),
            end=match.start() + len(url),
            confidence=0.88,
        )
        occupied_spans.append((match.start(), match.start() + len(url)))

    def inside_span(start: int, end: int) -> bool:
        return any(span_start <= start and end <= span_end for span_start, span_end in occupied_spans)

    for match in _IPV4_RE.finditer(normalized_text):
        if inside_span(match.start(), match.end()):
            continue
        ip = match.group(0)
        found[(IOCType.IPV4, ip)] = _Found(
            ioc_type=IOCType.IPV4,
            value=ip,
            normalized=ip,
            start=match.start(),
            end=match.end(),
            confidence=0.86,
        )

    for match in _DOMAIN_RE.finditer(normalized_text):
        if inside_span(match.start(), match.end()):
            continue
        domain = match.group(0).rstrip(".").lower()
        if not _is_plausible_domain(domain):
            continue
        found[(IOCType.DOMAIN, domain)] = _Found(
            ioc_type=IOCType.DOMAIN,
            value=match.group(0).rstrip("."),
            normalized=domain,
            start=match.start(),
            end=match.end(),
            confidence=0.72,
        )

    for ioc_type, pattern, confidence in (
        (IOCType.SHA256, _SHA256_RE, 0.95),
        (IOCType.SHA1, _SHA1_RE, 0.93),
        (IOCType.MD5, _MD5_RE, 0.90),
    ):
        for match in pattern.finditer(normalized_text):
            digest = match.group(0).lower()
            found[(ioc_type, digest)] = _Found(
                ioc_type=ioc_type,
                value=match.group(0),
                normalized=digest,
                start=match.start(),
                end=match.end(),
                confidence=confidence,
            )

    results: list[ExtractedIOC] = []
    for found_item in sorted(found.values(), key=lambda item: (item.start, item.ioc_type.value)):
        results.append(
            ExtractedIOC(
                value=found_item.value,
                normalized_value=found_item.normalized,
                defanged=defang_value(found_item.normalized, found_item.ioc_type),
                ioc_type=found_item.ioc_type,
                confidence=found_item.confidence,
                context=extract_context(normalized_text, found_item.start, found_item.end),
            )
        )
    return results


async def persist_document_iocs(
    db: AsyncSession,
    document: Document,
    chunks: list[Chunk],
) -> tuple[int, int]:
    """Extract and persist document IOCs, de-duplicated per document.

    Returns ``(created, skipped)``. Caller owns the transaction.
    """
    existing = set(
        (
            await db.execute(
                select(IOC.ioc_type, IOC.normalized_value).where(IOC.document_id == document.id)
            )
        ).all()
    )
    created = 0
    skipped = 0
    for chunk in chunks:
        for extracted in extract_iocs(chunk.text):
            key = (extracted.ioc_type, extracted.normalized_value)
            if key in existing:
                skipped += 1
                continue
            existing.add(key)
            db.add(
                IOC(
                    value=extracted.value,
                    normalized_value=extracted.normalized_value,
                    defanged=extracted.defanged,
                    ioc_type=extracted.ioc_type,
                    document_id=document.id,
                    chunk_id=chunk.id,
                    confidence=extracted.confidence,
                    context=extracted.context,
                )
            )
            created += 1
    if created:
        await db.flush()
    return created, skipped


def ioc_type_sort_key(value: str) -> int:
    order = [IOCType.IPV4, IOCType.DOMAIN, IOCType.URL, IOCType.SHA256, IOCType.SHA1, IOCType.MD5]
    try:
        return order.index(IOCType(value))
    except ValueError:
        return len(order)
