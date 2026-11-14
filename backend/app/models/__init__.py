"""ORM model registry – importing this module registers all tables on Base."""

from app.models.answer import Claim, Generation
from app.models.audit import AuditLog
from app.models.document import Chunk, Document
from app.models.enums import (
    CandidateStatus,
    DocumentStatus,
    EvaluationMode,
    InjectionRisk,
    IOCType,
    SourceType,
    TLPLevel,
    TrustBand,
    VerificationStatus,
)
from app.models.evaluation import EvaluationRun
from app.models.ioc import IOC
from app.models.mitre import MitreCandidate, MitreTactic, MitreTechnique

__all__ = [
    "AuditLog",
    "CandidateStatus",
    "Chunk",
    "Claim",
    "Document",
    "DocumentStatus",
    "EvaluationMode",
    "EvaluationRun",
    "Generation",
    "IOC",
    "IOCType",
    "InjectionRisk",
    "MitreCandidate",
    "MitreTactic",
    "MitreTechnique",
    "SourceType",
    "TLPLevel",
    "TrustBand",
    "VerificationStatus",
]
