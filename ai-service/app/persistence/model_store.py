# app/persistence/model_store.py
# ============================================================
# Zero Plus — AI Service
# Model persistence — fast save/load per org, safe, atomic
# ============================================================

from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Type, Union

import joblib

from app.config import Settings, get_settings
from app.models.base_model import BaseOnlineModel, ModelKind, ModelMeta

logger = logging.getLogger("zero-plus-ai.model_store")

PathLike = Union[str, Path]


# =============================================================================
# Path layout
#
#   {MODEL_STORE_PATH}/
#     org_{org_id}/
#       anomaly.joblib          # full export_state payload
#       anomaly.meta.json       # light meta for quick listing (no algorithm)
#       surge.joblib
#       surge.meta.json
#       _index.json             # optional org-level index
# =============================================================================


def _safe_org_dir_name(org_id: str) -> str:
    """Filesystem-safe org folder name."""
    raw = (org_id or "unknown").strip() or "unknown"
    # keep readable chars; hash if weird/long
    cleaned = "".join(c if c.isalnum() or c in "-_" else "_" for c in raw)
    if len(cleaned) > 80 or cleaned != raw:
        h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
        cleaned = f"{cleaned[:40]}_{h}" if cleaned else h
    return f"org_{cleaned}"


def _kind_stem(kind: Union[ModelKind, str]) -> str:
    if isinstance(kind, ModelKind):
        return kind.value
    return str(kind).strip().lower() or "generic"


@dataclass
class StoreEntry:
    """Light record returned by list/load operations."""

    org_id: str
    kind: str
    path: str
    meta_path: Optional[str]
    exists: bool
    size_bytes: int = 0
    mtime: float = 0.0
    meta: Optional[Dict[str, Any]] = None


