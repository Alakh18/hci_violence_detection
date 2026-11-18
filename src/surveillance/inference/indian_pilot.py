"""Optional Indian pilot binary score on the cascade's own C3D bag.

Pilot evidence only: a separately trained head whose training data and test results are
recorded in runs/indian_pilot (v3: Indian, DCSASS, UBI-Fights and XD-Violence clips). It
never changes the cascade alert and is shown separately for human review.
"""

import json
import math
from pathlib import Path

import numpy as np
import torch

from surveillance.datasets.dcsass_audit import sha256
from surveillance.training.indian_binary import load_binary_checkpoint
from surveillance.video.segmentation import aggregate_segments

SCOPE = (
    "Pilot score from a separately trained violence head, outside the cascade's validated "
    "alert. For human review only; it never decides anything."
)
SPEC_KEYS = {"checkpoint", "checkpoint_sha256", "threshold", "split_freeze_hash", "threshold_rule"}
# Loaded automatically when present, so the website always has a violence answer.
DEFAULT_SPEC = Path("runs/indian_pilot/demo/indian_pilot_spec_v3.json")


def load_pilot_spec(path: Path) -> dict:
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    if set(spec) - SPEC_KEYS - {"notes"} or SPEC_KEYS - set(spec):
        raise ValueError(f"Indian pilot spec needs exactly {sorted(SPEC_KEYS)} (+ notes)")
    if not 0 < float(spec["threshold"]) < 1:
        raise ValueError("Indian pilot threshold must be in (0, 1)")
    return spec


def resolve_pilot_spec(
    root: Path, path: Path | None, threshold: float | None = None
) -> dict | None:
    """The explicit --indian-pilot spec, else the default v3 spec if its checkpoint exists.

    ``threshold`` replaces the spec's validation-chosen threshold for this run only; the
    spec file and checkpoint hash are not changed, and the rule records the override.
    """
    if path is not None:
        spec = load_pilot_spec(path)
    else:
        default = Path(root) / DEFAULT_SPEC
        if not default.is_file():
            return None
        spec = load_pilot_spec(default)
        if not (Path(root) / spec["checkpoint"]).is_file():
            return None
    if threshold is not None and float(threshold) != float(spec["threshold"]):
        if not 0 < float(threshold) < 1:
            raise ValueError("--violence-threshold must be between 0 and 1")
        spec = {
            **spec,
            "threshold": float(threshold),
            "threshold_rule": f"operator override {float(threshold):.2f} "
            f"(validation-chosen {float(spec['threshold']):.2f}: {spec['threshold_rule']})",
        }
    return spec


class IndianPilotHead:
    def __init__(self, spec: dict, root: Path):
        path = Path(root) / spec["checkpoint"]
        if sha256(path) != spec["checkpoint_sha256"]:
            raise ValueError("Indian pilot checkpoint differs from its pinned SHA256")
        self.model, _ = load_binary_checkpoint(path, "cpu")
        self.spec = spec

    @torch.inference_mode()
    def score(self, features) -> dict:
        bag = torch.as_tensor(np.asarray(features), dtype=torch.float32)[None]
        probability = float(self.model(bag).softmax(-1)[0, 1])
        threshold = float(self.spec["threshold"])
        return {
            "violence_score": probability,
            "threshold": threshold,
            "flagged": probability >= threshold,
            "threshold_rule": self.spec["threshold_rule"],
            "model_sha256": self.spec["checkpoint_sha256"],
            "split_freeze_hash": self.spec["split_freeze_hash"],
            "scope": SCOPE,
        }

    @torch.inference_mode()
    def score_windows(
        self,
        units,
        fps: float,
        *,
        window_sec: float = 2.0,
        stride_sec: float = 1.0,
        min_consecutive: int = 2,
    ) -> dict:
        """Score sliding 2 s windows, matching the 2 s clips the head was trained on.

        The head was trained and thresholded on 2 s clips. Averaging a long upload into
        one bag dilutes a short fight with the calm footage around it, so long videos
        land near the threshold. Here each window gets its own 32-segment bag. A video
        is flagged only when ``min_consecutive`` overlapping windows pass the threshold,
        which limits extra false alarms from scoring many windows. A clip of 2 s or less
        is a single window, identical to ``score``.
        """
        units = np.asarray(units, dtype=np.float32)
        if units.ndim != 2 or len(units) < 1 or fps <= 0 or min_consecutive < 1:
            raise ValueError("Expected [units, 4096] C3D units, positive fps and min_consecutive")
        unit_sec = 16 / fps
        width = max(1, math.ceil(round(window_sec * fps) / 16))
        stride = max(1, round(stride_sec * fps / 16))
        starts = list(range(0, max(len(units) - width, 0) + 1, stride))
        if starts[-1] + width < len(units):
            starts.append(len(units) - width)  # cover the tail of the video
        bags = np.stack([aggregate_segments(units[s : s + width], 32) for s in starts])
        scores = self.model(torch.from_numpy(bags)).softmax(-1)[:, 1].tolist()
        threshold = float(self.spec["threshold"])
        windows = [
            {
                "start_sec": s * unit_sec,
                "end_sec": min(s + width, len(units)) * unit_sec,
                "violence_score": score,
                "above_threshold": score >= threshold,
            }
            for s, score in zip(starts, scores)
        ]
        intervals, run = [], []
        for window in windows + [None]:
            if window is not None and window["above_threshold"]:
                run.append(window)
                continue
            if len(run) >= min_consecutive:
                intervals.append([run[0]["start_sec"], run[-1]["end_sec"]])
            run = []
        if len(windows) == 1:  # short clip: same rule as the calibrated 2 s test clips
            only = windows[0]
            intervals = [[only["start_sec"], only["end_sec"]]] if only["above_threshold"] else []
        whole_bag = torch.from_numpy(aggregate_segments(units, 32))[None]
        whole = float(self.model(whole_bag).softmax(-1)[0, 1])
        return {
            "violence_score": max(scores),
            "threshold": threshold,
            "flagged": bool(intervals),
            "flagged_intervals": intervals,
            "scoring": f"sliding {window_sec:g} s windows, stride {stride_sec:g} s, "
            f"flag needs {min_consecutive} consecutive windows",
            "whole_clip_score": whole,
            "windows": windows,
            "threshold_rule": self.spec["threshold_rule"],
            "model_sha256": self.spec["checkpoint_sha256"],
            "split_freeze_hash": self.spec["split_freeze_hash"],
            "scope": SCOPE,
        }
