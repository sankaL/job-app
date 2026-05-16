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


def assess_resume_length(*, generated_text: str, source_text: str, target_length: str | None) -> dict[str, Any]:
    config = get_length_config(target_length)
    generated_word_count = word_count(generated_text)
    source_word_count = word_count(source_text)
    source_aware_minimum = min(
        int(config["target_min"]),
        math.floor(max(0, source_word_count) * 0.80),
    )
    below_target_min = generated_word_count < int(config["target_min"])
    below_source_aware_min = generated_word_count < source_aware_minimum
    return {
        "target_length": str(target_length or "1_page"),
        "target_label": config["label"],
        "target_min": int(config["target_min"]),
        "target_max": int(config["target_max"]),
        "hard_cap": int(config["hard_cap"]),
        "generated_word_count": generated_word_count,
        "source_word_count": source_word_count,
        "source_aware_minimum": source_aware_minimum,
        "below_target_min": below_target_min,
        "below_source_aware_min": below_source_aware_min,
        "source_limited_length": below_target_min and not below_source_aware_min,
    }