class ModelStore:
    """
    Disk persistence for Zero Plus online models.

    Features:
      - One directory per org
      - One joblib blob per model kind (anomaly / surge / …)
      - Side-car JSON meta for fast inventory without loading full model
      - Atomic writes (temp file + os.replace) to avoid corrupt files on crash
      - Thread-safe per-store lock
      - Optional save throttling via should_save(n_learned, every_n)
      - Safe load: returns None on missing/corrupt instead of crashing the service
    """

    def __init__(
        self,
        root: Optional[PathLike] = None,
        *,
        settings: Optional[Settings] = None,
        compress: int = 3,
    ) -> None:
        self.settings = settings or get_settings()
        self.root = Path(root or self.settings.model_store_path).resolve()
        self.compress = int(compress)
        self.save_every_n = int(getattr(self.settings, "model_save_every_n", 50) or 50)
        self._lock = threading.RLock()
        self._ensure_root()

    # ------------------------------------------------------------------
    # Paths
    # ------------------------------------------------------------------

    def _ensure_root(self) -> None:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.error("Cannot create model store root %s: %s", self.root, exc)
            raise

    def org_dir(self, org_id: str) -> Path:
        d = self.root / _safe_org_dir_name(org_id)
        return d

    def model_path(self, org_id: str, kind: Union[ModelKind, str]) -> Path:
        return self.org_dir(org_id) / f"{_kind_stem(kind)}.joblib"

    def meta_path(self, org_id: str, kind: Union[ModelKind, str]) -> Path:
        return self.org_dir(org_id) / f"{_kind_stem(kind)}.meta.json"

    def index_path(self, org_id: str) -> Path:
        return self.org_dir(org_id) / "_index.json"

    # ------------------------------------------------------------------
    # Save
    # ------------------------------------------------------------------

    def save(self, model: BaseOnlineModel, *, force: bool = False) -> bool:
        """
        Persist a model instance (export_state → joblib + meta json).
        Returns True on success.
        """
        if model is None:
            return False

        org_id = model.org_id
        kind = model.kind

        with self._lock:
            try:
                odir = self.org_dir(org_id)
                odir.mkdir(parents=True, exist_ok=True)

                payload = model.export_state()
                # stamp store metadata
                payload["_store"] = {
                    "saved_at": time.time(),
                    "org_id": org_id,
                    "kind": kind.value if isinstance(kind, ModelKind) else str(kind),
                    "format": "zero-plus-model-v1",
                }

                blob_path = self.model_path(org_id, kind)
                ok = self._atomic_joblib_dump(payload, blob_path)
                if not ok:
                    return False

                meta = model.meta.to_dict() if hasattr(model, "meta") else {}
                meta["_store"] = payload["_store"]
                meta["blob_path"] = str(blob_path)
                meta["blob_size"] = blob_path.stat().st_size if blob_path.exists() else 0
                self._atomic_json_dump(meta, self.meta_path(org_id, kind))
                self._touch_index(org_id, kind, meta)

                if hasattr(model, "meta") and hasattr(model.meta, "touch_save"):
                    model.meta.touch_save()

                logger.info(
                    "Saved model org=%s kind=%s path=%s size=%s",
                    org_id,
                    _kind_stem(kind),
                    blob_path,
                    meta.get("blob_size"),
                )
                return True
            except Exception as exc:
                logger.exception("save failed org=%s: %s", org_id, exc)
                return False

    def should_save(self, model: BaseOnlineModel, *, force: bool = False) -> bool:
        """
        Throttle disk writes: save every N successful learns (or force).
        """
        if force:
            return True
        n = int(getattr(model, "n_learned", 0) or 0)
        every = max(1, self.save_every_n)
        return n > 0 and n % every == 0

    def save_if_needed(self, model: BaseOnlineModel, *, force: bool = False) -> bool:
        if self.should_save(model, force=force):
            return self.save(model, force=force)
        return False

    # ------------------------------------------------------------------
    # Load
    # ------------------------------------------------------------------

    def load_payload(
        self,
        org_id: str,
        kind: Union[ModelKind, str],
    ) -> Optional[Dict[str, Any]]:
        """Load raw export_state dict, or None if missing/corrupt."""
        path = self.model_path(org_id, kind)
        if not path.exists():
            return None
        with self._lock:
            try:
                payload = joblib.load(path)
                if not isinstance(payload, dict):
                    logger.warning("Corrupt model payload (not dict): %s", path)
                    return None
                return payload
            except Exception as exc:
                logger.warning("Failed to load %s: %s", path, exc)
                return None

    def load_into(
        self,
        model: BaseOnlineModel,
        *,
        kind: Optional[Union[ModelKind, str]] = None,
    ) -> bool:
        """
        Load disk state into an existing model instance via import_state.
        """
        org_id = model.org_id
        use_kind = kind or model.kind
        payload = self.load_payload(org_id, use_kind)
        if payload is None:
            return False
        try:
            # strip store envelope if present — import_state expects model format
            model.import_state(payload)
            logger.info(
                "Loaded model into instance org=%s kind=%s n_learned=%s",
                org_id,
                _kind_stem(use_kind),
                getattr(model, "n_learned", "?"),
            )
            return True
        except Exception as exc:
            logger.exception("import_state failed org=%s: %s", org_id, exc)
            return False

    def exists(self, org_id: str, kind: Union[ModelKind, str]) -> bool:
        return self.model_path(org_id, kind).exists()

    # ------------------------------------------------------------------
    # Meta / inventory (fast, no full model load)
    # ------------------------------------------------------------------

    def load_meta(self, org_id: str, kind: Union[ModelKind, str]) -> Optional[Dict[str, Any]]:
        path = self.meta_path(org_id, kind)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("meta read failed %s: %s", path, exc)
            return None

    def list_orgs(self) -> List[str]:
        if not self.root.exists():
            return []
        orgs: List[str] = []
        for p in sorted(self.root.iterdir()):
            if p.is_dir() and p.name.startswith("org_"):
                # best-effort reverse: read index or any meta for org_id field
                org_id = self._resolve_org_id_from_dir(p)
                orgs.append(org_id)
        return orgs

    def list_entries(self, org_id: Optional[str] = None) -> List[StoreEntry]:
        entries: List[StoreEntry] = []
        org_ids = [org_id] if org_id else self.list_orgs()
        for oid in org_ids:
            odir = self.org_dir(oid)
            if not odir.exists():
                continue
            for blob in odir.glob("*.joblib"):
                kind = blob.stem
                mpath = odir / f"{kind}.meta.json"
                meta = None
                if mpath.exists():
                    try:
                        meta = json.loads(mpath.read_text(encoding="utf-8"))
                    except Exception:
                        meta = None
                st = blob.stat()
                entries.append(
                    StoreEntry(
                        org_id=oid,
                        kind=kind,
                        path=str(blob),
                        meta_path=str(mpath) if mpath.exists() else None,
                        exists=True,
                        size_bytes=st.st_size,
                        mtime=st.st_mtime,
                        meta=meta,
                    )
                )
        return entries

    def _resolve_org_id_from_dir(self, odir: Path) -> str:
        idx = odir / "_index.json"
        if idx.exists():
            try:
                data = json.loads(idx.read_text(encoding="utf-8"))
                if data.get("org_id"):
                    return str(data["org_id"])
            except Exception:
                pass
        for meta_file in odir.glob("*.meta.json"):
            try:
                data = json.loads(meta_file.read_text(encoding="utf-8"))
                if data.get("org_id"):
                    return str(data["org_id"])
            except Exception:
                continue
        # fallback: folder name without org_ prefix
        name = odir.name
        return name[4:] if name.startswith("org_") else name

    # ------------------------------------------------------------------
    # Delete / maintenance
    # ------------------------------------------------------------------

    def delete(self, org_id: str, kind: Optional[Union[ModelKind, str]] = None) -> int:
        """
        Delete one kind or all kinds for an org.
        Returns number of files removed.
        """
        removed = 0
        with self._lock:
            odir = self.org_dir(org_id)
            if not odir.exists():
                return 0
            if kind is not None:
                targets = [
                    self.model_path(org_id, kind),
                    self.meta_path(org_id, kind),
                ]
            else:
                targets = list(odir.glob("*"))
            for t in targets:
                try:
                    if t.is_file():
                        t.unlink()
                        removed += 1
                except OSError as exc:
                    logger.warning("delete failed %s: %s", t, exc)
            # remove dir if empty
            try:
                if odir.exists() and not any(odir.iterdir()):
                    odir.rmdir()
            except OSError:
                pass
        return removed

    def disk_usage(self) -> Dict[str, Any]:
        total = 0
        files = 0
        if self.root.exists():
            for p in self.root.rglob("*"):
                if p.is_file():
                    files += 1
                    try:
                        total += p.stat().st_size
                    except OSError:
                        pass
        return {
            "root": str(self.root),
            "files": files,
            "bytes": total,
            "mb": round(total / (1024 * 1024), 3),
        }

    # ------------------------------------------------------------------
    # Atomic I/O
    # ------------------------------------------------------------------

    def _atomic_joblib_dump(self, obj: Any, dest: Path) -> bool:
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            dir=str(dest.parent),
            prefix=f".{dest.stem}.",
            suffix=".tmp",
        )
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            joblib.dump(obj, tmp_path, compress=self.compress)
            os.replace(str(tmp_path), str(dest))
            return True
        except Exception as exc:
            logger.exception("atomic joblib dump failed → %s: %s", dest, exc)
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass
            return False

    def _atomic_json_dump(self, obj: Any, dest: Path) -> bool:
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            dir=str(dest.parent),
            prefix=f".{dest.stem}.",
            suffix=".tmp",
        )
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            tmp_path.write_text(
                json.dumps(obj, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            os.replace(str(tmp_path), str(dest))
            return True
        except Exception as exc:
            logger.warning("atomic json dump failed → %s: %s", dest, exc)
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass
            return False

    def _touch_index(self, org_id: str, kind: Union[ModelKind, str], meta: Dict[str, Any]) -> None:
        path = self.index_path(org_id)
        index: Dict[str, Any] = {"org_id": org_id, "models": {}, "updated_at": time.time()}
        if path.exists():
            try:
                index = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(index, dict):
                    index = {"org_id": org_id, "models": {}, "updated_at": time.time()}
            except Exception:
                pass
        models = index.setdefault("models", {})
        models[_kind_stem(kind)] = {
            "kind": _kind_stem(kind),
            "n_learned": meta.get("n_learned"),
            "state": meta.get("state"),
            "version": meta.get("version"),
            "saved_at": (meta.get("_store") or {}).get("saved_at"),
            "blob_size": meta.get("blob_size"),
        }
        index["org_id"] = org_id
        index["updated_at"] = time.time()
        self._atomic_json_dump(index, path)


# =============================================================================
# Module singleton
# =============================================================================

_store: Optional[ModelStore] = None
_store_lock = threading.Lock()


def get_model_store(settings: Optional[Settings] = None) -> ModelStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = ModelStore(settings=settings)
        return _store


def init_model_store(settings: Optional[Settings] = None) -> ModelStore:
    global _store
    with _store_lock:
        _store = ModelStore(settings=settings)
        return _store


__all__ = [
    "ModelStore",
    "StoreEntry",
    "get_model_store",
    "init_model_store",
]