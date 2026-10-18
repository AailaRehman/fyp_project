"""Hardcoded stand-ins for the LLM, used while LLM_MODE=mock. No network, no quota.
They follow the same contract as the real endpoints and react to the input
(follow-ups use the candidate's own words, scores depend on the answer)."""
import re

MCQ_BANK = [
    {"question": "Which HTTP method is idempotent by definition?", "options": ["POST", "PUT", "PATCH", "CONNECT"], "correct_index": 1,
     "explanation": "Repeating the same PUT request leaves the server in the same state as sending it once."},
    {"question": "What is the time complexity of binary search on a sorted array of n items?", "options": ["O(n)", "O(n log n)", "O(1)", "O(log n)"], "correct_index": 3,
     "explanation": "Each step halves the search range, so the number of steps grows with log n."},
    {"question": "Which data structure removes items in first-in, first-out order?", "options": ["Stack", "Hash table", "Queue", "Heap"], "correct_index": 2,
     "explanation": "A queue serves the oldest item first."},
    {"question": "In SQL, which clause filters groups after aggregation?", "options": ["WHERE", "HAVING", "GROUP BY", "ORDER BY"], "correct_index": 1,
     "explanation": "WHERE filters rows before grouping; HAVING filters the grouped results."},
    {"question": "What does the C in ACID stand for?", "options": ["Consistency", "Concurrency", "Caching", "Compression"], "correct_index": 0,
     "explanation": "Consistency means a transaction moves the database from one valid state to another."},
    {"question": "Which Git command creates a new branch and switches to it?", "options": ["git merge name", "git stash name", "git branch -d name", "git checkout -b name"], "correct_index": 3,
     "explanation": "git checkout -b creates the branch and checks it out in one step."},
    {"question": "Which HTTP status code means the requested resource was not found?", "options": ["301", "403", "404", "500"], "correct_index": 2,
     "explanation": "404 tells the client the server has nothing at that address."},
    {"question": "In JavaScript, what does the === operator compare?", "options": ["Value only", "Value and type", "Type only", "Memory address only"], "correct_index": 1,
     "explanation": "Strict equality does not convert types before comparing."},
    {"question": "What is a benefit of adding an index to a database column?", "options": ["Faster reads when filtering on that column", "Smaller table size", "Faster writes", "Automatic backups"], "correct_index": 0,
     "explanation": "Indexes speed up lookups but cost extra space and slow writes slightly."},
    {"question": "What is a hash collision?", "options": ["One input producing two hashes", "A hash that is too long", "Two different inputs producing the same hash", "A hash that cannot be computed"], "correct_index": 2,
     "explanation": "Collisions are unavoidable when many inputs map to a limited set of hash values."},
    {"question": "Which principle says a class should have only one reason to change?", "options": ["Open/closed", "Liskov substitution", "Single responsibility", "Dependency inversion"], "correct_index": 2,
     "explanation": "The single responsibility principle keeps each class focused on one job."},
    {"question": "What is the main job of a load balancer?", "options": ["Encrypt stored data", "Spread incoming requests across servers", "Compile source code", "Back up sessions"], "correct_index": 1,
     "explanation": "It prevents any one server from being overloaded and helps survive server failures."},
    {"question": "Which statement about a signed JWT is correct?", "options": ["The payload is encrypted by default", "It cannot expire", "It must be stored in a database to work", "The signature lets the server detect tampering"], "correct_index": 3,
     "explanation": "A JWT payload is only encoded, but changing it breaks the signature."},
    {"question": "What does Big-O notation describe?", "options": ["Exact running time in seconds", "How cost grows as input size grows", "Memory address layout", "Number of lines of code"], "correct_index": 1,
     "explanation": "It describes growth rate, not exact timings."},
    {"question": "Which is true of a primary key in a relational table?", "options": ["It uniquely identifies each row", "It can contain duplicate values", "It must be a string", "It may be NULL in any row"], "correct_index": 0,
     "explanation": "A primary key is unique and never NULL."},
]


