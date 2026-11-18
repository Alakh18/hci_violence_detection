export function metricText(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}
export function toggleSelection(selected, id) {
  return selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
}

// The website reports one decision only: violence or non-violence, from the binary
// violence head ("indian_pilot"). Six-class behavior labels are never shown.
export function violenceVerdict(result) {
  const pilot = result?.indian_pilot;
  if (!pilot || !Number.isFinite(pilot.violence_score)) return { state: "unavailable", score: null, threshold: null };
  return { state: pilot.flagged ? "violence" : "non_violence", score: pilot.violence_score, threshold: pilot.threshold };
}
export function verdictLabel(state) {
  return { violence: "Violence", non_violence: "Non-violence" }[state] ?? "Not available";
}
export function describeFinding(result) {
  if (!result) return { tone: "muted", text: "The app could not look at this video." };
  const verdict = violenceVerdict(result);
  if (verdict.state === "violence") return { tone: "bad", text: "The app thinks this video shows violence." };
  if (verdict.state === "non_violence") return { tone: "ok", text: "The app did not see violence in this video." };
  if (result.execution_mode === "cached_example") return { tone: "muted", text: "This saved example has no violence score. Upload the clip to check it with the violence model." };
  return { tone: "muted", text: "The violence model is not loaded. Start the app with --indian-pilot to get a violence / non-violence answer." };
}

export const decisions = [
  { value: "correct", label: "Yes, it's right", tone: "ok", icon: "check" },
  { value: "incorrect", label: "No, it's wrong", tone: "bad", icon: "cross" },
  { value: "uncertain", label: "I'm not sure", tone: "warn", icon: "question" },
  { value: "not_assessable", label: "Can't tell from this video", tone: "muted", icon: "blocked" },
];
export function decisionLabel(value) {
  return decisions.find(d => d.value === value)?.label ?? "Not answered yet";
}

export function itemStatus(status, reviewed) {
  if (status === "completed") return reviewed ? { tone: "ok", icon: "check", label: "Reviewed" } : { tone: "ok", icon: "check", label: "Ready for you" };
  if (status === "running") return { tone: "info", icon: "spinner", label: "Checking now" };
  if (status === "queued") return { tone: "warn", icon: "clock", label: "Waiting" };
  if (status === "cancelled") return { tone: "muted", icon: "blocked", label: "Stopped" };
  return { tone: "bad", icon: "cross", label: "Couldn't check" };
}

// Where violence was flagged: the violence head's flagged 2 s windows when it reports
// them, otherwise the whole video when the clip as a whole was flagged.
export function flaggedMoments(result) {
  const pilot = result?.indian_pilot;
  if (!pilot?.flagged) return [];
  if (pilot.flagged_intervals?.length) return pilot.flagged_intervals.map(([a, b]) => [a, b]);
  const duration = result?.anomaly?.metadata?.duration_sec;
  return Number.isFinite(duration) ? [[0, duration]] : [];
}

export function clockText(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Plots the violence score of each 2 s window (the same numbers as the "Violence over
// time" table) against the violence threshold. Falls back to the anomaly model's
// segment scores only when no violence scores exist for this result.
export function timelineSeries(result) {
  const pilot = result?.indian_pilot;
  const anomaly = result?.anomaly;
  if (pilot?.windows?.length) {
    return {
      kind: "violence",
      points: pilot.windows.map((w) => ({
        start: w.start_sec,
        end: w.end_sec,
        score: w.violence_score,
      })),
      threshold: pilot.threshold,
    };
  }
  if (anomaly?.segment_scores?.length) {
    return {
      kind: "anomaly",
      points: anomaly.segment_scores.map((score, i) => ({
        start: anomaly.timestamps[i][0],
        end: anomaly.timestamps[i][1],
        score,
      })),
      threshold: result?.policy?.anomaly_threshold ?? 0.5,
    };
  }
  return null;
}
