"""Labelled evaluation of the Jev claim audit, used to choose routing thresholds.

Data is fictional by default: the hand-written fixture plus Sonnet-generated
fictional resumes. ``--extra-source`` adds a local reviewed source document for a
private run; its content is never written to the report. Each source bullet gets
labelled variants (faithful, overstated, plausible addition, implausible addition)
and deterministic hard-limit injections (employer, credential, tenure, seniority).
Summary sentences and Skills groups get their own labelled variants. They are scored
as production now sends them (evidence overview, local Skills matching) and as before
those fixes, reported per claim kind under ``by_kind``.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jev_audit  # noqa: E402
import model_config  # noqa: E402
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
# The grid steps by 0.02, so these are exact grid points.
CANDIDATE_ACCEPT = 0.80
CANDIDATE_REJECTS = (0.20, 0.16, 0.14, 0.12, 0.10)


class Role(BaseModel):
    title: str
    company: str
    dates: str
    bullets: list[str] = Field(min_length=3, max_length=5)


class FictionalResume(BaseModel):
    roles: list[Role] = Field(min_length=2, max_length=2)
    skills: list[str] = Field(min_length=2, max_length=3)


class SkillsVariant(BaseModel):
    index: int
    faithful: str
    plausible_addition: str
    implausible_addition: str


class SummarySkillsVariants(BaseModel):
    summary_faithful: list[str] = Field(min_length=3, max_length=3)
    summary_overstated: list[str] = Field(min_length=2, max_length=2)
    summary_plausible_addition: list[str] = Field(min_length=2, max_length=2)
    summary_implausible_addition: list[str] = Field(min_length=2, max_length=2)
    skills: list[SkillsVariant]


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
        output_type=output_type, model_name=model_config.route("resume_writer").model, api_key=values["OPENROUTER_API_KEY"],
        base_url=values.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"), budget=budget, timeout=110)
    meter.llm_cost += sum(float(a.get("cost_usd") or 0) for a in budget.attempts)
    return result


def profile_from_document(document: dict[str, Any]) -> dict[str, Any]:
    """Experience bullets by role, qualification headers, Skills groups and Summary text."""
    units, qualifications, skills = [], [], []
    for section in document["sections"]:
        if section.get("enabled") is False:
            continue
        kind = section.get("kind")
        for entry in section.get("entries", []) if kind in {"professional_experience", "education", "certifications"} else []:
            fields = entry.get("fields", {})
            if kind == "professional_experience":
                role = " | ".join(str(fields[k]) for k in ("title", "company", "date_range") if fields.get(k))
                units += [(role, bullet["text"]) for bullet in entry.get("bullets", [])]
            else:
                qualifications.append(" | ".join(str(value) for value in fields.values() if value))
        if kind == "skills":
            skills += jev_audit.split_paragraph("skills", section.get("content_md", ""))
    summary = " ".join(section.get("content_md", "") for section in document["sections"] if section.get("kind") == "summary")
    return {"units": units, "qualifications": qualifications, "skills": skills, "summary": summary}


def render_profile(profile: dict[str, Any]) -> str:
    """Plain resume text shaped like production's rendered reviewed document (Summary/Skills evidence)."""
    roles: dict[str, list[str]] = {}
    for role, text in profile["units"]:
        roles.setdefault(role, []).append(text)
    parts = ["## Summary\n" + profile["summary"]] if profile.get("summary") else []
    if roles:
        parts.append("## Professional Experience\n" + "\n\n".join(
            role + "\n" + "\n".join("- " + text for text in bullets) for role, bullets in roles.items()))
    if profile.get("qualifications"):
        parts.append("## Education and Certifications\n" + "\n".join(profile["qualifications"]))
    if profile.get("skills"):
        parts.append("## Skills\n" + "\n".join("- " + group for group in profile["skills"]))
    return "\n\n".join(parts)


