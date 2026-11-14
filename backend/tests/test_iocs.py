"""IOC extraction, normalisation and safe defanging."""

from __future__ import annotations

from app.models.enums import IOCType
from app.services.ioc_service import defang_value, extract_iocs, refang

SHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
SHA1 = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
MD5 = "5d41402abc4b2a76b9719d911017c592"


def _by_type(items, ioc_type: IOCType) -> list[str]:
    return [item.normalized_value for item in items if item.ioc_type is ioc_type]


def test_extracts_and_normalises_all_supported_types() -> None:
    text = (
        "The actor used hxxps://cdn[.]evil-example[.]com/gate.php?id=7 and 203.0.113[.]25. "
        "Beaconing resolved to c2[.]bad-example[.]net. "
        f"Artifacts: {SHA256} {SHA1} {MD5}."
    )

    items = extract_iocs(text)
    types = {item.ioc_type for item in items}

    assert types == {IOCType.URL, IOCType.IPV4, IOCType.DOMAIN, IOCType.SHA256, IOCType.SHA1, IOCType.MD5}
    assert _by_type(items, IOCType.URL) == ["https://cdn.evil-example.com/gate.php?id=7"]
    assert _by_type(items, IOCType.IPV4) == ["203.0.113.25"]
    assert _by_type(items, IOCType.DOMAIN) == ["c2.bad-example.net"]
    assert _by_type(items, IOCType.SHA256) == [SHA256]
    assert _by_type(items, IOCType.SHA1) == [SHA1]
    assert _by_type(items, IOCType.MD5) == [MD5]


def test_url_host_is_not_duplicated_as_a_domain() -> None:
    items = extract_iocs("Download hxxps://drop[.]evil-example[.]com/a.bin now.")
    domains = _by_type(items, IOCType.DOMAIN)
    assert domains == []
    assert _by_type(items, IOCType.URL) == ["https://drop.evil-example.com/a.bin"]


def test_dedupes_case_insensitively() -> None:
    items = extract_iocs(f"{SHA256.upper()} {SHA256} {MD5.upper()} {MD5}")
    assert len(_by_type(items, IOCType.SHA256)) == 1
    assert len(_by_type(items, IOCType.MD5)) == 1


def test_defangs_indicators_safely() -> None:
    assert defang_value("https://evil.example/path", IOCType.URL) == "hxxps://evil[.]example/path"
    assert defang_value("http://evil.example", IOCType.URL) == "hxxp://evil[.]example"
    assert defang_value("203.0.113.25", IOCType.IPV4) == "203[.]0[.]113[.]25"
    assert defang_value("evil.example", IOCType.DOMAIN) == "evil[.]example"
    assert defang_value(MD5, IOCType.MD5) == MD5


def test_refang_round_trip_variants() -> None:
    assert refang("hxxps://evil[.]example/a") == "https://evil.example/a"
    assert refang("hxxp://evil(.)example/a") == "http://evil.example/a"
    assert refang("evil[dot]example") == "evil.example"
    assert refang("evil(dot)example") == "evil.example"
    assert refang("https[://]evil[.]example") == "https://evil.example"


def test_rejects_file_extensions_and_impossible_ipv4() -> None:
    items = extract_iocs("See report.pdf and notes.md, then 999.1.1.1 and 1.2.3.9999")
    assert _by_type(items, IOCType.IPV4) == []
    assert _by_type(items, IOCType.DOMAIN) == []
    assert all(item.ioc_type is not IOCType.DOMAIN for item in items)


def test_confidence_is_bounded_and_context_is_captured() -> None:
    items = extract_iocs("Command and control at 198.51.100.10 was observed repeatedly.")
    assert items
    for item in items:
        assert 0.0 < item.confidence <= 1.0
        assert item.context
        assert "198.51.100.10" in item.context


def test_empty_text_returns_no_indicators() -> None:
    assert extract_iocs("") == []
    assert extract_iocs("Nothing operationally relevant here.") == []
