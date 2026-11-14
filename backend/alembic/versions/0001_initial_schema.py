"""initial TrustRAG schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-14 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    # ------------------------------------------------------------------ documents
    op.create_table(
        "documents",
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=False),
        sa.Column("tlp", sa.String(length=16), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("provenance", sa.String(length=512), nullable=False),
        sa.Column("authority_score", sa.Float(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("doc_metadata", JSONB, nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_documents"),
    )
    op.create_index("ix_documents_sha256", "documents", ["sha256"], unique=True)
    op.create_index("ix_documents_created_at", "documents", ["created_at"], unique=False)
    op.create_index(
        "ix_documents_tlp_created", "documents", ["tlp", "created_at"], unique=False
    )
    op.create_index(
        "ix_documents_status_created", "documents", ["status", "created_at"], unique=False
    )

    # ------------------------------------------------------------- MITRE tactics
    op.create_table(
        "mitre_tactics",
        sa.Column("tactic_id", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("short_name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_mitre_tactics"),
        sa.UniqueConstraint("short_name", name="uq_mitre_tactics_short_name"),
    )
    op.create_index(
        "ix_mitre_tactics_tactic_id", "mitre_tactics", ["tactic_id"], unique=True
    )

    # --------------------------------------------------------- MITRE techniques
    op.create_table(
        "mitre_techniques",
        sa.Column("technique_id", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("tactic_id", sa.Uuid(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("parent_technique_id", sa.String(length=16), nullable=True),
        sa.Column("is_subtechnique", sa.Boolean(), nullable=False),
        sa.Column("platforms", JSONB, nullable=False),
        sa.Column("keywords", JSONB, nullable=False),
        sa.Column("url", sa.String(length=512), nullable=False),
        sa.PrimaryKeyConstraint("technique_id", name="pk_mitre_techniques"),
        sa.ForeignKeyConstraint(
            ["tactic_id"],
            ["mitre_tactics.id"],
            name="fk_mitre_techniques_tactic_id_mitre_tactics",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["parent_technique_id"],
            ["mitre_techniques.technique_id"],
            name="fk_mitre_techniques_parent_technique_id_mitre_techniques",
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_mitre_techniques_tactic", "mitre_techniques", ["tactic_id"], unique=False
    )
    op.create_index(
        "ix_mitre_techniques_parent",
        "mitre_techniques",
        ["parent_technique_id"],
        unique=False,
    )

    # -------------------------------------------------------------------- chunks
    op.create_table(
        "chunks",
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("token_estimate", sa.Integer(), nullable=False),
        sa.Column("section_header", sa.String(length=512), nullable=True),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("embedding", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_chunks"),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_chunks_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "document_id", "chunk_index", name="uq_chunks_document_index"
        ),
    )
    op.create_index("ix_chunks_document_id", "chunks", ["document_id"], unique=False)
    op.create_index("ix_chunks_created_at", "chunks", ["created_at"], unique=False)
    op.create_index(
        "ix_chunks_document_page", "chunks", ["document_id", "page_start"], unique=False
    )

    # --------------------------------------------------------------- generations
    op.create_table(
        "generations",
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=False),
        sa.Column("model_used", sa.String(length=128), nullable=False),
        sa.Column("retrieval_strategy", sa.String(length=64), nullable=False),
        sa.Column("degraded", sa.Boolean(), nullable=False),
        sa.Column("injection_risk", sa.String(length=16), nullable=False),
        sa.Column("evidence_chunk_ids", JSONB, nullable=False),
        sa.Column("evidence_snapshot", JSONB, nullable=False),
        sa.Column("document_ids", JSONB, nullable=False),
        sa.Column("trust_score", sa.Float(), nullable=True),
        sa.Column("trust_breakdown", JSONB, nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_generations"),
    )
    op.create_index(
        "ix_generations_created_at", "generations", ["created_at"], unique=False
    )
    op.create_index(
        "ix_generations_created_trust",
        "generations",
        ["created_at", "trust_score"],
        unique=False,
    )

    # -------------------------------------------------------------------- claims
    op.create_table(
        "claims",
        sa.Column("generation_id", sa.Uuid(), nullable=False),
        sa.Column("claim_index", sa.Integer(), nullable=False),
        sa.Column("claim_text", sa.Text(), nullable=False),
        sa.Column("verification_status", sa.String(length=20), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("entailment_score", sa.Float(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("evidence_chunk_ids", JSONB, nullable=False),
        sa.Column("verification_meta", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_claims"),
        sa.ForeignKeyConstraint(
            ["generation_id"],
            ["generations.id"],
            name="fk_claims_generation_id_generations",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_claims_generation_id", "claims", ["generation_id"], unique=False
    )
    op.create_index("ix_claims_created_at", "claims", ["created_at"], unique=False)
    op.create_index(
        "ix_claims_generation_status",
        "claims",
        ["generation_id", "verification_status"],
        unique=False,
    )
    op.create_index(
        "ix_claims_status_created",
        "claims",
        ["verification_status", "created_at"],
        unique=False,
    )

    # ----------------------------------------------------------------------- iocs
    op.create_table(
        "iocs",
        sa.Column("value", sa.String(length=2048), nullable=False),
        sa.Column("normalized_value", sa.String(length=2048), nullable=False),
        sa.Column("defanged", sa.String(length=2048), nullable=False),
        sa.Column("ioc_type", sa.String(length=16), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("chunk_id", sa.Uuid(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_iocs"),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_iocs_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["chunk_id"],
            ["chunks.id"],
            name="fk_iocs_chunk_id_chunks",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "normalized_value",
            "ioc_type",
            "document_id",
            name="uq_iocs_value_type_document",
        ),
    )
    op.create_index("ix_iocs_normalized_value", "iocs", ["normalized_value"], unique=False)
    op.create_index("ix_iocs_document_id", "iocs", ["document_id"], unique=False)
    op.create_index("ix_iocs_chunk_id", "iocs", ["chunk_id"], unique=False)
    op.create_index("ix_iocs_created_at", "iocs", ["created_at"], unique=False)
    op.create_index(
        "ix_iocs_type_value", "iocs", ["ioc_type", "normalized_value"], unique=False
    )
    op.create_index(
        "ix_iocs_created_type", "iocs", ["created_at", "ioc_type"], unique=False
    )

    # ------------------------------------------------------------ MITRE candidates
    op.create_table(
        "mitre_candidates",
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("technique_id", sa.String(length=16), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("evidence_snippet", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reviewed_by", sa.String(length=128), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_mitre_candidates"),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_mitre_candidates_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["technique_id"],
            ["mitre_techniques.technique_id"],
            name="fk_mitre_candidates_technique_id_mitre_techniques",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "document_id", "technique_id", name="uq_mitre_candidates_doc_tech"
        ),
    )
    op.create_index(
        "ix_mitre_candidates_document_id", "mitre_candidates", ["document_id"], unique=False
    )
    op.create_index(
        "ix_mitre_candidates_technique_id",
        "mitre_candidates",
        ["technique_id"],
        unique=False,
    )
    op.create_index(
        "ix_mitre_candidates_status", "mitre_candidates", ["status"], unique=False
    )
    op.create_index(
        "ix_mitre_candidates_created_at", "mitre_candidates", ["created_at"], unique=False
    )
    op.create_index(
        "ix_mitre_candidates_status_confidence",
        "mitre_candidates",
        ["status", "confidence"],
        unique=False,
    )

    # ---------------------------------------------------------------- audit logs
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("actor", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column("prev_hash", sa.String(length=64), nullable=False),
        sa.Column("entry_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
        sa.UniqueConstraint("entry_hash", name="uq_audit_logs_entry_hash"),
    )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"], unique=False)
    op.create_index(
        "ix_audit_logs_action_created",
        "audit_logs",
        ["action", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id"], unique=False
    )

    # ----------------------------------------------------------- evaluation runs
    op.create_table(
        "evaluation_runs",
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=False),
        sa.Column("model_used", sa.String(length=128), nullable=False),
        sa.Column("grounded_claims", sa.Integer(), nullable=False),
        sa.Column("contradicted_claims", sa.Integer(), nullable=False),
        sa.Column("unresolved_claims", sa.Integer(), nullable=False),
        sa.Column("total_claims", sa.Integer(), nullable=False),
        sa.Column("trust_score", sa.Float(), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column("degraded", sa.Boolean(), nullable=False),
        sa.Column("document_ids", JSONB, nullable=False),
        sa.Column("metrics", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_evaluation_runs"),
    )
    op.create_index(
        "ix_evaluation_runs_batch_id", "evaluation_runs", ["batch_id"], unique=False
    )
    op.create_index(
        "ix_evaluation_runs_created_at", "evaluation_runs", ["created_at"], unique=False
    )
    op.create_index(
        "ix_evaluation_runs_batch_mode",
        "evaluation_runs",
        ["batch_id", "mode"],
        unique=False,
    )
    op.create_index(
        "ix_evaluation_runs_created_mode",
        "evaluation_runs",
        ["created_at", "mode"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("evaluation_runs")
    op.drop_table("audit_logs")
    op.drop_table("mitre_candidates")
    op.drop_table("iocs")
    op.drop_table("claims")
    op.drop_table("generations")
    op.drop_table("chunks")
    op.drop_table("mitre_techniques")
    op.drop_table("mitre_tactics")
    op.drop_table("documents")
