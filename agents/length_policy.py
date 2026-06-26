"""Shared resume length policy for generation, validation, and judging."""

from __future__ import annotations

import math
import re
from typing import Any


WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9+#/&'.-]*")


TARGET_LENGTH_CONFIGS: dict[str, dict[str, Any]] = {
    "1_page": {
        "label": "1 page",
        "target_min": 450,
        "target_max": 700,
        "hard_cap": 850,
        "summary_range": "40-70 words",
        "experience_bullets": 4,
        "skills_categories": 2,
    },
    "2_page": {
        "label": "2 pages",
        "target_min": 900,
        "target_max": 1400,
        "hard_cap": 1600,
        "summary_range": "50-90 words",
        "experience_bullets": 5,
        "skills_categories": 3,
    },
    "3_page": {
        "label": "3 pages",
        "target_min": 1500,
        "target_max": 2100,
        "hard_cap": 2400,
        "summary_range": "60-110 words",
        "experience_bullets": 6,
        "skills_categories": 4,
    },
}


def get_length_config(target_length: str | None) -> dict[str, Any]:
    return TARGET_LENGTH_CONFIGS.get(str(target_length or "1_page"), TARGET_LENGTH_CONFIGS["1_page"])


def target_range_text(config: dict[str, Any]) -> str:
    return f"{config['target_min']}-{config['target_max']} words"


def prompt_config(target_length: str | None) -> dict[str, Any]:
    config = dict(get_length_config(target_length))
    config["target_range"] = target_range_text(config)
    return config


def word_count(value: str) -> int:
    return len(WORD_RE.findall(value or ""))


def source_aware_minimum(target_length: str | None, source_word_count: int) -> int:
    config = get_length_config(target_length)
    target_min = int(config["target_min"])
    if source_word_count >= target_min:
        return target_min
    return math.floor(max(0, source_word_count) * 0.90)


def assess_resume_length(
    *,
    generated_text: str,
    source_text: str,
    target_length: str | None,
) -> dict[str, Any]:
    config = get_length_config(target_length)
    generated_word_count = word_count(generated_text)
    source_word_count = word_count(source_text)
    source_minimum = source_aware_minimum(target_length, source_word_count)
    below_target_min = generated_word_count < int(config["target_min"])
    underfilled = generated_word_count < source_minimum
    source_limited_allowed = source_word_count < int(config["target_min"])
    return {
        "target_length": str(target_length or "1_page"),
        "target_label": config["label"],
        "target_min": int(config["target_min"]),
        "target_max": int(config["target_max"]),
        "hard_cap": int(config["hard_cap"]),
        "source_word_count": source_word_count,
        "generated_word_count": generated_word_count,
        "source_aware_minimum": source_minimum,
        "minimum_acceptable_words": source_minimum,
        "above_hard_cap": generated_word_count > int(config["hard_cap"]),
        "below_target_min": below_target_min,
        "below_source_aware_min": underfilled,
        "underfilled": underfilled,
        "source_limited_allowed": source_limited_allowed,
        "outside_target_range": below_target_min or generated_word_count > int(config["target_max"]),
        "source_limited_length": below_target_min and source_limited_allowed and not underfilled,
    }
