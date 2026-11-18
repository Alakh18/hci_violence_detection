import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import Municipal from "./Municipal.jsx";
import {
  describeFinding,
  flaggedMoments,
  timelineSeries,
  verdictLabel,
  violenceVerdict,
} from "./platform-utils.js";

const modes = [
  {
    id: "verified",
    name: "Verified examples",
    note: "Frozen, rehearsed cases",
  },
  { id: "live", name: "Live upload", note: "Actual model inference" },
  {
    id: "limitation",
    name: "Known limitations",
    note: "Failures worth discussing",
  },
];
const number = (value, digits = 3) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const clock = (value) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.detail || "The local service could not complete this request.",
    );
  return data;
}
function Icon({ name, size = 18 }) {
  const shapes = {
    play: <path d="m9 5 11 7-11 7Z" />,
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5" />
        <path d="M4 16v5h16v-5" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18M5 15l5-6 4 4 6-9" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z" />
        <path d="M12 8v5m0 3v1" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name] || shapes.chart}
    </svg>
  );
}
function Timeline({ result, current, onSeek }) {
  const [hover, setHover] = useState(null);
  const series = timelineSeries(result);
  const violence = series?.kind === "violence";
  const pts = series?.points || [];
  const duration = Math.max(
    result?.anomaly?.metadata.duration_sec || 0,
    pts.length ? pts[pts.length - 1].end : 0,
  ) || 1;
  const threshold = series?.threshold ?? 0.5;
  const x = (t) => 46 + (Math.min(t, duration) / duration) * 846;
  const y = (score) => 132 - score * 105;
  const mid = (p) => (p.start + p.end) / 2;
  const points = pts.map((p) => `${x(mid(p))},${y(p.score)}`).join(" ");
  // Hover/click zones: from one point's start to the next point's start, so the
  // overlapping 2 s windows (1 s apart) do not stack on top of each other.
  const zoneEnd = (i) => (i + 1 < pts.length ? pts[i + 1].start : pts[i].end);
  const spanText = (p) => `${clock(p.start)}–${clock(p.end)}`;
  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <h2>
          <Icon name="chart" />
          {violence ? "Violence score timeline" : "Anomaly timeline"}
        </h2>
        <span className="muted">
          {violence
            ? `${pts.length} two-second windows`
            : "Sultani · 32 segments"}
        </span>
      </div>
      <div className="chart-wrap">
        <svg
          viewBox="0 0 930 170"
          className="timeline"
          role="img"
          aria-label={
            series
              ? violence
                ? "Violence score per two-second window; dashed line is the violence threshold"
                : "Anomaly scores over video time; dashed line is the frozen routing threshold"
              : "Timeline awaiting inference"
          }
        >
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line x1="46" x2="892" y1={y(v)} y2={y(v)} className="gridline" />
              <text x="31" y={y(v) + 4} textAnchor="end">
                {v.toFixed(2)}
              </text>
            </g>
          ))}
          {flaggedMoments(result).map(([start, end], i) => (
            <rect
              key={i}
              x={x(start)}
              y="22"
              width={Math.max(2, x(end) - x(start))}
              height="110"
              className="window-highlight"
            />
          ))}
          <line
            x1="46"
            x2="892"
            y1={y(threshold)}
            y2={y(threshold)}
            className="threshold"
          />
          {series && (
            <>
              <polygon
                points={`${x(mid(pts[0]))},132 ${points} ${x(mid(pts[pts.length - 1]))},132`}
                className="chart-area"
              />
              <polyline points={points} className="score-line" />
              {violence &&
                pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={x(mid(p))}
                    cy={y(p.score)}
                    r="3"
                    className={
                      "chart-dot" + (p.score >= threshold ? " above" : "")
                    }
                  />
                ))}
              <line
                x1={x(current)}
                x2={x(current)}
                y1="22"
                y2="132"
                className="playhead"
              />
              {pts.map((p, i) => (
                <g
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSeek(p.start)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={x(p.start)}
                    y="20"
                    width={Math.max(4, x(zoneEnd(i)) - x(p.start))}
                    height="113"
                    fill="transparent"
                  />
                  {hover === i && (
                    <circle
                      cx={x(mid(p))}
                      cy={y(p.score)}
                      r="5"
                      className="chart-dot"
                    />
                  )}
                </g>
              ))}
            </>
          )}
          {[0, 1, 2, 3, 4].map((i) => (
            <text key={i} x={46 + i * 211.5} y="157" textAnchor="middle">
              {series ? clock((duration * i) / 4) : "—"}
            </text>
          ))}
          {!series && (
            <text x="469" y="88" textAnchor="middle" className="chart-empty">
              Scores appear after analysis
            </text>
          )}
        </svg>
        <div className="chart-legend">
          <span>
            <i className="teal-dot" />
            {violence ? "Violence score" : "Anomaly score"}
          </span>
          <span>
            <i className="amber-line" />
            {violence ? "Violence threshold" : "Fixed threshold"}{" "}
            {threshold.toFixed(2)}
          </span>
          <span>
            <i className="window-dot" />
            Violence flagged
          </span>
          <span className="chart-readout">
            {hover === null || !pts[hover]
              ? "Click a point to seek"
              : violence
                ? `${spanText(pts[hover])} · ${number(pts[hover].score)}`
                : `Segment ${hover + 1} · ${number(pts[hover].score)}`}
          </span>
        </div>
      </div>
      {series && (
        <details className="score-data">
          <summary>
            {violence ? "Inspect window values" : "Inspect segment values"}
          </summary>
          <div className="segment-data">
            {pts.map((p, i) => (
              <button
                key={i}
                onClick={() => onSeek(p.start)}
                aria-label={`Seek ${spanText(p)}, score ${number(p.score)}`}
              >
                <span>{violence ? clock(p.start) : String(i + 1).padStart(2, "0")}</span>
                {number(p.score)}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
function App() {
  const [status, setStatus] = useState(null),
    [mode, setMode] = useState("verified"),
    [selected, setSelected] = useState(null);
  const [uploaded, setUploaded] = useState(null),
    [filename, setFilename] = useState(""),
    [response, setResponse] = useState(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [current, setCurrent] = useState(0),
    [elapsed, setElapsed] = useState(0);
  const video = useRef(null),
    input = useRef(null),
    revision = useRef(0),
    started = useRef(0),
    poll = useRef(null);
  const result = response?.result;
  const examples = status?.examples.filter((e) => e.kind === mode) || [];
  const missing = Object.entries(status?.assets || {})
    .filter(([, v]) => !v)
    .map(([k]) => k.replace("_checkpoint", ""));
  const source = mode === "live" ? uploaded?.video_url : selected?.video_url;
  const verdict = violenceVerdict(result);
  const finding = describeFinding(result);
  const violenceWindows = result?.indian_pilot?.windows || [];
  const actors = result
    ? result.behavior.windows.length
      ? Math.max(...result.behavior.windows.map((w) => w.actor_count))
      : null
    : null;
  const alertTitle = !result
    ? "Awaiting analysis"
    : verdict.state === "unavailable"
      ? "No violence answer"
      : verdictLabel(verdict.state);
  async function refresh() {
    try {
      setStatus(await api("/api/status"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    return () => clearTimeout(poll.current);
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed((performance.now() - started.current) / 1000),
      500,
    );
    return () => clearInterval(timer);
  }, [busy]);
  function reset() {
    revision.current++;
    setResponse(null);
    setError("");
    setCurrent(0);
  }
  function changeMode(id) {
    if (busy) return;
    reset();
    setMode(id);
    setSelected(null);
  }
  function seek(seconds) {
    if (video.current) {
      video.current.currentTime = seconds;
      setCurrent(seconds);
    }
  }
  async function upload(file) {
    if (!file || busy) return;
    reset();
    setMode("live");
    setSelected(null);
    setUploaded(null);
    setFilename(file.name);
    setBusy(true);
    setPhase("Uploading video");
    started.current = performance.now();
    const rev = revision.current;
    try {
      const body = new FormData();
      body.append("file", file);
      const data = await api("/api/upload", { method: "POST", body });
      if (rev === revision.current) setUploaded(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setPhase("");
    }
  }
  async function analyze() {
    if (busy) return;
    setResponse(null);
    setError("");
    setBusy(true);
    setElapsed(0);
    started.current = performance.now();
    setPhase(
      mode === "live" ? "Running frozen pipeline" : "Checking cached example",
    );
    const rev = ++revision.current;
    try {
      const payload =
        mode === "live"
          ? { upload_id: uploaded.upload_id }
          : { example: selected.name, use_cache: true };
      const { job_id } = await api("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      async function check() {
        try {
          const data = await api(`/api/jobs/${job_id}`);
          if (rev !== revision.current) return;
          if (data.status === "complete") {
            setResponse(data);
            setBusy(false);
            setPhase("");
          } else if (data.status === "failed") {
            setError(data.error);
            setBusy(false);
            setPhase("");
          } else {
            setPhase(
              mode === "live"
                ? "Running frozen pipeline"
                : "Reading verified result",
            );
            poll.current = setTimeout(check, 500);
          }
        } catch (e) {
          setError(e.message);
          setBusy(false);
          setPhase("");
        }
      }
      check();
    } catch (e) {
      setError(e.message);
      setBusy(false);
      setPhase("");
    }
  }
  const ready =
    mode === "live"
      ? !!uploaded
      : !!selected?.video_available && !!selected?.cache_available;
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Surveillance">
          <span className="brand-symbol">
            <Icon name="camera" size={21} />
          </span>
          <strong>Surveillance</strong>
        </a>
      </header>
      <div className="workspace-bar">
        <div>
          <span className="eyebrow">Two-Paper Cascade</span>
          <h1>Violence detection</h1>
        </div>
        <div className="workspace-info">
          <span>Frozen models · fixed thresholds</span>
          <span className="numeric">
            {status?.device === "mps"
              ? "Apple graphics"
              : status?.device === "cuda"
                ? "Graphics processor"
                : "Processor safe mode"}
          </span>
          <button
            className="icon-button"
            onClick={refresh}
            disabled={busy}
            aria-label="Refresh asset readiness"
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>
      <main className="workspace">
        <aside className="library">
          <div className="library-title">
            <h2>Demo library</h2>
            <span className="muted">03 modes</span>
          </div>
          <nav aria-label="Demonstration mode" className="mode-nav">
            {modes.map((m, i) => (
              <button
                key={m.id}
                disabled={busy}
                aria-pressed={mode === m.id}
                className={mode === m.id ? "mode active" : "mode"}
                onClick={() => changeMode(m.id)}
              >
                <span className="mode-index">0{i + 1}</span>
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.note}</small>
                </span>
              </button>
            ))}
          </nav>
          <div className="library-section">
            <span className="eyebrow">
              {mode === "live" ? "Your Local Video" : "Select A Case"}
            </span>
            <span className="count">
              {mode === "live" ? "" : examples.length}
            </span>
          </div>
          {mode === "live" ? (
            <div className="upload-note">
              <Icon name="upload" size={26} />
              <h3>Bring your own clip</h3>
              <p>
                Short surveillance-like videos work best. This mode always runs
                the frozen models.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => input.current.click()}
              >
                Choose a video
              </button>
              <p className="small">
                .mp4, .mov, .avi, .mkv, .webm · up to 500 megabytes
              </p>
            </div>
          ) : (
            <div className="case-list">
              {examples.map((e, i) => (
                <button
                  disabled={busy}
                  key={e.name}
                  className={
                    selected?.name === e.name ? "case selected" : "case"
                  }
                  onClick={() => {
                    reset();
                    setSelected(e);
                  }}
                >
                  <span className="case-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>
                      {mode === "limitation" ? "Limitation" : "Example"} clip{" "}
                      {i + 1}
                    </strong>
                    <small>
                      {e.video_available && e.cache_available
                        ? "Local cache installed"
                        : "Awaiting assets"}
                    </small>
                  </span>
                  <span
                    className={
                      e.video_available ? "asset-dot installed" : "asset-dot"
                    }
                    title={
                      e.video_available ? "Video installed" : "Video missing"
                    }
                  />
                </button>
              ))}
            </div>
          )}
          <div className="library-bottom">
            <Icon name="shield" />
            <p>
              <strong>Qualitative examples</strong>Selected cases explain
              behavior and failure. They are not new benchmark evidence.
            </p>
          </div>
        </aside>
        <div className="analysis-column">
          <section className="panel video-panel">
            <div className="panel-heading">
              <h2>
                <Icon name="camera" />
                {mode === "live"
                  ? filename || "Live video upload"
                  : selected
                    ? `${mode === "limitation" ? "Limitation" : "Example"} clip ${examples.indexOf(selected) + 1}`
                    : "Video workspace"}
              </h2>
              <span className="source-label">
                {mode === "live"
                  ? "Live Inference"
                  : mode === "limitation"
                    ? "Known Limitation"
                    : "Verified Example"}
              </span>
            </div>
            <div
              className={"video-stage " + (source ? "has-video" : "")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                upload(e.dataTransfer.files[0]);
              }}
            >
              {source ? (
                <video
                  ref={video}
                  key={source}
                  src={source}
                  controls
                  playsInline
                  onTimeUpdate={() => setCurrent(video.current.currentTime)}
                  onError={() =>
                    setError(
                      "The browser could not play this video. Use an H.264 mp4 for presentation playback. Inference may support other codecs.",
                    )
                  }
                />
              ) : (
                <div className="video-empty">
                  <div className="viewfinder">
                    <Icon
                      name={mode === "live" ? "upload" : "camera"}
                      size={34}
                    />
                  </div>
                  <h3>
                    {mode === "live"
                      ? "Drop a video to inspect"
                      : "Select a case to begin"}
                  </h3>
                  <p>
                    {mode === "live"
                      ? "Your video stays on this Mac."
                      : "Review a rehearsed example or switch to live upload."}
                  </p>
                  {mode === "live" && (
                    <button
                      className="empty-upload"
                      disabled={busy}
                      onClick={() => input.current.click()}
                    >
                      Browse local files
                    </button>
                  )}
                </div>
              )}
              <span className="video-corner">Research / Human Review</span>
            </div>
            <div className="video-controls">
              <div className="video-detail">
                <span className="numeric">
                  {source ? clock(current) : "—:—"}
                </span>
                <span>
                  {mode === "live"
                    ? "Actual frozen-model processing"
                    : "Content & model identity checked on analysis"}
                </span>
              </div>
              <button
                className="primary"
                disabled={!ready || busy}
                onClick={analyze}
              >
                <Icon name="play" size={16} />
                {busy
                  ? "Processing…"
                  : mode === "live"
                    ? "Run live inference"
                    : "Open cached result"}
              </button>
            </div>
          </section>
          {busy && (
            <div className="process-banner" role="status">
              <span className="spinner" />
              <strong>{phase}</strong>
              <span className="numeric">{elapsed.toFixed(1)}s elapsed</span>
              <small>
                Local inference can take time. No simulated progress or
                predictions.
              </small>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <strong>Processing unavailable</strong>
              <p>{error}</p>
            </div>
          )}
          <Timeline result={result} current={current} onSeek={seek} />
          <section className="panel intervals-panel">
            <div className="panel-heading">
              <h2>Violence over time</h2>
              <span className="muted">
                {violenceWindows.length
                  ? `${violenceWindows.length} two-second windows`
                  : "Violence / non-violence per window"}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time interval</th>
                    <th>Violence score</th>
                    <th>Answer</th>
                  </tr>
                </thead>
                <tbody>
                  {violenceWindows.map((w, i) => (
                    <tr key={i}>
                      <td>
                        <button
                          className="seek-button numeric"
                          onClick={() => seek(w.start_sec)}
                        >
                          {clock(w.start_sec)}–{clock(w.end_sec)}
                        </button>
                      </td>
                      <td className="numeric">{number(w.violence_score)}</td>
                      <td>
                        <span className={w.above_threshold ? "warning-text" : ""}>
                          {w.above_threshold ? "Violence" : "Non-violence"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!violenceWindows.length && (
                <div className="table-empty">
                  {result
                    ? result.indian_pilot
                      ? `One score for the whole video: ${number(verdict.score)}.`
                      : "No violence score for this result."
                    : "Run analysis to see violence scores over time."}
                </div>
              )}
            </div>
          </section>
          {response?.overlays.length > 0 && (
            <section className="panel overlays">
              <div className="panel-heading">
                <h2>Actor reference frames</h2>
                <span className="muted">Boxes apply to these frames only</span>
              </div>
              <div className="overlay-grid">
                {response.overlays.map((o, i) => (
                  <figure key={o.url}>
                    <img
                      src={o.url}
                      alt={`Detected actor boxes at analyzed reference frame ${i + 1}`}
                    />
                    <figcaption>{o.caption}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="inspector">
          <section className="panel review-panel">
            <div className="panel-heading">
              <h2>Review status</h2>
              <span className={"status-dot " + (result ? "ready" : "")} />
            </div>
            <div
              className={
                "review-content " +
                (verdict.state === "violence" ? "" : "normal")
              }
            >
              <span className="eyebrow">
                {result ? "Model Output" : "No Prediction Yet"}
              </span>
              <h3>{alertTitle}</h3>
              <p>
                {result
                  ? finding.text
                  : "Select an example or upload a video to check it for violence."}
              </p>
            </div>
            <div className="metric-row">
              <span>Sultani score</span>
              <strong className="numeric">
                {number(result?.anomaly.overall_score)}
              </strong>
            </div>
            <div className="metric-row">
              <span>Routing threshold</span>
              <strong className="numeric">
                0.500 <span className="fixed">Fixed</span>
              </strong>
            </div>
            {result?.indian_pilot && (
              <>
                <div className="metric-row" title={result.indian_pilot.scope}>
                  <span>Violence score</span>
                  <strong className="numeric">
                    {number(result.indian_pilot.violence_score)}{" "}
                    <span className="fixed">
                      {result.indian_pilot.flagged ? "Review" : "Below"}{" "}
                      {number(result.indian_pilot.threshold)}
                    </span>
                  </strong>
                </div>
                <p className="pilot-note">
                  Violence / non-violence model trained on Indian, DCSASS,
                  UBI-Fights and XD-Violence clips. For human review only.
                </p>
              </>
            )}
          </section>
          <section className="panel probability-panel">
            <div className="panel-heading">
              <h2>Violence detection</h2>
              <span className="muted">Two classes</span>
            </div>
            <div className="prediction-label">
              <span>Answer</span>
              <strong>{result ? verdictLabel(verdict.state) : "—"}</strong>
            </div>
            <div className="probabilities">
              {[
                ["Violence", verdict.score],
                ["Non-violence", verdict.score === null ? null : 1 - verdict.score],
              ].map(([name, value]) => (
                <div
                  className={
                    "probability " +
                    (result && verdictLabel(verdict.state) === name ? "leading" : "")
                  }
                  key={name}
                >
                  <div>
                    <span>{name}</span>
                    <span className="numeric">
                      {value === null ? "—" : `${(value * 100).toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="bar-track">
                    {value !== null && <i style={{ width: `${value * 100}%` }} />}
                  </div>
                </div>
              ))}
            </div>
            <p className="small panel-note">
              {verdict.threshold !== null
                ? `Flagged as violence at ${number(verdict.threshold)} or above. `
                : ""}
              Scores are uncalibrated.
            </p>
          </section>
          <section className="panel system-panel">
            <div className="panel-heading">
              <h2>Execution</h2>
              <span className="muted">Local only</span>
            </div>
            <dl>
              <div>
                <dt>Mode</dt>
                <dd>
                  {result
                    ? result.execution_mode === "cached_example"
                      ? "Cached · disclosed"
                      : "Live model inference"
                    : "Awaiting analysis"}
                </dd>
              </div>
              <div>
                <dt>Actors</dt>
                <dd>{actors === null ? "Not examined" : actors}</dd>
              </div>
              <div>
                <dt>Inference</dt>
                <dd className="numeric">
                  {result ? `${number(result.timings.total_seconds, 2)}s` : "—"}
                </dd>
              </div>
              <div>
                <dt>
                  {result?.execution_mode === "cached_example"
                    ? "Cache request"
                    : "Total request"}
                </dt>
                <dd className="numeric">
                  {result
                    ? `${number(result.request_seconds ?? result.timings.request_total_seconds, 3)}s`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Device</dt>
                <dd>
                  {result?.execution_mode === "cached_example"
                    ? "Original run"
                    : "Processor policy"}
                </dd>
              </div>
            </dl>
            {result?.execution_mode === "cached_example" && (
              <p className="small panel-note">
                Inference timing belongs to the original run. This Mac served a
                verified cache.
              </p>
            )}
            {result?.component_devices && (
              <details className="device-details">
                <summary>Component devices</summary>
                {Object.entries(result.component_devices).map(([k, v]) => (
                  <div key={k}>
                    <span>{k.replaceAll("_", " ")}</span>
                    <span className="numeric">{v}</span>
                  </div>
                ))}
              </details>
            )}
            <div className="asset-status">
              <span className={missing.length ? "warning-text" : "good-text"}>
                {!status
                  ? "Connecting to local service"
                  : missing.length
                    ? `${missing.length} model assets missing`
                    : "Model files installed"}
              </span>
              {missing.length > 0 && <p>{missing.join(" · ")}</p>}
              <small>Run preflight to verify hashes & model loading.</small>
            </div>
            {response && (
              <a className="download" href={response.download_url} download>
                <Icon name="download" size={15} />
                Download result file
              </a>
            )}
          </section>
        </aside>
      </main>
      <footer>
        <details className="benchmark-note">
          <summary>Measured research limitations</summary>
          <p>
            Windows research results, unchanged: Collective color features /
            ground truth boxes 77.55% accuracy, F1 0.7947; detected boxes
            74.32%, F1 0.7383. Dcsass accuracy 51.02%, macro F1 0.2140, balanced
            accuracy 22.87%. Binary anomaly accuracy 58.31%, F1 0.6093, area
            under curve 0.6307. Sultani Ucf frame area under curve 0.7441.
            Held-out cascade F1 0.4733, area under curve 0.5118.
            This is not reliable production violence detection.
          </p>
        </details>
        <span className="footer-paper">
          Sultani ’18 × Actor-Transformers ’20
        </span>
      </footer>
      <input
        ref={input}
        type="file"
        accept="video/*,.mkv,.avi"
        aria-label="Upload a local surveillance video"
        className="hidden-input"
        onChange={(e) => {
          upload(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}

createRoot(document.getElementById("root")).render(<Municipal Legacy={App} Timeline={Timeline} />);
