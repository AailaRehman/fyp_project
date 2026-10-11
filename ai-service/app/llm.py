"""Single gateway for every LLM call. Protects free-tier quota:
mock mode, on-disk cache, retry with backoff, fallback model, graceful failure."""
import os, json, time, hashlib
from pathlib import Path


class LLMUnavailable(Exception):
    def __init__(self, msg, retry_after=30):
        super().__init__(msg)
        self.retry_after = retry_after


def _cfg():
    # read env at call time so tests / .env changes work
    return {
        "mode": os.getenv("LLM_MODE", "mock"),
        "model": os.getenv("GROQ_MODEL", ""),
        "fallback": os.getenv("GROQ_FALLBACK_MODEL", ""),
        "cache_on": os.getenv("LLM_CACHE", "1") == "1",
    }

CACHE_DIR = Path(".llm_cache")
_client = None


def _get_client():
    global _client
    if _client is None:
        from groq import Groq
        key = os.getenv("GROQ_API_KEY")
        if not key:
            raise LLMUnavailable("GROQ_API_KEY is not set", retry_after=0)
        _client = Groq(api_key=key)
    return _client


def complete_json(messages, mock, temperature=0.4):
    """Return parsed JSON from the LLM. `mock` is returned when LLM_MODE=mock."""
    c = _cfg()
    if c["mode"] == "mock":
        return mock

    models = [m for m in (c["model"], c["fallback"]) if m]
    if not models:
        raise LLMUnavailable("GROQ_MODEL is not set", retry_after=0)

    key = hashlib.sha256(json.dumps([models[0], messages, temperature], sort_keys=True).encode()).hexdigest()
    cache_file = CACHE_DIR / f"{key}.json"
    if c["cache_on"] and cache_file.exists():
        return json.loads(cache_file.read_text())

    from groq import RateLimitError, APIConnectionError, APIStatusError
    for model in models:
        for attempt in range(3):
            try:
                r = _get_client().chat.completions.create(
                    model=model, messages=messages, temperature=temperature,
                    response_format={"type": "json_object"})
                data = json.loads(r.choices[0].message.content)
                if c["cache_on"]:
                    CACHE_DIR.mkdir(exist_ok=True)
                    cache_file.write_text(json.dumps(data))
                return data
            except RateLimitError as e:
                try:
                    wait = float(e.response.headers.get("retry-after", 2 ** attempt))
                except Exception:
                    wait = 2 ** attempt
                if wait > 10:
                    break  # too long to wait; try fallback model
                time.sleep(wait)
            except (APIConnectionError, APIStatusError, json.JSONDecodeError):
                time.sleep(2 ** attempt)
    raise LLMUnavailable("AI is busy, please try again shortly.", retry_after=30)
