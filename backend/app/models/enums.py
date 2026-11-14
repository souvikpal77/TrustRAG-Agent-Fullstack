"""Shared enumerations used by ORM models and Pydantic schemas."""

from __future__ import annotations

from enum import Enum


class TLPLevel(str, Enum):
    WHITE = "WHITE"
    GREEN = "GREEN"
    AMBER = "AMBER"
    RED = "RED"


class SourceType(str, Enum):
    PDF = "PDF"
    TXT = "TXT"
    MARKDOWN = "MARKDOWN"


class DocumentStatus(str, Enum):
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"


class IOCType(str, Enum):
    IPV4 = "IPV4"
    DOMAIN = "DOMAIN"
    URL = "URL"
    SHA256 = "SHA256"
    SHA1 = "SHA1"
    MD5 = "MD5"


class VerificationStatus(str, Enum):
    SUPPORTED = "SUPPORTED"
    CONTRADICTED = "CONTRADICTED"
    UNRESOLVED = "UNRESOLVED"


class CandidateStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class EvaluationMode(str, Enum):
    STANDALONE = "STANDALONE"
    STANDARD_RAG = "STANDARD_RAG"
    TRUSTRAG = "TRUSTRAG"


class InjectionRisk(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class TrustBand(str, Enum):
    ABSTAIN = "ABSTAIN"
    REVIEW = "REVIEW"
    TRUSTED = "TRUSTED"
