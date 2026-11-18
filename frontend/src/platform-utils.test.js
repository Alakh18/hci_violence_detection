import test from "node:test";
import assert from "node:assert/strict";
import { clockText, decisionLabel, describeFinding, flaggedMoments, itemStatus, metricText, timelineSeries, toggleSelection, verdictLabel, violenceVerdict } from "./platform-utils.js";
test("unknown metrics are never rendered as zero performance", () => {
  assert.equal(metricText(null), "—");
  assert.equal(metricText(undefined), "—");
  assert.equal(metricText(0), "0.000");
});
test("multi-select preserves independent selections", () => {
  assert.deepEqual(toggleSelection(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleSelection(["a", "b"], "a"), ["b"]);
});
test("findings report only violence or non-violence, never behavior classes", () => {
  const behavior = { final_alert: { state: "behavior_review", behavior: "Robbery" } };
  assert.equal(describeFinding({ ...behavior, indian_pilot: { violence_score: 0.8, threshold: 0.4, flagged: true } }).text, "The app thinks this video shows violence.");
  assert.equal(describeFinding({ ...behavior, indian_pilot: { violence_score: 0.1, threshold: 0.4, flagged: false } }).tone, "ok");
  assert.match(describeFinding(behavior).text, /violence model is not loaded/);
  assert.match(describeFinding({ ...behavior, execution_mode: "cached_example" }).text, /saved example has no violence score/);
  assert.doesNotMatch(describeFinding({ ...behavior, indian_pilot: { violence_score: 0.8, threshold: 0.4, flagged: true } }).text, /robbery/i);
  assert.equal(describeFinding(null).text, "The app could not look at this video.");
  assert.equal(violenceVerdict({ indian_pilot: { violence_score: 0.5, threshold: 0.4, flagged: true } }).state, "violence");
  assert.equal(verdictLabel("non_violence"), "Non-violence");
  assert.equal(verdictLabel("unavailable"), "Not available");
});
test("statuses distinguish ready, reviewed and failed items", () => {
  assert.equal(itemStatus("completed", false).label, "Ready for you");
  assert.equal(itemStatus("completed", true).label, "Reviewed");
  assert.equal(itemStatus("queued").label, "Waiting");
  assert.equal(itemStatus("failed").label, "Couldn't check");
  assert.equal(decisionLabel("not_assessable"), "Can't tell from this video");
  assert.equal(decisionLabel(null), "Not answered yet");
});
test("flagged moments come from the violence head only", () => {
  const windows = { behavior: { windows: [{ interval: [1, 3] }] }, anomaly: { metadata: { duration_sec: 20 } } };
  assert.deepEqual(flaggedMoments({ ...windows, indian_pilot: { flagged: true, flagged_intervals: [[4, 9]] } }), [[4, 9]]);
  assert.deepEqual(flaggedMoments({ ...windows, indian_pilot: { flagged: true } }), [[0, 20]]);
  assert.deepEqual(flaggedMoments({ ...windows, indian_pilot: { flagged: false } }), []);
  assert.deepEqual(flaggedMoments(windows), []);
  assert.deepEqual(flaggedMoments(null), []);
});
test("clock text never shows negative or fractional seconds", () => {
  assert.equal(clockText(75.9), "1:15");
  assert.equal(clockText(-2), "0:00");
});

test("the timeline plots the same violence scores as the table", () => {
  const anomaly = { segment_scores: [0.9, 0.1], timestamps: [[0, 1], [1, 2]] };
  const windows = [{ start_sec: 0, end_sec: 2, violence_score: 0.732 }, { start_sec: 1, end_sec: 3, violence_score: 0.2 }];
  const series = timelineSeries({ anomaly, policy: { anomaly_threshold: 0.5 }, indian_pilot: { threshold: 0.6, windows } });
  assert.equal(series.kind, "violence");
  assert.equal(series.threshold, 0.6);
  assert.deepEqual(series.points.map(p => p.score), [0.732, 0.2]);
  assert.equal(timelineSeries({ anomaly, policy: { anomaly_threshold: 0.5 } }).kind, "anomaly");
  assert.equal(timelineSeries(null), null);
});