def mcq(req) -> dict:
    seen = {q.strip().lower() for q in req.exclude}
    fresh = [q for q in MCQ_BANK if q["question"].lower() not in seen]
    stale = [q for q in MCQ_BANK if q["question"].lower() in seen]
    return {"questions": (fresh + stale)[: req.count]}


# ---------- questions ----------
OPENERS = {
    "junior": "tell me about a project you built recently and what you learned from it.",
    "mid": "tell me about a time you had to debug a problem that was hard to reproduce.",
    "senior": "describe a technical decision you led and how you weighed the trade-offs.",
}
FOLLOW_UPS = [
    "You mentioned {t}. What did you look at first, and why?",
    "Earlier you brought up {t}. What trade-offs did you consider?",
    "Can you walk me through how {t} worked in practice?",
]
STOP = set("""because would should could about there their which where these those through really things something everything
actually basically probably working worked using after before while other being first second again always never maybe
sometimes thing people think thought going doing""".split())


def salient_word(text: str):
    best = None
    for tok in re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]{3,}", text or ""):
        tok = tok.strip(".-")
        if len(tok) < 5 or tok.lower() in STOP:
            continue
        if best is None or len(tok) > len(best):
            best = tok
    return best


def opening(req) -> str:
    return f"For this {req.role} role, {OPENERS[req.level]}"


def follow_up(req) -> dict:
    term = salient_word(req.previous_answer)
    if term:
        return {"question": FOLLOW_UPS[(req.question_number - 1) % 3].format(t=term)}
    return {"question": "Can you give one specific example of that from your own work?"}


# ---------- evaluation ----------
TECH_PREFIXES = ("api", "databas", "index", "cache", "thread", "async", "test", "log", "memory", "query", "deploy",
                 "latenc", "docker", "server", "algorithm", "complex", "bug", "debug", "profil", "snapshot", "queue", "scal")
HEDGES = ("maybe", "i think", "not sure", "i guess", "kind of", "sort of")
TIPS = {
    "technical": "add concrete technical detail such as tools, numbers or the exact steps you took",
    "communication": "structure the answer as situation, action and result so it is easier to follow",
    "confidence": "state decisions directly and avoid hedging phrases",
}


def _clamp(x: float, lo=0.0, hi=10.0) -> float:
    return round(max(lo, min(hi, x)), 1)


def evaluate(req) -> dict:
    ans = req.answer.lower()
    words = re.findall(r"[a-z0-9+#.\-']+", ans)
    comm = _clamp(2.5 + len(words) / 12, 0, 9.0)
    hits = sum(1 for w in words if w.startswith(TECH_PREFIXES))
    tech = _clamp(comm - 0.5 + min(1.5, 0.4 * hits), 0, 9.5)
    penalty = 0.0
    note = ""
    if req.pauses:
        if req.pauses.initial_pause_s > 5:
            penalty += 1.0
        long_mid = sum(1 for p in req.pauses.mid_pauses_s if p > 3)
        penalty += min(1.0, 0.5 * long_mid)
        if penalty:
            note = " Long pauses lowered the confidence score a little."
    penalty += min(1.5, 0.4 * sum(ans.count(h) for h in HEDGES))
    conf = _clamp(comm - penalty)
    scores = {"technical": tech, "communication": comm, "confidence": conf}
    best = max(scores, key=scores.get)
    worst = min(scores, key=scores.get)
    fb = f"Your {best} was the strongest part of this answer. To improve {worst}, {TIPS[worst]}.{note}"
    return {**scores, "overall": _clamp((tech + comm + conf) / 3), "feedback": fb}


def no_answer() -> dict:
    return {"technical": 0.0, "communication": 0.0, "confidence": 0.0, "overall": 0.0,
            "feedback": "No answer was recorded for this question."}


