"""MITRE ATT&CK catalogue integrity and application route contract."""

from __future__ import annotations

from app.services.mitre_service import load_catalog


def test_catalog_is_authentic_and_well_formed() -> None:
    catalog = load_catalog()

    assert len(catalog["tactics"]) == 14
    assert len(catalog["techniques"]) >= 140

    tactic_ids = [item["tactic_id"] for item in catalog["tactics"]]
    technique_ids = [item["technique_id"] for item in catalog["techniques"]]

    assert len(tactic_ids) == len(set(tactic_ids))
    assert len(technique_ids) == len(set(technique_ids))

    assert all(tactic_id.startswith("TA") for tactic_id in tactic_ids)
    assert all(technique_id.startswith("T") for technique_id in technique_ids)

    known_tactics = set(tactic_ids)
    for technique in catalog["techniques"]:
        assert technique["tactic"] in known_tactics
        assert technique["name"].strip()
        assert technique["technique_id"].startswith("T")
        # Sub-techniques are valid; dotted IDs are accepted.
        assert "." not in technique["technique_id"] or technique["technique_id"].split(".")[1].isdigit()


def test_every_tactic_has_at_least_one_technique() -> None:
    catalog = load_catalog()
    covered = {item["tactic"] for item in catalog["techniques"]}
    for tactic in catalog["tactics"]:
        assert tactic["tactic_id"] in covered, f"{tactic['name']} has no techniques"


def test_application_exposes_required_routes() -> None:
    from app.main import app

    schema = app.openapi()
    paths = set(schema["paths"])
    required = {
        "/api/health",
        "/api/ready",
        "/api/meta",
        "/api/dashboard",
        "/api/documents",
        "/api/retrieval/search",
        "/api/gemini/generate",
        "/api/gemini/verify-claims",
        "/api/gemini/generations",
        "/api/trust/score",
        "/api/iocs",
        "/api/mitre/matrix",
        "/api/mitre/candidates",
        "/api/audit/logs",
        "/api/audit/verify",
        "/api/evaluation/run",
        "/api/evaluation/batches",
    }
    missing = required - paths
    assert not missing, f"missing routes: {sorted(missing)}"

    assert schema["info"]["title"]
    assert "/api/gemini/generate" in schema["paths"]


def test_openapi_does_not_leak_secrets() -> None:
    from app.main import app

    blob = str(app.openapi()).lower()
    assert "google_api_key" not in blob
    assert "api_key" not in blob
    assert "database_url" not in blob
