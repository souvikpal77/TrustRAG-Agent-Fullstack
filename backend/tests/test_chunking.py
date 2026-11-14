"""Section-aware chunking behaviour."""

from __future__ import annotations

from app.services.chunking import PageText, chunk_document


def _pages() -> list[PageText]:
    return [
        PageText(
            page_number=1,
            text=(
                "# Executive Summary\n"
                "APT-Example targeted three victims in 2025. The campaign used phishing lures.\n"
                "\n"
                "## Technical Analysis\n"
                "The loader resolves cdn.evil.example before dropping a payload. "
                "Persistence is achieved through a scheduled task.\n"
            ),
        ),
        PageText(
            page_number=2,
            text=(
                "## Indicators of Compromise\n"
                "203.0.113.25\n"
                "hxxps://cdn[.]evil[.]example/gate.php\n"
                "5d41402abc4b2a76b9719d911017c592\n"
            ),
        ),
    ]


def test_detects_markdown_sections_and_breadcrumb() -> None:
    chunks = chunk_document(_pages(), chunk_size=600, chunk_overlap=80, min_chunk_size=40)

    headers = [chunk.section_header for chunk in chunks]
    assert any(header and "Executive Summary" in header for header in headers)
    technical = next(chunk for chunk in chunks if chunk.section_header and "Technical Analysis" in chunk.section_header)
    # The breadcrumb retains the parent heading.
    assert technical.section_header == "Executive Summary > Technical Analysis"
    assert technical.text.startswith("Executive Summary > Technical Analysis\n")


def test_records_page_ranges_and_refs() -> None:
    chunks = chunk_document(_pages(), chunk_size=400, chunk_overlap=60, min_chunk_size=20)

    assert chunks
    assert all(chunk.page_refs for chunk in chunks)
    assert chunks[0].page_start == 1
    assert chunks[-1].page_end == 2
    assert max(chunk.page_refs[-1] for chunk in chunks) == 2


def test_chunks_respect_size_budget_and_indexes_are_sequential() -> None:
    size = 450
    chunks = chunk_document(_pages(), chunk_size=size, chunk_overlap=100, min_chunk_size=30)

    assert [chunk.index for chunk in chunks] == list(range(len(chunks)))
    for chunk in chunks:
        # Body is bounded by chunk_size; the header prefix is additional context.
        body = chunk.text.split("\n", 1)[-1]
        assert len(body) <= size + 1


def test_hard_splits_oversized_single_line() -> None:
    long_line = "A" * 5000
    chunks = chunk_document(
        [PageText(page_number=1, text=long_line)],
        chunk_size=500,
        chunk_overlap=50,
        min_chunk_size=10,
    )

    assert len(chunks) >= 10
    assert all(chunk.char_count <= 501 for chunk in chunks)
    assert sum(chunk.char_count for chunk in chunks) >= len(long_line)


def test_overlap_repeats_context_between_windows() -> None:
    sentence = "The malware beaconed to the command-and-control server at regular intervals. "
    text = sentence * 40
    chunks = chunk_document(
        [PageText(page_number=1, text=text)],
        chunk_size=360,
        chunk_overlap=120,
        min_chunk_size=20,
    )

    assert len(chunks) > 2
    # Consecutive windows should share at least one content word because of overlap.
    for previous, current in zip(chunks, chunks[1:]):
        previous_tail = previous.text.split()[-8:]
        current_head = current.text.split()[:20]
        assert set(previous_tail) & set(current_head)


def test_zero_chunk_size_is_rejected() -> None:
    try:
        chunk_document([PageText(page_number=1, text="hello")], chunk_size=0)
    except ValueError as exc:
        assert "positive" in str(exc)
    else:  # pragma: no cover - defensive
        raise AssertionError("chunk_document should reject a non-positive chunk size")
