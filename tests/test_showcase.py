from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "showcase"))

from common import ValidationError, load_showcase, validate_showcase  # noqa: E402


class ShowcaseValidationTests(unittest.TestCase):
    def test_repository_dataset_is_valid(self) -> None:
        validate_showcase(load_showcase(ROOT))

    def test_invalid_status_is_rejected(self) -> None:
        data = copy.deepcopy(load_showcase(ROOT))
        data["projects"]["records"][0]["status"] = "done-ish"
        with self.assertRaises(ValidationError):
            validate_showcase(data)

    def test_enabled_link_requires_absolute_url(self) -> None:
        data = copy.deepcopy(load_showcase(ROOT))
        data["links"]["items"][0]["url"] = "/relative"
        with self.assertRaises(ValidationError):
            validate_showcase(data)


if __name__ == "__main__":
    unittest.main()
