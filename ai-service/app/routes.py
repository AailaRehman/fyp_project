from fastapi import APIRouter
from pydantic import ValidationError

from . import mocks, prompts
from .llm import complete_json
from .schemas import (
    EvalRequest, EvalResponse, LLMQuestion, MCQRequest, MCQResponse, QuestionRequest, QuestionResponse,
    ResumeRequest, ResumeResponse, RoadmapRequest, RoadmapResponse,
)

router = APIRouter()
MIN_WORDS_FOR_FOLLOW_UP = 5


class BadLLMOutput(Exception):
    pass


def run(messages, mock, schema, check=None, temperature=0.4):
    """Call the gateway and validate the result. If the output is invalid, retry once at a
    slightly different temperature (a new cache key, so a cached bad reply is not reused)."""
    for t in (temperature, min(temperature + 0.2, 1.0)):
        data = complete_json(messages, mock=mock, temperature=t)
        try:
            out = schema.model_validate(data)
        except ValidationError:
            continue
        if check is None or check(out):
            return out
    raise BadLLMOutput("The AI returned an unusable reply.")


def _words(text: str) -> int:
    return len((text or "").split())


@router.post("/generate-mcq", response_model=MCQResponse)
def generate_mcq(req: MCQRequest):
    out = run(prompts.mcq(req), mocks.mcq(req), MCQResponse, check=lambda m: len(m.questions) >= req.count)
    out.questions = out.questions[: req.count]
    return out


@router.post("/generate-question", response_model=QuestionResponse)
def generate_question(req: QuestionRequest):
    if req.question_number == 1:
        # The opening question needs no AI call in mock mode; in real mode it is generated from role, level and resume.
        out = run(prompts.next_question(req), {"question": mocks.opening(req)}, LLMQuestion)
        return QuestionResponse(question=out.question, type="opening")
    if _words(req.previous_answer) < MIN_WORDS_FOR_FOLLOW_UP:
        # Too little to build on: ask for detail without spending an AI call.
        return QuestionResponse(
            question="I did not catch much detail there. Could you describe a specific example?", type="clarify")
    out = run(prompts.next_question(req), mocks.follow_up(req), LLMQuestion)
    return QuestionResponse(question=out.question, type="follow_up")


@router.post("/evaluate-answer", response_model=EvalResponse)
def evaluate_answer(req: EvalRequest):
    if _words(req.answer) == 0:
        return EvalResponse(**mocks.no_answer())  # nothing to assess, so no AI call
    return run(prompts.evaluate(req), mocks.evaluate(req), EvalResponse)


@router.post("/generate-from-resume", response_model=ResumeResponse)
def generate_from_resume(req: ResumeRequest):
    out = run(prompts.from_resume(req), mocks.from_resume(req), ResumeResponse)
    out.questions = out.questions[: req.count]
    return out


@router.post("/generate-roadmap", response_model=RoadmapResponse)
def generate_roadmap(req: RoadmapRequest):
    return run(prompts.roadmap(req), mocks.roadmap(req), RoadmapResponse)
