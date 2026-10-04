"""Labelled evaluation of the Jev claim audit, used to choose routing thresholds.

Data is fictional by default: the hand-written fixture plus Sonnet-generated
fictional resumes. ``--extra-source`` adds a local reviewed source document for a
private run; its content is never written to the report. Each source bullet gets
labelled variants (faithful, overstated, plausible addition, implausible addition)
and deterministic hard-limit injections (employer, credential, tenure, seniority).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jev_audit  # noqa: E402
from evals.fixtures import source_document  # noqa: E402
from llm_runtime import CallBudget, structured_call  # noqa: E402
from evals.run_sections import configuration  # noqa: E402

FIELDS = ["registered nurse", "marketing manager", "staff accountant", "data analyst", "high school teacher",
          "site reliability engineer", "operations supervisor", "UX designer"]
# variant -> (passes at medium, passes at high)
LABELS = {"original": (True, True), "faithful": (True, True), "overstated": (False, True),
          "plausible_addition": (False, True), "implausible_addition": (False, False),
          "employer": (False, False), "credential": (False, False), "tenure": (False, False), "seniority": (False, False)}
INJECTIONS = {
    "employer": " while working on contract for Initech Global",
    "credential": " after earning a PMP certification",
    "tenure": " drawing on more than 15 years in the role",
    "seniority": " as Vice President of the department",
}


class Role(BaseModel):
    title: str
    company: str
    dates: str
    bullets: list[str] = Field(min_length=3, max_length=5)


class FictionalResume(BaseModel):
    roles: list[Role] = Field(min_length=2, max_length=2)


class Variant(BaseModel):
    index: int
    faithful: str
    overstated: str
    plausible_addition: str
    implausible_addition: str


class Variants(BaseModel):
    items: list[Variant]


class Meter:
    def __init__(self, cap: float) -> None:
        self.cap = cap
        self.llm_cost = 0.0
        self.jev_calls = 0
        self.jev_state_chars = 0

    def jev_cost(self) -> float:
        return self.jev_state_chars / 4 * 0.042 / 1_000_000

    def check(self) -> None:
        if self.llm_cost + self.jev_cost() >= self.cap:
            raise RuntimeError(f"Cost cap ${self.cap} reached.")


async def llm(prompt: str, output_type: Any, values: dict[str, str], meter: Meter) -> Any:
    meter.check()
    budget = CallBudget.for_seconds(120, max_requests=2)
    result = await structured_call(prompt=[("system", "You produce fictional evaluation data. Return JSON only."), ("human", prompt)],
        output_type=output_type, model_name=values["TIER1_MODEL"], api_key=values["OPENROUTER_API_KEY"],
        base_url=values.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"), budget=budget, timeout=110)
    meter.llm_cost += sum(float(a.get("cost_usd") or 0) for a in budget.attempts)
    return result


def units_from_document(document: dict[str, Any]) -> list[tuple[str, str]]:
    units = []
    for section in document["sections"]:
        if section.get("kind") != "professional_experience":
            continue
        for entry in section.get("entries", []):
            fields = entry.get("fields", {})
            role = " | ".join(str(fields[k]) for k in ("title", "company", "date_range") if fields.get(k))
            units += [(role, bullet["text"]) for bullet in entry.get("bullets", [])]
    return units


async def build_dataset(args, values, meter) -> list[dict[str, Any]]:
    sources: list[tuple[str, list[tuple[str, str]]]] = [("fixture", units_from_document(source_document()))]
    for field in FIELDS[: args.resumes]:
        resume = await llm(f"Write a realistic fictional resume for a mid-level {field}: two roles at fictional companies "
                           "with plain factual bullets (3-5 each). Use only fictional names.", FictionalResume, values, meter)
        sources.append((field, [(f"{r.title} | {r.company} | {r.dates}", b) for r in resume.roles for b in r.bullets]))
    if args.extra_source:
        messages = json.loads(Path(args.extra_source).read_text())
        sources.append(("private", units_from_document(json.loads(messages[1]["content"])["reviewed_source"])))

    rows: list[dict[str, Any]] = []
    for name, units in sources:
        listing = "\n".join(f"{i}. [{role}] {text}" for i, (role, text) in enumerate(units))
        variants = await llm(
            "For each numbered resume bullet, write four rewrites:\n"
            "- faithful: same facts, different wording; add nothing.\n"
            "- overstated: inflate ownership, authority or scope (for example 'supported' -> 'owned'), keeping the same "
            "title, seniority, employer, dates and numbers.\n"
            "- plausible_addition: add one specific tool, method, metric or outcome that someone in exactly this role and "
            "seniority would credibly have, which the original does not state.\n"
            "- implausible_addition: add one claim from an unrelated field or at an unrealistic scale for this role.\n"
            "Return items with the bullet index.\n\n" + listing, Variants, values, meter)
        by_index = {item.index: item for item in variants.items}
        for index, (role, text) in enumerate(units):
            base = {"source": name, "role": role, "evidence": text}
            rows.append({**base, "variant": "original", "claim": text})
            if index in by_index:
                item = by_index[index]
                for variant in ("faithful", "overstated", "plausible_addition", "implausible_addition"):
                    rows.append({**base, "variant": variant, "claim": getattr(item, variant)})
            for variant, suffix in INJECTIONS.items():
                rows.append({**base, "variant": variant, "claim": text.rstrip(". ") + suffix + "."})
    return rows


async def run_jev(rows, level, values, meter) -> None:
    claims = [jev_audit.Claim(f"c{i}", "s", row["claim"], row["evidence"], row["role"]) for i, row in enumerate(rows)]
    model = values.get("JEV_AUDIT_MODEL") or jev_audit.DEFAULT_JEV_MODEL
    for batch in jev_audit.batches(claims, level, model):
        meter.check()
        meter.jev_calls += 1
        meter.jev_state_chars += len(json.dumps(jev_audit.build_request(batch, level, model)))
    started = time.monotonic()
    answers = await jev_audit.decide(claims, level, api_key=values["OPENROUTER_API_KEY"], model=model, timeout_seconds=15)
    for i, row in enumerate(rows):
        answer = answers[f"c{i}"]
        row[f"{level}_p_pass"] = answer.probabilities[jev_audit.PASS_OPTION[level]]
        row[f"{level}_choice"] = answer.choice
    rows_elapsed = round(time.monotonic() - started, 2)
    for row in rows:
        row[f"{level}_batch_elapsed_s"] = rows_elapsed


def evaluate(rows, level) -> dict[str, Any]:
    column = 0 if level == "medium" else 1
    positives = [r for r in rows if LABELS[r["variant"]][column]]
    negatives = [r for r in rows if not LABELS[r["variant"]][column]]
    grid = []
    for accept in [x / 100 for x in range(50, 100, 2)]:
        for reject in [x / 100 for x in range(2, 50, 2)]:
            if reject >= accept:
                continue
            def outcome(row):
                p = row[f"{level}_p_pass"]
                return "accept" if p >= accept else ("reject" if p <= reject else "escalate")
            caught = sum(outcome(r) == "reject" for r in negatives) / max(1, len(negatives))
            missed = sum(outcome(r) == "accept" for r in negatives) / max(1, len(negatives))
            false_reject = sum(outcome(r) == "reject" for r in positives) / max(1, len(positives))
            escalation = sum(outcome(r) == "escalate" for r in rows) / max(1, len(rows))
            grid.append({"accept": accept, "reject": reject, "caught": round(caught, 3), "missed": round(missed, 3),
                         "false_reject": round(false_reject, 3), "escalation": round(escalation, 3)})
    eligible = [g for g in grid if g["escalation"] <= 0.15 and g["false_reject"] <= 0.10]
    best = max(eligible, key=lambda g: (g["caught"], -g["missed"], -g["escalation"]), default=None)
    by_variant = {}
    for variant in LABELS:
        subset = [r for r in rows if r["variant"] == variant]
        if subset and best:
            p = [r[f"{level}_p_pass"] for r in subset]
            by_variant[variant] = {"n": len(subset), "expected_pass": LABELS[variant][column],
                "accepted": sum(x >= best["accept"] for x in p), "rejected": sum(x <= best["reject"] for x in p)}
    gate = bool(best and best["caught"] >= (0.80 if level == "medium" else 0.90) and best["false_reject"] <= 0.10)
    return {"level": level, "claims": len(rows), "positives": len(positives), "negatives": len(negatives),
            "best_thresholds": best, "gate_passed": gate, "by_variant": by_variant}


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--extra-source", type=Path, help="Local writer_messages.json with a reviewed_source (never written to the report).")
    parser.add_argument("--resumes", type=int, default=6)
    parser.add_argument("--max-cost-usd", type=float, default=3.0)
    parser.add_argument("--dataset", type=Path, default=Path("/app/evals/results/jev-dataset.json"))
    parser.add_argument("--output", type=Path, default=Path("/app/evals/results/jev-audit-report.json"))
    args = parser.parse_args()
    values = configuration(args.env_file)
    meter = Meter(args.max_cost_usd)
    if args.dataset.exists():
        rows = json.loads(args.dataset.read_text())
    else:
        rows = await build_dataset(args, values, meter)
        args.dataset.parent.mkdir(parents=True, exist_ok=True)
        args.dataset.write_text(json.dumps(rows))
    for level in ("medium", "high"):
        await run_jev(rows, level, values, meter)
    args.dataset.write_text(json.dumps(rows))  # Scored rows allow threshold comparisons without new calls.
    report = {
        "levels": [evaluate(rows, "medium"), evaluate(rows, "high")],
        "jev_calls": meter.jev_calls, "jev_cost_estimate_usd": round(meter.jev_cost(), 5),
        "llm_cost_usd": round(meter.llm_cost, 4),
        "batch_elapsed_s": {level: rows[0].get(f"{level}_batch_elapsed_s") for level in ("medium", "high")},
        "sources": sorted({r["source"] for r in rows}),
    }
    args.output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
