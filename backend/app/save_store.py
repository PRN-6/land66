"""Safe save-file storage and validation helpers for land66."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field


SAVES_DIR = Path(__file__).resolve().parent.parent / "saves"
SAVE_FORMAT = "land66-save-v1"
AUTOSAVE_FILENAME = "_autosave.json"
SAFE_SLOT_RE = re.compile(r"[^a-zA-Z0-9_-]+")


class SaveSlotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=64)


class LoadSavePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    world: dict


def sanitize_slot_name(name: str) -> str:
    """Convert a user-supplied save name into a path-safe filename stem."""
    cleaned = SAFE_SLOT_RE.sub("-", name.strip()).strip("-_")[:48]
    if not cleaned:
        raise ValueError("Save name must contain at least one letter or digit")
    return cleaned.lower()


def _resolve_slot_path(slot: str) -> Path:
    safe = sanitize_slot_name(slot)
    SAVES_DIR.mkdir(parents=True, exist_ok=True)
    root = SAVES_DIR.resolve()
    target = (root / f"{safe}.json").resolve()
    if target.parent != root:
        raise ValueError("Invalid save slot path")
    return target


def summarize_save(slot: str, payload: dict, size_bytes: int = 0) -> dict:
    """Extract compact UI metadata from a save payload without shipping all 24k voxels."""
    sim_elapsed = float(payload.get("elapsed", 93.6))
    day = int(sim_elapsed // 360.0) + 1
    tod = (sim_elapsed % 360.0) / 360.0
    minutes = int(tod * 24 * 60)
    clock_str = f"{minutes // 60:02}:{minutes % 60:02}"
    agents = payload.get("agents") or []
    entities = payload.get("entities") or []
    return {
        "slot": slot,
        "name": str(payload.get("name") or slot),
        "saved_at": str(payload.get("saved_at") or ""),
        "day": day,
        "clock_str": clock_str,
        "tick": int(payload.get("tick", 0)),
        "weather": str(payload.get("weather", "clear")),
        "agents_count": len(agents),
        "entities_count": len(entities),
        "seed": int(payload.get("seed", 66)),
        "size_bytes": size_bytes,
    }


def list_save_slots() -> list[dict]:
    """List saved slots sorted from newest to oldest."""
    if not SAVES_DIR.exists():
        return []
    entries: list[dict] = []
    for path in SAVES_DIR.glob("*.json"):
        if path.name.startswith("_"):
            continue
        try:
            raw = path.read_text(encoding="utf-8")
            payload = json.loads(raw)
            if not isinstance(payload, dict) or "world" not in payload:
                continue
            entries.append(summarize_save(path.stem, payload, len(raw.encode("utf-8"))))
        except Exception:
            continue
    entries.sort(key=lambda item: item.get("saved_at") or "", reverse=True)
    return entries


def write_save_slot(slot_name: str, payload: dict) -> dict:
    """Persist a save payload atomically to disk and return its slot summary."""
    path = _resolve_slot_path(slot_name)
    display_name = slot_name.strip()[:64] or path.stem
    enriched = {
        **payload,
        "format": SAVE_FORMAT,
        "name": display_name,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    serialized = json.dumps(enriched, separators=(",", ":"))
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(serialized, encoding="utf-8")
    tmp_path.replace(path)
    return summarize_save(path.stem, enriched, len(serialized.encode("utf-8")))


def read_save_slot(slot_name: str) -> dict:
    """Read and parse a saved slot payload from disk."""
    path = _resolve_slot_path(slot_name)
    if not path.exists():
        raise FileNotFoundError(f"Save slot '{slot_name}' not found")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Corrupted save file")
    return data


def delete_save_slot(slot_name: str) -> str:
    """Delete a saved slot file and return its sanitized slot stem."""
    path = _resolve_slot_path(slot_name)
    if not path.exists():
        raise FileNotFoundError(f"Save slot '{slot_name}' not found")
    path.unlink()
    return path.stem


def write_runtime_autosave(payload: dict) -> None:
    """Atomically persist the multi-world live session bundle across server restarts."""
    SAVES_DIR.mkdir(parents=True, exist_ok=True)
    path = SAVES_DIR / AUTOSAVE_FILENAME
    serialized = json.dumps(payload, separators=(",", ":"))
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(serialized, encoding="utf-8")
    tmp_path.replace(path)


def read_runtime_autosave() -> dict | None:
    """Load the automatic session bundle if present and valid."""
    path = SAVES_DIR / AUTOSAVE_FILENAME
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None
