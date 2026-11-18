"""Indian pilot v4: retrain the violence head with your own labelled Indian clips, then test once.

Runs on a laptop (Windows/Mac/Linux, CPU or CUDA). It reuses the repo's frozen C3D
extractor, the same one-linear-layer head as v1-v3, and the same validation-only
threshold rule. Unlike the v3 scripts it needs no external SSD paths.

Steps (run from the repo root, venv active):

  1. check    validate data/indian_v4/labels.csv and print counts / warnings
  2. extract  C3D features for every listed video (cached; safe to rerun)
  3. train    fine-tune from the v3 head on 2 s windows; pick the threshold on validation
  4. test     score the held-out test clips ONCE (refuses to rerun) vs the v3 baseline

labels.csv columns (one row per labelled stretch of video):
  video       path to the file, relative to the CSV folder or absolute
  start_sec   start of the stretch in seconds (blank = start of video)
  end_sec     end of the stretch in seconds (blank = end of video)
  label       violence | non_violence
  source      camera / incident / uploader ID. Every row from the same camera or the
              same incident MUST share a source, and a source must stay in one split.
  split       train | val | test
"""

import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

LABELS = {"non_violence": 0, "violence": 1}
SPLITS = ("train", "val", "test")
C3D_MEAN, C3D_ORDER, UNIT = (104, 117, 128), "rgb", 16
OUT = Path("runs/indian_v4")


# ---------------------------------------------------------------- labels and windows


def read_labels(csv_path: Path) -> list[dict]:
    csv_path = Path(csv_path)
    rows = []
    with csv_path.open(encoding="utf-8-sig", newline="") as stream:
        for line, raw in enumerate(csv.DictReader(stream), start=2):
            row = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
            missing = {"video", "label", "source", "split"} - {k for k, v in row.items() if v}
            if missing:
                raise ValueError(f"{csv_path.name} line {line}: missing {sorted(missing)}")
            if row["label"] not in LABELS:
                raise ValueError(f"line {line}: label must be violence or non_violence")
            if row["split"] not in SPLITS:
                raise ValueError(f"line {line}: split must be train, val or test")
            video = Path(row["video"])
            video = video if video.is_absolute() else csv_path.parent / video
            start = float(row["start_sec"]) if row.get("start_sec") else 0.0
            end = float(row["end_sec"]) if row.get("end_sec") else math.inf
            if not 0 <= start < end:
                raise ValueError(f"line {line}: need 0 <= start_sec < end_sec")
            rows.append(
                dict(
                    line=line,
                    video=video,
                    start=start,
                    end=end,
                    label=LABELS[row["label"]],
                    source=row["source"],
                    split=row["split"],
                )
            )
    if not rows:
        raise ValueError("labels.csv has no rows")
    splits_of = defaultdict(set)
    for row in rows:
        splits_of[row["source"]].add(row["split"])
        splits_of["video:" + str(row["video"].resolve())].add(row["split"])
    leaks = {k: sorted(v) for k, v in splits_of.items() if len(v) > 1}
    if leaks:
        raise ValueError(f"Same source/video in more than one split (test leakage): {leaks}")
    return rows


def window_starts(units: int, fps: float, start: float, end: float, max_windows: int) -> list:
    """Non-overlapping 2 s windows (in C3D units) inside [start, end), evenly capped."""
    width = max(1, math.ceil(round(2.0 * fps) / UNIT))
    stop = end * fps / UNIT if math.isfinite(end) else units
    # Units fully inside the stretch, so no frames from outside its label leak in.
    first, last = math.ceil(start * fps / UNIT - 1e-9), min(units, math.floor(stop + 1e-9))
    if last - first < 1:  # stretch shorter than one unit: use the overlapping units
        first, last = math.floor(start * fps / UNIT), min(units, math.ceil(stop))
    if last - first < 1:
        return []
    if last - first <= width:
        return [(first, last)]
    starts = list(range(first, last - width + 1, width))
    if len(starts) > max_windows:  # same evenly-spaced rule as V3_PROTOCOL.md
        n = len(starts)
        starts = [starts[math.floor((i + 0.5) * n / max_windows)] for i in range(max_windows)]
    return [(s, s + width) for s in starts]


def pooled(units: np.ndarray) -> np.ndarray:
    """What the head sees: mean of the 32 L2-normalised C3D segments of a window."""
    from surveillance.video.segmentation import aggregate_segments

    return aggregate_segments(units, 32).mean(0)


