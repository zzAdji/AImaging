from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4

from workspace_protocol import WorkspaceManifest


@dataclass(frozen=True)
class WorkspaceSession:
    id: str
    manifest: WorkspaceManifest
    created_at: datetime


class WorkspaceStore:
    """Stockage éphémère en mémoire, sans donnée persistée sur disque."""

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
            session = WorkspaceSession(id=session_id, manifest=manifest, created_at=current.created_at)
            self._sessions[session_id] = session
            return session
