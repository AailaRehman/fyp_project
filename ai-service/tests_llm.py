import os
os.environ["LLM_MODE"] = "mock"
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)

def test_health():
    assert c.get("/health").json()["status"] == "ok"

def test_mock():
    assert c.get("/dev/llm-test").json()["word"] == "mock"

def test_busy_when_no_model(monkeypatch):
    monkeypatch.setenv("LLM_MODE", "groq"); monkeypatch.delenv("GROQ_MODEL", raising=False)
    r = c.get("/dev/llm-test")
    assert r.status_code == 503 and r.json()["error"] == "ai_busy"