def file_key(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_windows(rows, units_dir: Path, max_windows: int) -> dict:
    """{split: (X [N,4096], y [N], sources [N])} from cached C3D units."""
    index = json.loads((units_dir / "index.json").read_text(encoding="utf-8"))
    out = {s: ([], [], []) for s in SPLITS}
    for row in rows:
        entry = index.get(str(row["video"].resolve()))
        if entry is None:
            raise ValueError(f"No features for {row['video']}; run extract first")
        units = np.load(units_dir / entry["file"])
        for a, b in window_starts(len(units), entry["fps"], row["start"], row["end"], max_windows):
            x, y, s = out[row["split"]]
            x.append(pooled(units[a:b]))
            y.append(row["label"])
            s.append(row["source"])
    return {
        k: (np.asarray(x, dtype=np.float32).reshape(-1, 4096), np.asarray(y), np.asarray(s))
        for k, (x, y, s) in out.items()
    }


# ---------------------------------------------------------------- commands


def cmd_check(args):
    rows = read_labels(args.labels)
    missing = sorted({str(r["video"]) for r in rows if not r["video"].is_file()})
    if missing:
        raise FileNotFoundError(f"{len(missing)} videos not found, e.g. {missing[:3]}")
    table = Counter((r["split"], r["label"]) for r in rows)
    sources = defaultdict(set)
    for r in rows:
        sources[(r["split"], r["label"])].add(r["source"])
    print("split   label          rows  sources")
    for split in SPLITS:
        for name, value in LABELS.items():
            print(
                f"{split:<7} {name:<13} {table[(split, value)]:>5} "
                f"{len(sources[(split, value)]):>7}"
            )
    by_source = defaultdict(set)
    for r in rows:
        by_source[r["source"]].add(r["label"])
    violent = {r["source"] for r in rows if r["label"] == 1}
    matched = sum(len(by_source[s]) == 2 for s in violent)
    print(f"\nviolent sources that also have calm footage: {matched}/{len(violent)}")
    if violent and matched / len(violent) < 0.5:
        print(
            "WARNING: most violent sources have no calm footage from the same camera/source. "
            "The model can learn 'which camera' instead of 'violence' (the v1 problem)."
        )
    for split in ("val", "test"):
        if len(sources[(split, 1)]) < 5:
            print(f"WARNING: {split} has violence from under 5 sources; results will be noisy.")


def cmd_extract(args):
    import torch

    from surveillance.features.c3d import C3DExtractor
    from surveillance.video.decode import iter_clips, probe_video
    from surveillance.video.transforms import c3d_transform

    rows = read_labels(args.labels)
    units_dir = OUT / "units"
    units_dir.mkdir(parents=True, exist_ok=True)
    index_path = units_dir / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    extractor = C3DExtractor(args.c3d_checkpoint, args.device, args.batch_size, C3D_MEAN, C3D_ORDER)
    videos = sorted({r["video"].resolve() for r in rows})
    for number, video in enumerate(videos, 1):
        key = file_key(video)
        if index.get(str(video), {}).get("sha256") == key:
            continue
        fps = probe_video(video).fps
        outputs, batch = [], []
        with torch.inference_mode():
            for clip in iter_clips(video, UNIT, strict=False):
                batch.append(c3d_transform(clip, C3D_MEAN, C3D_ORDER))
                if len(batch) == args.batch_size:
                    outputs.append(extractor.model(torch.stack(batch).to(extractor.device)).cpu())
                    batch = []
            if batch:
                outputs.append(extractor.model(torch.stack(batch).to(extractor.device)).cpu())
        units = torch.cat(outputs).numpy().astype(np.float32)
        name = f"{key[:24]}.npy"
        np.save(units_dir / name, units)
        index[str(video)] = {"file": name, "sha256": key, "fps": fps, "units": len(units)}
        index_path.write_text(json.dumps(index, indent=1), encoding="utf-8")
        print(f"[{number}/{len(videos)}] {video.name}: {len(units)} units at {fps:.1f} fps")
    print("features ready in", units_dir)


def _old_cache(cache: Path, manifest: Path):
    """Pooled train bags from the teammate's v3 cache (optional replay of old data)."""
    registration = json.loads((cache / "registration.json").read_text(encoding="utf-8"))
    files = registration["features"]
    xs, ys = [], []
    with manifest.open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            if row["split"] == "train" and row["video_id"] in files:
                xs.append(np.load(cache / files[row["video_id"]]["path"]).mean(0))
                ys.append(row["label"])
    if not xs:
        raise ValueError("No training bags found in the old cache")
    print(f"replaying {len(xs)} old training clips ({sum(ys)} violent)")
    return np.asarray(xs, dtype=np.float32), np.asarray(ys)


def cmd_train(args):
    import torch
    from torch.nn import functional as F

    from surveillance.evaluation.indian_binary import calibrate_threshold, evaluate_binary
    from surveillance.models.indian_binary import FrozenBagBinaryHead
    from surveillance.training.indian_binary import load_binary_checkpoint

    rows = read_labels(args.labels)
    data = build_windows(rows, OUT / "units", args.max_windows)
    (x_tr, y_tr, _), (x_val, y_val, _) = data["train"], data["val"]
    for split, y in (("train", y_tr), ("val", y_val)):
        if set(y.tolist()) != {0, 1}:
            raise ValueError(f"{split} needs both violence and non_violence windows")
    print(
        f"windows  train {len(y_tr)} ({int(y_tr.sum())} violent)  "
        f"val {len(y_val)} ({int(y_val.sum())} violent)"
    )
    old = _old_cache(args.old_cache, args.old_manifest) if args.old_cache else None

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    if args.init:
        model, _ = load_binary_checkpoint(args.init)
        model.train()
    else:
        model = FrozenBagBinaryHead(4096)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    counts = np.bincount(y_tr, minlength=2)
    weights = torch.tensor(len(y_tr) / (2 * counts), dtype=torch.float32)

    def scores(x):
        model.eval()
        with torch.no_grad():
            out = model(torch.from_numpy(x)[:, None]).softmax(-1)[:, 1].numpy()
        model.train()
        return out

    def batch():
        new = rng.integers(len(y_tr), size=args.batch_size if old is None else args.batch_size // 2)
        x, y = x_tr[new], y_tr[new]
        if old is not None:
            pick = rng.integers(len(old[1]), size=args.batch_size - len(new))
            x, y = np.concatenate([x, old[0][pick]]), np.concatenate([y, old[1][pick]])
        return torch.from_numpy(x)[:, None], torch.from_numpy(y).long()

    run = OUT / "model"
    run.mkdir(parents=True, exist_ok=True)
    best, stale, history = (-1.0, -1.0), 0, []
    for step in range(1, args.steps + 1):
        x, y = batch()
        loss = F.cross_entropy(model(x), y, weight=weights)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        if step % args.eval_every and step != args.steps:
            continue
        report = evaluate_binary(y_val.tolist(), scores(x_val).tolist())
        selection = (report["average_precision"], report["roc_auc"])
        history.append(
            {"step": step, "loss": float(loss), "val_ap": selection[0], "val_roc_auc": selection[1]}
        )
        if selection > best:
            best, stale = selection, 0
            torch.save(
                {
                    "checkpoint_type": "indian_frozen_bag_binary_v1",
                    "classes": ["non_violence", "violence"],
                    "feature_dim": 4096,
                    "model_state": model.state_dict(),
                    "step": step,
                    "notes": "indian_v4 fine-tune; selected on validation AP",
                },
                run / "best.pt",
            )
        else:
            stale += args.eval_every
        print(
            f"step {step:>5}  loss {float(loss):.4f}  val AP {selection[0]:.3f}  "
            f"ROC-AUC {selection[1]:.3f}"
        )
        if args.patience and stale >= args.patience:
            print("early stop: validation stopped improving")
            break

    model, _ = load_binary_checkpoint(run / "best.pt")
    val_scores = model(torch.from_numpy(x_val)[:, None]).softmax(-1)[:, 1].detach().numpy()
    calibration = calibrate_threshold(
        y_val.tolist(),
        val_scores.tolist(),
        split="val",
        min_recall=args.min_recall,
        candidates=[round(0.05 * i, 2) for i in range(1, 20)],
    )
    threshold = calibration["selected_threshold"]
    (run / "calibration.json").write_text(json.dumps(calibration, indent=1), encoding="utf-8")
    (run / "history.json").write_text(json.dumps(history, indent=1), encoding="utf-8")
    spec = {
        "checkpoint": (run / "best.pt").as_posix(),
        "checkpoint_sha256": file_key(run / "best.pt"),
        "threshold": threshold,
        "split_freeze_hash": file_key(args.labels),
        "threshold_rule": f"v4 validation only: max F1 subject to recall >= {args.min_recall}",
        "notes": "Indian pilot v4: fine-tuned on team-labelled Indian clips (indian_v4.py).",
    }
    (run / "spec_v4.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print(f"\nbest val AP {best[0]:.3f}, ROC-AUC {best[1]:.3f}; threshold {threshold}")
    print("spec for the demo:", run / "spec_v4.json")
    print("Do NOT change labels.csv or retrain after running `test`.")


def cluster_bootstrap(y, a, b, sources, n=2000, seed=20261114):
    """95% CI of AP(a) - AP(b), resampling whole sources (cameras/incidents)."""
    from sklearn.metrics import average_precision_score

    rng = np.random.default_rng(seed)
    groups = {s: np.flatnonzero(sources == s) for s in np.unique(sources)}
    names = list(groups)
    diffs = []
    for _ in range(n):
        idx = np.concatenate([groups[names[i]] for i in rng.integers(len(names), size=len(names))])
        if len(set(y[idx].tolist())) == 2:
            ap_a = average_precision_score(y[idx], a[idx])
            diffs.append(ap_a - average_precision_score(y[idx], b[idx]))
    return [float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))] if diffs else None


def cmd_test(args):
    import torch

    from surveillance.evaluation.indian_binary import evaluate_binary
    from surveillance.training.indian_binary import load_binary_checkpoint

    target = OUT / "test_results.json"
    if target.exists():
        raise FileExistsError(
            f"{target} exists: the test set has been used. Collect NEW clips for a new test."
        )
    rows = read_labels(args.labels)
    x, y, sources = build_windows(rows, OUT / "units", args.max_windows)["test"]
    if set(y.tolist()) != {0, 1}:
        raise ValueError("test needs both violence and non_violence windows")
    spec = json.loads((OUT / "model/spec_v4.json").read_text(encoding="utf-8"))
    if file_key(args.labels) != spec["split_freeze_hash"]:
        raise ValueError("labels.csv changed after training; the test would not be clean")
    results, scores = {}, {}
    models = {"v4": (OUT / "model/best.pt", spec["threshold"])}
    if args.baseline:
        models["v3_baseline"] = (args.baseline, args.baseline_threshold)
    for name, (path, threshold) in models.items():
        model, _ = load_binary_checkpoint(Path(path))
        with torch.no_grad():
            scores[name] = model(torch.from_numpy(x)[:, None]).softmax(-1)[:, 1].numpy()
        results[name] = evaluate_binary(y.tolist(), scores[name].tolist(), threshold)
    if "v3_baseline" in scores:
        results["ap_difference_v4_minus_v3_ci95"] = cluster_bootstrap(
            y, scores["v4"], scores["v3_baseline"], sources
        )
    results["windows"] = {
        "total": len(y),
        "violent": int(y.sum()),
        "sources": len(set(sources.tolist())),
    }
    target.write_text(json.dumps(results, indent=1, default=float), encoding="utf-8")
    for name in models:
        r = results[name]
        print(
            f"{name:<12} AP {r['average_precision']:.3f}  ROC-AUC {r['roc_auc']:.3f}  "
            f"precision {r['precision']:.2f}  recall {r['recall']:.2f}  "
            f"false alarms {r['false_positive_rate']:.2f}  at {r['threshold']}"
        )
    if "ap_difference_v4_minus_v3_ci95" in results:
        ci = results["ap_difference_v4_minus_v3_ci95"]
        verdict = "improved" if ci and ci[0] > 0 else "improvement not shown"
        print(f"AP difference 95% CI {ci} -> {verdict}")
    print("saved", target)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--labels", type=Path, default=Path("data/indian_v4/labels.csv"))
    parser.add_argument("--max-windows", type=int, default=6, help="2 s windows per labelled row")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check")
    extract = commands.add_parser("extract")
    extract.add_argument(
        "--c3d-checkpoint", type=Path, default=Path("checkpoints/c3d_fc6_openmmlab_v1.pt")
    )
    extract.add_argument("--device", default="cpu")
    extract.add_argument("--batch-size", type=int, default=8)
    train = commands.add_parser("train")
    train.add_argument(
        "--init",
        type=Path,
        default=Path("runs/indian_pilot/experiments_v3/v3_all_s7/best.pt"),
        help="start from this head (use --init '' to train from scratch)",
    )
    train.add_argument("--old-cache", type=Path, help="teammate's c3d_v3_trainval folder")
    train.add_argument(
        "--old-manifest", type=Path, default=Path("manifests/v3-pilot/split_v3/manifest.jsonl")
    )
    train.add_argument("--steps", type=int, default=1500)
    train.add_argument("--eval-every", type=int, default=25)
    train.add_argument("--patience", type=int, default=300)
    train.add_argument("--batch-size", type=int, default=16)
    train.add_argument("--learning-rate", type=float, default=1e-4)
    train.add_argument("--min-recall", type=float, default=0.8)
    train.add_argument("--seed", type=int, default=7)
    test = commands.add_parser("test")
    test.add_argument(
        "--baseline", type=Path, default=Path("runs/indian_pilot/experiments_v3/v3_all_s7/best.pt")
    )
    test.add_argument("--baseline-threshold", type=float, default=0.40)
    args = parser.parse_args()
    if getattr(args, "init", None) is not None and str(args.init) in {"", "."}:
        args.init = None
    {"check": cmd_check, "extract": cmd_extract, "train": cmd_train, "test": cmd_test}[
        args.command
    ](args)


if __name__ == "__main__":
    from _common import run_cli

    run_cli(main)
