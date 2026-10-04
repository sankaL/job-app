from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import model_config  # noqa: E402


@pytest.fixture(autouse=True)
def _restore_model_config():
    """Tests may point roles at fake model names; always restore the checked-in file."""
    yield
    model_config.set_override(None)