def profiles_from_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Rebuild each fictional source from its original rows, so a saved dataset can gain new derived fields."""
    profiles: dict[str, dict[str, Any]] = {}
    for row in rows:
        profile = profiles.setdefault(row["source"], {"units": [], "qualifications": [], "skills": [], "summary": ""})
        if row["variant"] == "original" and row.get("kind", "bullet") == "bullet":
            profile["units"].append((row["role"], row["claim"]))
        elif row["variant"] == "original" and row.get("kind") == "skills":
            profile["skills"].append(row["claim"])
    if "fixture" in profiles:
        profiles["fixture"] = profile_from_document(source_document())
    return profiles


async def summary_skills_rows(name: str, profile: dict[str, Any], values, meter) -> list[dict[str, Any]]:
    """Summary sentences and Skills groups, the claim kinds the bullet-only dataset never covered.

    Cited evidence imitates production's partial citations (the Summary source and the most
    recent role); faithful sentences about earlier roles or listed skills need the whole resume.
    """
    units, skills = profile["units"], profile["skills"]
    if not units or not skills:
        return []
    latest = units[0][0]
    roles = "\n".join(f"[{role}] {text}" for role, text in units)
    groups = "\n".join(f"{i}. {group}" for i, group in enumerate(skills))
    variants = await llm(
        "Resume (fictional):\n" + roles + "\nSkills:\n" + groups + "\n\n"
        "Write resume Summary sentences in implied first person (no I, me or my):\n"
        "- summary_faithful: three sentences using only facts above; each must use at least one fact outside the most "
        f"recent role [{latest}], such as an earlier employer or role, or a listed skill.\n"
        "- summary_overstated: two sentences that inflate ownership, authority or scope, keeping employers, titles and dates.\n"
        "- summary_plausible_addition: two sentences that each add one tool, metric or outcome a person with this "
        "background would credibly have, which the resume does not state.\n"
        "- summary_implausible_addition: two sentences that each add a claim from an unrelated field or at an unrealistic scale.\n"
        "For each numbered Skills group write:\n"
        "- faithful: a new short category label, a colon, then the group's items reordered with at most two dropped, "
        "each item worded exactly as listed.\n"
        "- plausible_addition: the faithful version plus one tool someone in this field would credibly use that the resume never names.\n"
        "- implausible_addition: the faithful version plus one skill from an unrelated field.\n"
        "Return skills items with the group index.", SummarySkillsVariants, values, meter)
    cited = " ".join([profile["summary"], *(text for role, text in units if role == latest)]).strip()
    shared = {"source": name, "resume": render_profile(profile)}
    rows: list[dict[str, Any]] = []
    summary = {**shared, "kind": "summary", "role": "Summary", "evidence": cited}
    for variant in ("faithful", "overstated", "plausible_addition", "implausible_addition"):
        rows += [{**summary, "variant": variant, "claim": text} for text in getattr(variants, f"summary_{variant}")]
    for variant in ("employer", "credential"):
        rows.append({**summary, "variant": variant, "claim": variants.summary_faithful[0].rstrip(". ") + INJECTIONS[variant] + "."})
    skill_rows = {**shared, "kind": "skills", "role": "Skills", "evidence": "\n".join(skills)}
    by_index = {item.index: item for item in variants.skills}
    for index, group in enumerate(skills):
        rows.append({**skill_rows, "variant": "original", "claim": group})
        if index in by_index:
            item = by_index[index]
            rows += [{**skill_rows, "variant": variant, "claim": getattr(item, variant)}
                     for variant in ("faithful", "plausible_addition", "implausible_addition")]
    return rows


async def build_dataset(args, values, meter) -> list[dict[str, Any]]:
    profiles: list[tuple[str, dict[str, Any]]] = [("fixture", profile_from_document(source_document()))]
    for field in FIELDS[: args.resumes]:
        resume = await llm(f"Write a realistic fictional resume for a mid-level {field}: two roles at fictional companies, "
                           "most recent first, with plain factual bullets (3-5 each), and 2-3 skills groups written as "
                           "'Category: item, item, item'. Use only fictional names.", FictionalResume, values, meter)
        profiles.append((field, {"units": [(f"{r.title} | {r.company} | {r.dates}", b) for r in resume.roles for b in r.bullets],
                                 "qualifications": [], "skills": resume.skills, "summary": ""}))
    if args.extra_source:
        messages = json.loads(Path(args.extra_source).read_text())
        profiles.append(("private", profile_from_document(json.loads(messages[1]["content"])["reviewed_source"])))

    rows: list[dict[str, Any]] = []
    for name, profile in profiles:
        rows += await summary_skills_rows(name, profile, values, meter)
        units = profile["units"]
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
            base = {"source": name, "kind": "bullet", "role": role, "evidence": text}
            rows.append({**base, "variant": "original", "claim": text})
            if index in by_index:
                item = by_index[index]
                for variant in ("faithful", "overstated", "plausible_addition", "implausible_addition"):
                    rows.append({**base, "variant": variant, "claim": getattr(item, variant)})
            for variant, suffix in INJECTIONS.items():
                rows.append({**base, "variant": variant, "claim": text.rstrip(". ") + suffix + "."})
    return rows


def jev_input(row: dict[str, Any], baseline: bool) -> Optional[tuple[str, str]]:
    """(claim, evidence) as production sends it, or None when the claim is accepted locally.

    Derived at run time, so a saved dataset measures the current audit code. Baseline is the
    behaviour before whole-resume Summary/Skills evidence and local Skills matching.
    """
    kind = row.get("kind", "bullet")
    if kind == "bullet" or baseline:
        return row["claim"], row["evidence"]
    evidence = jev_audit.resume_evidence(row["evidence"], row["resume"])
    # Production matches Skills items against the reviewed Skills section only; render_profile puts it last.
    skills_source = row["resume"].partition("## Skills\n")[2]
    text = jev_audit.skills_claim_text(row["claim"], skills_source) if kind == "skills" else row["claim"]
    return (text, evidence) if text else None


async def run_jev(rows, level, values, meter, *, baseline: bool = False) -> None:
    field = f"{level}_baseline" if baseline else level
    claims = []
    for i, row in enumerate(rows):
        if baseline and row.get("kind", "bullet") == "bullet":
            continue  # Unchanged by the Summary/Skills fixes.
        sent = jev_input(row, baseline)
        if sent is None:
            row[f"{field}_p_pass"], row[f"{field}_choice"] = 1.0, "local_accept"
            continue
        claims.append(jev_audit.Claim(f"c{i}", "s", sent[0], sent[1], row["role"]))
    model = model_config.route("claim_audit").model
    for batch in jev_audit.batches(claims, level, model):
        meter.check()
        meter.jev_calls += 1
        meter.jev_state_chars += len(json.dumps(jev_audit.build_request(batch, level, model)))
    started = time.monotonic()
    answers = await jev_audit.decide(claims, level, api_key=values["OPENROUTER_API_KEY"], model=model, timeout_seconds=15)
    for claim in claims:
        row, answer = rows[int(claim.id[1:])], answers[claim.id]
        row[f"{field}_p_pass"] = answer.probabilities[jev_audit.PASS_OPTION[level]]
        row[f"{field}_choice"] = answer.choice
    rows_elapsed = round(time.monotonic() - started, 2)
    for row in rows:
        row[f"{field}_batch_elapsed_s"] = rows_elapsed


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
    # Fixed comparison rows: the production accept threshold with progressively lower reject thresholds.
    candidates = []
    for reject in CANDIDATE_REJECTS:
        row = next(g for g in grid if g["accept"] == CANDIDATE_ACCEPT and g["reject"] == reject)
        rejected = [r for r in positives if r[f"{level}_p_pass"] <= reject]
        candidates.append({**row, "false_rejects_by_variant": {v: sum(r["variant"] == v for r in rejected)
                                                               for v in LABELS if LABELS[v][column]}})
    return {"level": level, "claims": len(rows), "positives": len(positives), "negatives": len(negatives),
            "best_thresholds": best, "gate_passed": gate, "by_variant": by_variant, "candidates": candidates,
            "by_kind": by_kind(rows, level)}


def by_kind(rows, level) -> dict[str, Any]:
    """Production-threshold results per claim kind; Summary/Skills also before the evidence and Skills fixes."""
    accept, reject = jev_audit.DEFAULT_THRESHOLDS[level]
    column = 0 if level == "medium" else 1
    result: dict[str, Any] = {}
    for kind in ("bullet", "summary", "skills"):
        subset = [r for r in rows if r.get("kind", "bullet") == kind]
        if not subset:
            continue
        positives = [r for r in subset if LABELS[r["variant"]][column]]
        negatives = [r for r in subset if not LABELS[r["variant"]][column]]
        entry: dict[str, Any] = {"n": len(subset), "positives": len(positives), "negatives": len(negatives)}
        modes = {"current": f"{level}_p_pass"} if kind == "bullet" else {"current": f"{level}_p_pass", "before_fix": f"{level}_baseline_p_pass"}
        for mode, key in modes.items():
            def outcome(row):
                p = row[key]
                return "accept" if p >= accept else ("reject" if p <= reject else "escalate")
            share = lambda items, name: round(sum(outcome(r) == name for r in items) / max(1, len(items)), 3)
            entry[mode] = {"caught": share(negatives, "reject"), "missed": share(negatives, "accept"),
                           "false_reject": share(positives, "reject"), "escalation": share(subset, "escalate"),
                           "false_rejects_by_variant": {v: sum(r["variant"] == v and outcome(r) == "reject" for r in positives)
                                                        for v in LABELS if LABELS[v][column]}}
        if kind == "skills":
            local = [r for r in subset if r.get(f"{level}_choice") == "local_accept"]
            entry["local_accepts"] = len(local)
            entry["local_accepts_of_bad_claims"] = sum(not LABELS[r["variant"]][column] for r in local)
        result[kind] = entry
    return result


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--extra-source", type=Path, help="Local writer_messages.json with a reviewed_source (never written to the report).")
    parser.add_argument("--resumes", type=int, default=6)
    parser.add_argument("--max-cost-usd", type=float, default=3.0)
    # v2 adds Summary sentences and Skills groups; v1 datasets held Experience bullets only.
    parser.add_argument("--dataset", type=Path, default=Path("/app/evals/results/jev-dataset-v2.json"))
    parser.add_argument("--output", type=Path, default=Path("/app/evals/results/jev-audit-report.json"))
    args = parser.parse_args()
    values = configuration(args.env_file)
    meter = Meter(args.max_cost_usd)
    if args.dataset.exists():
        rows = json.loads(args.dataset.read_text())
        if any(row.get("kind", "bullet") != "bullet" and "resume" not in row for row in rows):
            profiles = profiles_from_rows(rows)  # Datasets saved before whole-resume evidence.
            for row in rows:
                if row.get("kind", "bullet") != "bullet":
                    row["resume"] = render_profile(profiles[row["source"]])
                    for stale in ("headers", "skills_text", "corpus"):
                        row.pop(stale, None)
    else:
        rows = await build_dataset(args, values, meter)
        args.dataset.parent.mkdir(parents=True, exist_ok=True)
        args.dataset.write_text(json.dumps(rows))
    for level in ("medium", "high"):
        await run_jev(rows, level, values, meter)
        await run_jev(rows, level, values, meter, baseline=True)
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
