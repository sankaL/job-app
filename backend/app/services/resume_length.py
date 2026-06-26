from __future__ import annotations

import math
import re
from typing import Any


WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9+#/&'.-]*")

TARGET_LENGTH_CONFIGS: dict[str, dict[str, Any]] = {
    "1_page": {"label": "1 page", "target_min": 450, "target_max": 700, "hard_cap": 850},
    "2_page": {"label": "2-page", "target_min": 900, "target_max": 1400, "hard_cap": 1600},
    "3_page": {"label": "3-page", "target_min": 1500, "target_max": 2100, "hard_cap": 2400},
}


def get_length_config(target_length: str | None) -> dict[str, Any]:
    return TARGET_LENGTH_CONFIGS.get(str(target_length or "1_page"), TARGET_LENGTH_CONFIGS["1_page"])


def word_count(value: str) -> int:
    return len(WORD_RE.findall(value or ""))


def source_aware_minimum(target_length: str | None, source_word_count: int) -> int:
    config = get_length_config(target_length)
    target_min = int(config["target_min"])
    if source_word_count >= target_min:
        return target_min
    return math.floor(max(0, source_word_count) * 0.90)


def assess_resume_length(*, generated_text: str, source_text: str, target_length: str | None) -> dict[str, Any]:
    config = get_length_config(target_length)
    generated_word_count = word_count(generated_text)
    source_word_count = word_count(source_text)
    minimum_acceptable_words = source_aware_minimum(target_length, source_word_count)
    below_target_min = generated_word_count < int(config["target_min"])
    underfilled = generated_word_count < minimum_acceptable_words
    source_limited_allowed = source_word_count < int(config["target_min"])
    return {
        "target_length": str(target_length or "1_page"),
        "target_label": config["label"],
        "target_min": int(config["target_min"]),
        "target_max": int(config["target_max"]),
        "hard_cap": int(config["hard_cap"]),
        "generated_word_count": generated_word_count,
        "source_word_count": source_word_count,
        "source_aware_minimum": minimum_acceptable_words,
        "minimum_acceptable_words": minimum_acceptable_words,
        "above_hard_cap": generated_word_count > int(config["hard_cap"]),
        "below_target_min": below_target_min,
        "below_source_aware_min": underfilled,
        "underfilled": underfilled,
        "source_limited_allowed": source_limited_allowed,
        "outside_target_range": below_target_min or generated_word_count > int(config["target_max"]),
        "source_limited_length": below_target_min and source_limited_allowed and not underfilled,
    }