# ---------- resume ----------
SKILLS = {
    "python": "Python", "java": "Java", "javascript": "JavaScript", "typescript": "TypeScript", "react": "React",
    "node": "Node.js", "express": "Express", "sql": "SQL", "mongodb": "MongoDB", "docker": "Docker", "aws": "AWS",
    "django": "Django", "flask": "Flask", "fastapi": "FastAPI", "git": "Git", "c++": "C++", "kubernetes": "Kubernetes",
}
GENERIC_RESUME_QS = [
    ("Pick the project on your resume you are proudest of. What was your part in it?", "main project"),
    ("What was the hardest problem you solved in your most recent role or project, and how?", "hardest problem"),
    ("Tell me about a decision on one of your projects that you would make differently now.", "decisions"),
    ("Which skill on your resume did you learn fastest, and how did you learn it?", "learning"),
    ("Describe a time you worked with other people on something listed on your resume.", "teamwork"),
    ("What result from your resume are you able to measure, and how did you measure it?", "results"),
    ("Which tool or technology on your resume would you recommend to a teammate, and why?", "tools"),
    ("What did you contribute to your most recent project that nobody asked you to?", "initiative"),
    ("Tell me about feedback you received on your work and what you changed.", "feedback"),
    ("What would you build next if you had a month to extend your best project?", "next steps"),
]


def from_resume(req) -> dict:
    found = []
    for key, name in SKILLS.items():
        m = re.search(r"(?<![A-Za-z0-9+#])" + re.escape(key) + r"(?![A-Za-z0-9+#])", req.resume_text, re.I)
        if m:
            found.append((m.start(), name))
    found.sort()
    qs = [{"question": f"Your resume lists {name}. Tell me about a project where you used it and what you were responsible for.",
           "focus": name} for _, name in found]
    qs += [{"question": q, "focus": f} for q, f in GENERIC_RESUME_QS]
    return {"questions": qs[: req.count]}


# ---------- roadmap ----------
DIM_LABEL = {"technical": "technical depth", "communication": "communication", "confidence": "confidence"}
DIM_PLAN = {
    "technical": {
        "goals": ["List the 10 core topics for your role and rate yourself on each",
                  "Study the three weakest topics until you can explain them without notes",
                  "Write one short example for each topic from your own projects"],
        "practice": ["Answer 3 technical questions out loud each day", "Redo the MCQ questions you got wrong and explain why"],
    },
    "communication": {
        "goals": ["Use situation, action, result to structure every answer",
                  "Cut filler words by listening to your own recordings",
                  "Keep answers between one and two minutes"],
        "practice": ["Record yourself answering 3 questions and listen back", "Explain a technical idea to a friend who is not technical"],
    },
    "confidence": {
        "goals": ["Start answering within five seconds of hearing the question",
                  "Replace hedging phrases such as 'I think maybe' with direct statements",
                  "Prepare three stories you can tell without notes"],
        "practice": ["Do a timed question drill: five seconds to begin, then speak", "Practise out loud in front of a camera"],
    },
}


def roadmap(req) -> dict:
    s = req.scores
    dims = sorted(DIM_LABEL, key=lambda d: getattr(s, d))
    weakest, second = dims[0], dims[1]
    w1_goals = list(DIM_PLAN[weakest]["goals"])
    if req.mcq_percent is not None and req.mcq_percent < 60:
        w1_goals.append(f"Review core {req.role} concepts, because your MCQ score was {req.mcq_percent:g}%")
    weeks = [
        {"week": 1, "focus": f"Strengthen {DIM_LABEL[weakest]}", "goals": w1_goals, "practice": DIM_PLAN[weakest]["practice"]},
        {"week": 2, "focus": f"Build up {DIM_LABEL[second]}", "goals": DIM_PLAN[second]["goals"], "practice": DIM_PLAN[second]["practice"]},
        {"week": 3, "focus": "Practise full answers out loud",
         "goals": ["Answer five questions for the role from start to finish", "Use a stronger example in every answer", "Review each recording for one fix"],
         "practice": [f"Run two timed mock interviews for a {req.level} {req.role} role", "Ask a friend to follow up on your answers"]},
        {"week": 4, "focus": "Full mock interviews and review",
         "goals": ["Complete a full practice interview on this platform", "Compare your new scores with these ones", "List what still needs work"],
         "practice": ["Repeat the practice interview twice this week", "Write down three stories you are ready to use"]},
    ]
    summary = (f"Your overall score was {s.overall:g} out of 10, and {DIM_LABEL[weakest]} was your weakest area. "
               "The plan starts there, then moves to full practice interviews.")
    return {"summary": summary, "weeks": weeks}
