from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4

from workspace_protocol import WorkspaceManifest

MAX_TURNS_KEPT = 12
MAX_AUDIT_KEPT = 50


@dataclass
class AgentTurnRecord:
    """Un tour d'agent exécuté : sert de mémoire conversationnelle compacte."""

    turn_id: str
    instruction: str
    intent: str
    assistant_message: str
    action_types: list[str] = field(default_factory=list)
    validation_accepted: bool = True
    warnings: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class WorkspaceSession:
    id: str
    manifest: WorkspaceManifest
    created_at: datetime
    turns: list[AgentTurnRecord] = field(default_factory=list)
    audit: list[dict] = field(default_factory=list)


class WorkspaceStore:
    """SESSION RUNTIME éphémère — Phase Database 9 (SUITE.md §10-§12).

    Frontière persisté/runtime (décision de consolidation) :
    - SUPABASE est la source de vérité métier (examinations, images,
      annotations, measurements, analysis_runs, reports) ;
    - ce store NE DOIT PAS dupliquer ces données comme base parallèle ;
    - il conserve uniquement l'état d'exécution temporaire :
        * manifest projeté par le client (contexte de validation des plans IA),
          considéré comme dérivé (C) — jamais modifié côté serveur ;
        * turns (mémoire conversationnelle agent, bornée à MAX_TURNS_KEPT) ;
        * audit (journal borné à MAX_AUDIT_KEPT) ;
    - toute donnée disparue au redémarrage est acceptable : c'est du runtime ;
    - les routes utilisent ce store uniquement comme CONTEXTE
      (workspace_id/image_id → manifeste) ; les données médicales persistées
      restent servies par PostgreSQL/Storage.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, WorkspaceSession] = {}
        self._lock = Lock()

    def create(self, manifest: WorkspaceManifest) -> WorkspaceSession:
        session = WorkspaceSession(id=str(uuid4()), manifest=manifest, created_at=datetime.now(UTC))
        with self._lock:
            self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> WorkspaceSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def replace(self, session_id: str, manifest: WorkspaceManifest) -> WorkspaceSession | None:
        with self._lock:
            current = self._sessions.get(session_id)
            if current is None:
                return None
            session = WorkspaceSession(
                id=session_id,
                manifest=manifest,
                created_at=current.created_at,
                turns=current.turns,
                audit=current.audit,
            )
            self._sessions[session_id] = session
            return session

    def record_turn(self, session_id: str, turn: AgentTurnRecord) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.turns.append(turn)
            del session.turns[:-MAX_TURNS_KEPT]

    def record_audit(self, session_id: str, entry: dict) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.audit.append(entry)
            del session.audit[:-MAX_AUDIT_KEPT]

    def conversation_turns(self, session_id: str, limit: int = 6) -> list[AgentTurnRecord]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return []
            return list(session.turns[-limit:])