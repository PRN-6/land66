from __future__ import annotations

import os
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

Provider = Literal["fallback", "ollama", "lmstudio", "openai", "gemini", "openrouter", "custom"]
DEFAULT_URLS = {
    "fallback": "", "ollama": "http://localhost:11434",
    "lmstudio": "http://localhost:1234/v1", "openai": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "openrouter": "https://openrouter.ai/api/v1", "custom": "",
}


class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider = "fallback"
    model: str = Field(default="", max_length=160)
    base_url: str = Field(default="", max_length=2048)
    api_key: SecretStr = Field(default=SecretStr(""), exclude=True)
    temperature: float = Field(default=.7, ge=0, le=2)
    decision_interval_ticks: int = Field(default=100, ge=10, le=10000)
    enabled: bool = False

    @field_validator("base_url")
    @classmethod
    def http_url(cls, value):
        from urllib.parse import urlsplit
        value = value.strip().rstrip("/")
        if value:
            parts = urlsplit(value)
            if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
                raise ValueError("base_url must be an HTTP(S) URL without credentials, query or fragment")
        return value

    @classmethod
    def from_env(cls):
        provider = os.getenv("LLM_PROVIDER", "fallback")
        return cls(provider=provider, model=os.getenv("LLM_MODEL", ""),
                   base_url=os.getenv("LLM_BASE_URL", "") or DEFAULT_URLS.get(provider, ""),
                   api_key=os.getenv("LLM_API_KEY", ""),
                   temperature=float(os.getenv("LLM_TEMPERATURE", ".7")),
                   decision_interval_ticks=int(os.getenv("LLM_DECISION_INTERVAL_TICKS", "100")),
                   enabled=os.getenv("LLM_ENABLED", "false").lower() in {"true", "1", "yes"})

    def public(self):
        return {**self.model_dump(), "has_api_key": bool(self.api_key.get_secret_value())}


class ConfigPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider | None = None
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    temperature: float | None = None
    decision_interval_ticks: int | None = None
    enabled: bool | None = None


Action = Literal["idle", "explore", "walk", "forage", "drink", "eat", "sleep", "chop", "mine", "craft", "build", "till", "plant", "water", "harvest", "plant_sapling", "journal"]


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    thought: str = Field(min_length=1, max_length=700)
    goal: str = Field(min_length=1, max_length=200)
    action: Action
    params: dict[str, Any] = Field(default_factory=dict)
    journal_entry: str | None = Field(default=None, max_length=1200)


class Control(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["pause", "resume", "step", "set_speed", "reset"]
    speed: Literal[1, 2, 5] | None = None
    seed: int | None = Field(default=None, ge=-(2**63), le=2**63-1)


class Intervention(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal[
        "set_time",
        "set_weather",
        "whisper",
        "spawn_tree",
        "drop_gift",
        "heal_npc",
        "spawn_object",
        "remove_block",
        "spawn_entity",
        "clear_entities",
    ]
    value: Any = None
