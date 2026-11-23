"""Loopback-only semantic index for the studio's saved teaching preferences."""

import os
from threading import Lock

from fastapi import FastAPI
from ollama import Client
from pydantic import BaseModel, Field

# Mem0 reads this setting when it is imported.
os.environ["MEM0_TELEMETRY"] = "false"
from mem0 import Memory


OLLAMA_URL = "http://127.0.0.1:11434"
EMBEDDING_MODEL = "all-minilm:latest"
ollama = Client(host=OLLAMA_URL)
if EMBEDDING_MODEL not in {model.model for model in ollama.list().models}:
    raise RuntimeError(f"Preload the local model {EMBEDDING_MODEL} before starting Mem0.")

memory = Memory.from_config({
    "history_db_path": ":memory:",
    "llm": {"provider": "ollama", "config": {
        "model": "qwen3.5:4b", "ollama_base_url": OLLAMA_URL,
    }},
    "embedder": {"provider": "ollama", "config": {
        "model": EMBEDDING_MODEL, "embedding_dims": 384, "ollama_base_url": OLLAMA_URL,
    }},
    "vector_store": {"provider": "qdrant", "config": {
        "path": ":memory:", "collection_name": "sabaq_preferences", "embedding_model_dims": 384,
    }},
})
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
lock = Lock()


class Entry(BaseModel):
    id: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=400)


class Recall(BaseModel):
    scope: str = Field(min_length=1, max_length=160)
    entries: list[Entry] = Field(max_length=12)
    query: str | None = Field(default=None, max_length=6000)


@app.get("/health")
def health():
    return {"status": "ready"}


@app.post("/recall")
def recall(request: Recall):
    # Each request reconciles a single deck's index against its canonical SQLite entries.
    scope = {"user_id": request.scope}
    current = {entry.id: entry.text for entry in request.entries}
    with lock:
        existing = memory.get_all(filters=scope, top_k=32)["results"]
        for result in existing:
            if (result.get("metadata") or {}).get("studio_id") not in current:
                memory.delete(result["id"])
        if not request.query or not current:
            return {"ids": []}

        indexed = {(result.get("metadata") or {}).get("studio_id") for result in existing}
        for entry_id, content in current.items():
            if entry_id not in indexed:
                memory.add(content, user_id=request.scope, metadata={"studio_id": entry_id}, infer=False)
        matches = memory.search(request.query, filters=scope, top_k=8)["results"]
        ids = [(result.get("metadata") or {}).get("studio_id") for result in matches]
        return {"ids": [entry_id for entry_id in ids if entry_id in current]}
