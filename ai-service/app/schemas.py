"""Request/response contracts for every AI endpoint.
The same response models validate real LLM output, so bad output never reaches the backend."""
import math
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

Level = Literal["junior", "mid", "senior"]


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


class RoleLevel(BaseModel):
    role: str = Field(min_length=2, max_length=80)
    level: Level

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        v = clean(v)
        if len(v) < 2:
            raise ValueError("role is too short")
        return v


# ---------- MCQ ----------
class MCQRequest(RoleLevel):
    count: int = Field(10, ge=1, le=15)
    exclude: list[str] = Field(default_factory=list, max_length=50)  # questions already used

    @field_validator("exclude")
    @classmethod
    def _exclude(cls, v: list[str]) -> list[str]:
        if any(len(x) > 500 for x in v):
            raise ValueError("excluded question text too long")
        return v


class MCQItem(BaseModel):
    question: str = Field(min_length=5, max_length=600)
    options: list[str]
    correct_index: int
    explanation: str = Field("", max_length=600)

    @field_validator("options", mode="before")
    @classmethod
    def _options(cls, v):
        if not isinstance(v, list):
            raise ValueError("options must be a list")
        return [clean(str(x)) for x in v]

    @model_validator(mode="after")
    def _check(self):
        if len(self.options) != 4:
            raise ValueError("exactly 4 options required")
        if any(not o for o in self.options) or len({o.lower() for o in self.options}) != 4:
            raise ValueError("options must be non-empty and distinct")
        if not 0 <= self.correct_index <= 3:
            raise ValueError("correct_index must be 0-3")
        return self


class MCQResponse(BaseModel):
    questions: list[MCQItem] = Field(min_length=1)


# ---------- Next question ----------
class QuestionRequest(RoleLevel):
    question_number: int = Field(1, ge=1, le=30)
    previous_question: Optional[str] = Field(None, max_length=1000)
    previous_answer: Optional[str] = Field(None, max_length=4000)  # "" means the candidate said nothing
    resume_summary: Optional[str] = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _need_answer(self):
        if self.question_number > 1 and self.previous_answer is None:
            raise ValueError("previous_answer is required after the first question (use an empty string for silence)")
        return self


class LLMQuestion(BaseModel):
    question: str = Field(min_length=5, max_length=600)


class QuestionResponse(BaseModel):
    question: str
    type: Literal["opening", "follow_up", "clarify"]


# ---------- Evaluate ----------
class PauseInfo(BaseModel):
    initial_pause_s: float = Field(0, ge=0, le=600)
    mid_pauses_s: list[float] = Field(default_factory=list, max_length=50)

    @field_validator("mid_pauses_s")
    @classmethod
    def _mid(cls, v: list[float]) -> list[float]:
        if any(x < 0 or x > 600 for x in v):
            raise ValueError("pause values must be between 0 and 600 seconds")
        return v


class EvalRequest(RoleLevel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(max_length=4000)  # may be empty
    pauses: Optional[PauseInfo] = None


class EvalResponse(BaseModel):
    technical: float
    communication: float
    confidence: float
    overall: Optional[float] = None
    feedback: str

    @field_validator("technical", "communication", "confidence", "overall", mode="before")
    @classmethod
    def _score(cls, v):
        if v is None:
            return v
        try:
            x = float(v)
        except (TypeError, ValueError):
            raise ValueError("score must be a number")
        if not math.isfinite(x):
            raise ValueError("score must be finite")
        return round(min(10.0, max(0.0, x)), 1)

    @field_validator("feedback", mode="before")
    @classmethod
    def _fb(cls, v):
        v = clean(str(v or ""))
        if not v:
            raise ValueError("feedback is empty")
        return v[:1000]

    @model_validator(mode="after")
    def _overall(self):
        if self.overall is None:
            self.overall = round((self.technical + self.communication + self.confidence) / 3, 1)
        return self


# ---------- Resume ----------
class ResumeRequest(RoleLevel):
    resume_text: str = Field(min_length=30, max_length=60000)
    count: int = Field(5, ge=1, le=10)


class ResumeItem(BaseModel):
    question: str = Field(min_length=5, max_length=600)
    focus: str = Field("", max_length=100)


class ResumeResponse(BaseModel):
    questions: list[ResumeItem] = Field(min_length=1)


# ---------- Roadmap ----------
class Scores(BaseModel):
    technical: float = Field(ge=0, le=10)
    communication: float = Field(ge=0, le=10)
    confidence: float = Field(ge=0, le=10)
    overall: float = Field(ge=0, le=10)


class RoadmapRequest(RoleLevel):
    scores: Scores
    mcq_percent: Optional[float] = Field(None, ge=0, le=100)
    weak_areas: list[str] = Field(default_factory=list, max_length=10)
    feedback: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("weak_areas", "feedback")
    @classmethod
    def _short(cls, v: list[str]) -> list[str]:
        if any(len(x) > 500 for x in v):
            raise ValueError("list item too long")
        return v


class RoadmapWeek(BaseModel):
    week: int
    focus: str = Field(min_length=3, max_length=200)
    goals: list[str] = Field(min_length=1, max_length=6)
    practice: list[str] = Field(min_length=1, max_length=6)


class RoadmapResponse(BaseModel):
    summary: str = Field(min_length=5, max_length=800)
    weeks: list[RoadmapWeek]

    @model_validator(mode="after")
    def _four(self):
        if len(self.weeks) != 4:
            raise ValueError("roadmap must have exactly 4 weeks")
        for i, w in enumerate(self.weeks, start=1):
            w.week = i
        return self
