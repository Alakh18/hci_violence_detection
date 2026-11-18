import React, { useEffect, useRef, useState } from "react";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/public-sans/700.css";
import "@fontsource/public-sans/800.css";
import { clockText, decisionLabel, decisions, describeFinding, flaggedMoments, itemStatus, metricText, toggleSelection, verdictLabel, violenceVerdict } from "./platform-utils.js";
import "./municipal.css";

const base = "/api/platform";
async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Something went wrong. Please try again.");
  return payload;
}
const post = (path, data = {}) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const remove = path => request(path, { method: "DELETE" });
const uid = () => crypto.randomUUID();
// XMLHttpRequest (not fetch) so each file can report real upload progress.
function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", base + "/uploads");
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let payload = {};
      try { payload = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new Error(typeof payload.detail === "string" ? payload.detail : "This video could not be added."));
    };
    xhr.onerror = () => reject(new Error("The app could not be reached. Check that it is still running."));
    const body = new FormData(); body.append("file", file); xhr.send(body);
  });
}
const sizeText = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const pretty = value => JSON.stringify(value, null, 2);
const steps = [["add", "Add videos"], ["checking", "Checking"], ["review", "Your review"]];
const technicalPages = ["Video library", "Processing queue", "Results & exports", "Accuracy", "Professor console"];
const videoTypes = ".mp4,.avi,.mov,.mkv,.webm,.m4v";
// Per-browser conveniences only; the backend stays the record of truth.
const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

function Icon({ name, size = 22 }) {
  const shapes = {
    upload: <><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></>,
    check: <path d="M5 12l5 5L20 7" />,
    cross: <path d="M6 6l12 12M18 6L6 18" />,
    question: <><path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.7V15" /><path d="M12 19h.01" /></>,
    blocked: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    spinner: <path d="M21 12a9 9 0 1 1-3-6.7" />,
    play: <path d="M8 5v14l11-7z" fill="currentColor" />,
    lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
    auto: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    film: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" /></>,
    alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17.5h.01" /></>,
    shield: <><path d="M12 3 5 6v6c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={name === "spinner" ? "mp-spin" : undefined}>{shapes[name]}</svg>;
}
function Badge({ status }) {
  return <span className={`mp-badge tone-${status.tone}`}><Icon name={status.icon} size={16} />{status.label}</span>;
}

function Evaluation({ report }) {
  if (!report) return null;
  return <section className="panel mp-section">
    <h2>Evaluation overview</h2><p>{report.warning}</p><p className="muted">{report.definition}</p>
    <div className="mp-metrics">
      <div><strong>{report.eligible_inferred_clips}</strong><span>Eligible inferred clips</span></div>
      <div><strong>{report.violence_labeled}</strong><span>Violence-labeled clips</span></div>
      <div><strong>{metricText(report.violence.macro_f1)}</strong><span>Violence / non-violence macro F1</span></div>
    </div>
    <p>Binary violence: {report.violence.n} covered / {report.violence_labeled} labeled; macro F1 {metricText(report.violence.macro_f1)}. Abstentions: {report.violence_abstentions}.</p>
    <p>Temporal references: {report.temporal.n} clips; false alert seconds {report.temporal.false_alert_seconds.toFixed(2)} / negative seconds {report.temporal.reference_negative_seconds.toFixed(2)}; fraction {metricText(report.temporal.false_alert_fraction)}.</p>
    <details><summary>Library composition, source diversity and selection</summary><pre>{pretty(report.composition)}</pre></details>
    <details><summary>Population exclusions and reference versions</summary><pre>{pretty({ excluded: report.excluded_job_items, reference_versions: report.reference_versions, profile: report.profile_sha256 })}</pre></details>
  </section>;
}

export default function Municipal({ Legacy, Timeline }) {
  const [page, setPage] = useState("home"), [technical, setTechnical] = useState("Video library"), [dashboard, setDashboard] = useState(null);
  const [clips, setClips] = useState([]), [jobs, setJobs] = useState([]), [total, setTotal] = useState(0);
  const [query, setQuery] = useState(""), [population, setPopulation] = useState(""), [assignment, setAssignment] = useState("");
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState([]), [item, setItem] = useState(null);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState(null), [preview, setPreview] = useState(null), [results, setResults] = useState([]);
  const [reviewer, setReviewer] = useState(() => stored("mp-reviewer", "")), [editingName, setEditingName] = useState(false);
  const [decision, setDecision] = useState(null), [notes, setNotes] = useState(""), [marks, setMarks] = useState([]), [markStart, setMarkStart] = useState(null);
  const [reference, setReference] = useState(undefined), [current, setCurrent] = useState(0), [saved, setSaved] = useState(false);
  const [includeReferences, setIncludeReferences] = useState(false), [external, setExternal] = useState(false);
  const [confirm, setConfirm] = useState(null), [uploads, setUploads] = useState([]);
  const [theme, setTheme] = useState(() => stored("mp-theme", "auto")), [names, setNames] = useState(() => stored("mp-names", {})), [dragging, setDragging] = useState(false);
  const video = useRef(null), fileInput = useRef(null), refreshVersion = useRef(0), pendingSubmission = useRef(null);

  // On narrow screens the step tabs scroll sideways; keep the current one in view.
  useEffect(() => { document.querySelector(".mp-step.on")?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [page]);
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", theme);
    store("mp-theme", theme);
  }, [theme]);
  async function refresh() {
    const version = ++refreshVersion.current;
    const [d, c, j, r] = await Promise.all([
      request("/dashboard"), request(`/clips?q=${encodeURIComponent(query)}&population=${population}&assignment=${assignment}&offset=${offset}`),
      request("/jobs?limit=1000"), request("/results?limit=1000")
    ]);
    if (version !== refreshVersion.current) return;
    setDashboard(d); setClips(c.clips); setTotal(c.total); setJobs(j.jobs); setResults(r.records);
  }
  useEffect(() => {
    refresh().catch(e => setError(e.message));
    const timer = setInterval(() => refresh().catch(e => setError(e.message)), 2500);
    return () => { clearInterval(timer); refreshVersion.current++; };
  }, [query, population, assignment, offset]);
  async function action(fn) {
    setError(""); setMessage(""); setBusy(true);
    try { await fn(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function go(target) { setError(""); setMessage(""); setPage(target); window.scrollTo(0, 0); }
  async function openItem(id) {
    await action(async () => {
      const data = await request(`/items/${id}`);
      setItem(data); setReference(undefined); setNotes(""); setMarks([]); setMarkStart(null); setDecision(null); setSaved(false); setCurrent(0);
      go("review");
    });
  }
  function seek(t, play = false) { if (video.current) { video.current.currentTime = t; if (play) video.current.play().catch(() => {}); } setCurrent(t); }
  async function submit() {
    await action(async () => {
      const fingerprint = [...selected].sort().join("|");
      if (pendingSubmission.current?.fingerprint !== fingerprint) pendingSubmission.current = { fingerprint, key: uid() };
      const job = await post("/jobs", { clip_ids: selected, idempotency_key: pendingSubmission.current.key });
      pendingSubmission.current = null;
      setMessage(`Batch ${job.job_id} queued. Inference runs sequentially.`); setSelected([]); setTechnical("Processing queue");
    });
  }
  async function addVideos(files) {
    const videos = files.filter(f => videoTypes.split(",").some(ext => f.name.toLowerCase().endsWith(ext)));
    const skipped = files.length - videos.length;
    if (!videos.length) { setError("These files aren't videos. Choose MP4, MOV, AVI, MKV or WEBM files."); return; }
    go("add");
    const batch = videos.map(f => ({ key: uid(), name: f.name, size: f.size, progress: 0, state: "waiting", error: "" }));
    setUploads(list => [...batch, ...list.filter(u => !["done", "failed"].includes(u.state))]);
    const update = (key, patch) => setUploads(list => list.map(u => u.key === key ? { ...u, ...patch } : u));
    setBusy(true);
    const ids = [], next = { ...names };
    for (const [n, file] of videos.entries()) {
      const { key } = batch[n];
      update(key, { state: "uploading" });
      try {
        const data = await uploadFile(file, progress => update(key, { progress }));
        ids.push(data.clip_id); next[data.clip_id] = file.name;
        update(key, { state: "done", progress: 1 });
      } catch (e) { update(key, { state: "failed", error: e.message }); }
    }
    setNames(next); store("mp-names", next);
    try {
      if (ids.length) {
        await post("/jobs", { clip_ids: [...new Set(ids)], idempotency_key: uid() });
        setMessage(ids.length === 1 ? "Your video was added. The app is checking it now." : `${ids.length} videos were added. The app is checking them one at a time.`);
      }
      const failed = videos.length - ids.length;
      if (failed || skipped) setError([failed && `${failed === 1 ? "1 video" : `${failed} videos`} could not be added. The list below says why.`, skipped && `${skipped === 1 ? "1 file was" : `${skipped} files were`} skipped because ${skipped === 1 ? "it isn't a video" : "they aren't videos"}.`].filter(Boolean).join(" "));
      await refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function checkClip(clipId) {
    await action(async () => {
      await post("/jobs", { clip_ids: [clipId], idempotency_key: uid() });
      go("checking"); setMessage("The app is checking this video now.");
    });
  }
  async function removeClips(ids) {
    setConfirm(null);
    await action(async () => {
      for (const [n, id] of ids.entries()) {
        if (ids.length > 1) setMessage(`Removing video ${n + 1} of ${ids.length}…`);
        await remove(`/clips/${id}/upload`);
      }
      setSelected(current => current.filter(id => !ids.includes(id)));
      if (item && ids.includes(item.clip_id)) { setItem(null); go("add"); }
      setMessage(ids.length === 1 ? "The video was removed from this computer. Answers you saved are kept." : `${ids.length} videos were removed from this computer. Answers you saved are kept.`);
    });
  }
  async function saveReview() {
    if (!decision) { setError("Choose one answer before saving."); return; }
    if (!reviewer.trim()) { setError("Type your name before saving."); setEditingName(true); return; }
    await action(async () => {
      await post(`/items/${item.item_id}/reviews`, { decision, reviewer: reviewer.trim(), notes, intervals: marks });
      store("mp-reviewer", reviewer.trim()); setEditingName(false);
      setItem(await request(`/items/${item.item_id}`)); setSaved(true);
      setMessage("Your answer is saved.");
    });
  }

  const clipName = id => {
    if (names[id]) return names[id];
    const clip = clips.find(c => c.clip_id === id);
    if (!clip) return "Video";
    return clip.population === "upload" ? `Uploaded video ${clip.sha256.slice(0, 6)}` : clip.source_video_id;
  };
  const removed = new Set(clips.filter(c => c.status === "deleted").map(c => c.clip_id));
  const reviewedItems = new Set(results.filter(r => r.review_decision).map(r => r.item_id));
  const ready = results.filter(r => r.status === "completed" && !r.review_decision && !removed.has(r.clip_id));
  const finished = results.filter(r => r.review_decision);
  const items = jobs.flatMap(j => j.items.map(i => ({ ...i, job: j }))).reverse().filter(i => !removed.has(i.clip_id));
  const checkingIds = new Set(items.filter(i => ["queued", "running"].includes(i.status)).map(i => i.clip_id));
  const available = clips.filter(c => c.status === "available");
  const removable = available.filter(c => c.owned_upload && !checkingIds.has(c.clip_id));
  const removeControl = id => {
    const clip = clips.find(c => c.clip_id === id);
    if (!clip || clip.status !== "available" || !clip.owned_upload) return null;
    if (checkingIds.has(id)) return <span className="mp-hint mp-inline">Stop checking to remove</span>;
    if (confirm === id) return <span className="mp-confirm" role="group" aria-label="Confirm removal">
      <span>Remove this video?</span>
      <button className="mp-btn danger small" disabled={busy} onClick={() => removeClips([id])}><Icon name="trash" size={18} />Yes, remove</button>
      <button className="mp-btn quiet small" onClick={() => setConfirm(null)}>Cancel</button>
    </span>;
    return <button className="mp-btn quiet small" disabled={busy} onClick={() => setConfirm(id)} aria-label={`Remove ${clipName(id)}`}><Icon name="trash" size={18} />Remove</button>;
  };
  const active = items.filter(i => ["queued", "running"].includes(i.status)).length;
  const nextReady = ready.find(r => r.item_id !== item?.item_id);
  const result = item?.result;
  const finding = describeFinding(result);
  const moments = flaggedMoments(result);
  const duration = result?.anomaly?.metadata?.duration_sec || item?.clip.metadata?.duration || 1;
  const exportQuery = `references=${includeReferences}&external=${external}`;
  const verdict = violenceVerdict(result);
  const verdictTitle = { violence: "Violence detected", non_violence: "No violence detected" }[verdict.state] ?? "No violence answer";
  const uploading = uploads.some(u => ["waiting", "uploading"].includes(u.state));
  const thumb = <span className="mp-thumb" aria-hidden="true"><Icon name="film" size={20} /></span>;
  const onDrop = e => { e.preventDefault(); setDragging(false); if (!busy) addVideos(Array.from(e.dataTransfer.files)); };
  const dropzone = <div className={`mp-drop ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={onDrop} onClick={e => { if (e.target === e.currentTarget && !busy) fileInput.current?.click(); }}>
    <span className="mp-corner tl" /><span className="mp-corner tr" /><span className="mp-corner bl" /><span className="mp-corner br" />
    <span className="mp-lens" aria-hidden="true"><Icon name="upload" size={30} /></span>
    <p className="mp-drop-title">{dragging ? "Drop to add these videos" : "Drag videos here"}</p>
    <p className="mp-drop-sub">or choose files from this computer. Checking starts as soon as they are added.</p>
    <button className="mp-btn primary" disabled={busy} onClick={() => fileInput.current?.click()}>Choose videos</button>
    <input ref={fileInput} type="file" multiple accept={videoTypes} hidden onChange={e => { addVideos(Array.from(e.target.files)); e.target.value = ""; }} />
    <ul className="mp-formats" aria-label="Supported formats">{["MP4", "MOV", "AVI", "MKV", "WEBM"].map(f => <li key={f}>{f}</li>)}</ul>
  </div>;
  const stepState = key => page === key ? "on" : (steps.findIndex(s => s[0] === key) < steps.findIndex(s => s[0] === page) ? "done" : "");

  return <div className="municipal">
    <header className="mp-band">
    <div className="mp-header">
      <button className="mp-brand" onClick={() => go("home")}><span className="mp-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="34" height="34"><rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" /><path d="M9 11V9h2M21 9h2v2M23 21v2h-2M11 23H9v-2" fill="none" stroke="var(--mp-band)" strokeWidth="2.2" strokeLinecap="round" /><circle cx="16" cy="16" r="3.4" fill="var(--mp-mark)" /></svg></span><span>Violence review<small>Footage check with human review</small></span></button>
      <div className="mp-header-tools">
        <span className="mp-pill"><Icon name="lock" size={16} />Works without internet</span>
        <div className="mp-theme" role="group" aria-label="Colour theme">
          {[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([value, label]) => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)} aria-label={`${label} theme`}><Icon name={value === "auto" ? "auto" : value === "light" ? "sun" : "moon"} size={16} /><span>{label}</span></button>)}
        </div>
      </div>
    </div>
    <nav className="mp-steps" aria-label="Steps">
      {steps.map(([key, label], n) => <button key={key} className={`mp-step ${stepState(key)}`} aria-current={page === key ? "step" : undefined} onClick={() => go(key)}>
        <b>{stepState(key) === "done" ? <Icon name="check" size={16} /> : n + 1}</b><span>{label}</span>
        {key === "checking" && active > 0 && <em>{active}</em>}{key === "review" && ready.length > 0 && <em>{ready.length}</em>}
      </button>)}
      <button className={`mp-step mp-step-finished ${page === "finished" ? "on" : ""}`} aria-current={page === "finished" ? "page" : undefined} onClick={() => go("finished")}><b><Icon name="list" size={16} /></b><span>Finished</span>{finished.length > 0 && <em>{finished.length}</em>}</button>
    </nav>
    </header>
    <div className="mp-feedback">
      {error && <div role="alert" className="mp-alert tone-bad"><Icon name="cross" size={20} />{error}</div>}
      {message && <div role="status" className="mp-alert tone-ok"><Icon name="check" size={20} />{message}</div>}
      {busy && !message && !uploading && <div role="status" className="mp-alert tone-info"><Icon name="spinner" size={20} />Please wait…</div>}
    </div>

    <main className="mp-main">
      {page === "home" && <>
        <div className="mp-hero">
          <h1>Check footage for violence</h1>
          <p className="mp-lead">Add a video. The app marks the moments where it sees violence, and you decide whether it got it right.</p>
        </div>
        <div className="mp-home">
          {dropzone}
          <aside className="mp-waiting" aria-labelledby="mp-waiting-title">
            <h2 id="mp-waiting-title">Waiting for your review</h2>
            <p className="mp-waiting-count"><strong>{ready.length}</strong><span>{ready.length === 1 ? "video is ready" : "videos are ready"}</span></p>
            {ready.length > 0 ? <ul className="mp-mini">{ready.slice(0, 3).map(r => <li key={r.item_id}><button onClick={() => openItem(r.item_id)} disabled={busy}>{thumb}<span>{clipName(r.clip_id)}</span></button></li>)}</ul>
              : <p className="mp-hint">{active ? `The app is still checking ${active === 1 ? "1 video" : `${active} videos`}. They appear here when it has finished.` : "Videos appear here once the app has checked them."}</p>}
            {ready.length > 3 && <p className="mp-hint">and {ready.length - 3} more</p>}
            <button className="mp-btn primary" disabled={!ready.length || busy} onClick={() => openItem(ready[0].item_id)}>Start reviewing</button>
            {active > 0 && ready.length > 0 && <p className="mp-checking-note"><Icon name="spinner" size={16} />Still checking {active === 1 ? "1 more video" : `${active} more videos`}</p>}
          </aside>
        </div>
        <p className="mp-note">This tool helps people review footage. It can be wrong, and it never decides who is guilty. A person always makes the final call.</p>
      </>}

      {page === "add" && <>
        <h1>Add videos</h1>
        {dropzone}
        {uploads.length > 0 && <section className="mp-group" aria-live="polite">
          <div className="mp-group-head">
            <h2>{uploading ? "Adding videos" : "Just added"}</h2>
            {!uploading && <span className="mp-row-tools"><button className="mp-btn primary small" onClick={() => go("checking")}>See checking progress</button><button className="mp-btn quiet small" onClick={() => setUploads([])}>Clear this list</button></span>}
          </div>
          <ul className="mp-list">{uploads.map(u => <li key={u.key} className={`mp-upload is-${u.state}`}>
            {thumb}
            <span className="mp-upload-body">
              <span className="mp-upload-name">{u.name}</span>
              <span className="mp-upload-meta"><span>{sizeText(u.size)}</span><span className="mp-upload-state">{u.state === "waiting" ? "Waiting" : u.state === "uploading" ? `Uploading ${Math.round(u.progress * 100)}%` : u.state === "done" ? "Added, checking has started" : u.error}</span></span>
              {["waiting", "uploading"].includes(u.state) && <span className="mp-progress" role="progressbar" aria-label={`Uploading ${u.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(u.progress * 100)}><i style={{ width: `${u.progress * 100}%` }} /></span>}
            </span>
            <span className={`mp-upload-icon tone-${u.state === "done" ? "ok" : u.state === "failed" ? "bad" : "info"}`}><Icon name={u.state === "done" ? "check" : u.state === "failed" ? "cross" : "spinner"} size={18} /></span>
          </li>)}</ul>
        </section>}
        {available.length > 0 && <section className="mp-group">
          <div className="mp-group-head">
            <h2>Your videos <span className="mp-count">{available.length}</span></h2>
            {removable.length > 1 && (confirm === "all" ? <span className="mp-confirm" role="group" aria-label="Confirm removing all videos">
              <span>Remove {removable.length} videos?</span>
              <button className="mp-btn danger small" disabled={busy} onClick={() => removeClips(removable.map(c => c.clip_id))}><Icon name="trash" size={18} />Yes, remove all</button>
              <button className="mp-btn quiet small" onClick={() => setConfirm(null)}>Cancel</button>
            </span> : <button className="mp-btn quiet small" disabled={busy} onClick={() => setConfirm("all")}><Icon name="trash" size={18} />Remove all</button>)}
          </div>
          <p className="mp-hint">Removing a video deletes the file from this app's storage. Answers you already saved stay in Finished. You can add the same video again later.</p>
          <ul className="mp-list">{available.map(c => <li key={c.clip_id} className="mp-row">{thumb}<span className="mp-row-name">{clipName(c.clip_id)}<small>{clockText(c.metadata.duration)} long</small></span><span className="mp-row-tools"><button className="mp-btn secondary small" disabled={busy || checkingIds.has(c.clip_id)} onClick={() => checkClip(c.clip_id)}>{checkingIds.has(c.clip_id) ? "Being checked" : "Check this video"}</button>{removeControl(c.clip_id)}</span></li>)}</ul>
        </section>}
      </>}

      {page === "checking" && <>
        <h1>Checking</h1>
        <p className="mp-lead">{active ? "The app checks one video at a time. You can leave this page open, or come back later." : items.length ? "All videos have been checked." : "Nothing is being checked right now."}</p>
        {!items.length ? <div className="mp-empty"><p>No videos have been added yet.</p><button className="mp-btn primary" onClick={() => go("add")}>Add videos</button></div> :
          <ul className="mp-list">{items.map(i => <li key={i.item_id} className={`mp-row ${i.status === "running" ? "is-running" : ""}`}>
            {thumb}<span className="mp-row-name">{clipName(i.clip_id)}<small>Added {new Date(i.job.created_at).toLocaleString()}</small></span>
            <span className="mp-row-tools"><Badge status={itemStatus(i.status, reviewedItems.has(i.item_id))} />
              {i.status === "completed" && <button className="mp-btn primary small" disabled={busy} onClick={() => openItem(i.item_id)}>{reviewedItems.has(i.item_id) ? "Open again" : "Watch and review"}</button>}
              {["failed", "cancelled"].includes(i.status) && <button className="mp-btn secondary small" disabled={busy} onClick={() => action(async () => { await post(`/jobs/${i.job.job_id}/retry`, { idempotency_key: uid() }); setMessage("Trying again."); })}>Try again</button>}
              {["queued", "running"].includes(i.status) && <button className="mp-btn quiet small" disabled={busy} onClick={() => action(async () => { await post(`/jobs/${i.job.job_id}/cancel`); setMessage("Stopping. The video being checked right now will finish first."); })}>Stop</button>}
              {!["queued", "running"].includes(i.status) && removeControl(i.clip_id)}
            </span></li>)}</ul>}
      </>}

      {page === "review" && (!item ? <>
        <h1>Your review</h1>
        {!ready.length ? <div className="mp-empty"><p>There are no videos waiting for your answer.</p><button className="mp-btn primary" onClick={() => go(active ? "checking" : "add")}>{active ? "See what's being checked" : "Add videos"}</button></div> :
          <ul className="mp-list">{ready.map(r => <li key={r.item_id} className="mp-row">{thumb}<span className="mp-row-name">{clipName(r.clip_id)}</span><button className="mp-btn primary small" disabled={busy} onClick={() => openItem(r.item_id)}>Watch and review</button></li>)}</ul>}
      </> : <>
        <h1>{clipName(item.clip_id)}</h1>
        <div className="mp-review">
          <section className="mp-watch">
            <div className="mp-monitor">
              <video key={item.item_id} ref={video} src={item.video_url} controls onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)} />
              <div className="mp-scrub">
                <span className="mp-time">{clockText(current)}</span>
                <div className="mp-track" aria-hidden="true">{moments.map(([a, b], n) => <span key={n} style={{ left: `${(a / duration) * 100}%`, width: `${Math.max(1, ((b - a) / duration) * 100)}%` }} />)}<i style={{ left: `${Math.min(100, (current / duration) * 100)}%` }} /></div>
                <span className="mp-time">{clockText(duration)}</span>
              </div>
            </div>
            <div className={`mp-verdict tone-${finding.tone}`}>
              <span className="mp-verdict-icon"><Icon name={verdict.state === "violence" ? "alert" : verdict.state === "non_violence" ? "shield" : "question"} size={26} /></span>
              <div className="mp-verdict-text"><h2>{verdictTitle}</h2><p>{finding.text}</p></div>
              {verdict.score !== null && <div className="mp-verdict-score"><strong>{verdict.score.toFixed(2)}</strong><span>highest score</span><span>flags at {verdict.threshold.toFixed(2)}</span></div>}
            </div>
            {moments.length > 0 && <><p className="mp-hint">The amber marks on the bar show where. Press a button to watch that part.</p>
              <div className="mp-moments">{moments.map(([a, b], n) => <button key={n} className="mp-btn secondary small" onClick={() => seek(a, true)}><Icon name="play" size={16} />Watch {clockText(a)} to {clockText(b)}</button>)}</div></>}
            <div className="mp-review-remove">{removeControl(item.clip_id)}</div>
          </section>
          <section className="mp-ask">
            {saved ? <>
              <p className="mp-question">Thank you. Your answer is saved.</p>
              <p>You said: <strong>{decisionLabel(item.reviews.at(-1)?.decision)}</strong></p>
              {nextReady ? <button className="mp-btn primary" disabled={busy} onClick={() => openItem(nextReady.item_id)}>Review the next video</button> : <button className="mp-btn primary" onClick={() => go("finished")}>See finished videos</button>}
              <button className="mp-btn quiet" onClick={() => setSaved(false)}>Change my answer</button>
            </> : <>
              <p className="mp-question" id="mp-question">Did the app get this right?</p>
              {item.reviews.length > 0 && <p className="mp-hint">You answered before: {decisionLabel(item.reviews.at(-1).decision)}. A new answer is added to the history.</p>}
              <div className="mp-answers" role="radiogroup" aria-labelledby="mp-question">{decisions.map(d => <button key={d.value} role="radio" aria-checked={decision === d.value} className={`mp-answer tone-${d.tone}`} onClick={() => setDecision(d.value)}><Icon name={d.icon} size={24} />{d.label}</button>)}</div>
              <details className="mp-more"><summary>Add more details (optional)</summary>
                <label htmlFor="mp-notes">Notes</label><textarea id="mp-notes" maxLength="5000" value={notes} onChange={e => setNotes(e.target.value)} placeholder="For example: the people were only pushing, not fighting." />
                <p className="mp-label">Where did it happen?</p>
                <p className="mp-hint">Play the video. Press the button when it starts, then again when it ends.</p>
                <button className="mp-btn secondary small" onClick={() => { if (markStart === null) setMarkStart(current); else { setMarks([...marks, [Math.min(markStart, current), Math.max(markStart, current)]]); setMarkStart(null); } }}>{markStart === null ? `Mark where it starts (${clockText(current)})` : `Mark where it ends (${clockText(current)})`}</button>
                {marks.length > 0 && <ul className="mp-marks">{marks.map(([a, b], n) => <li key={n}>{clockText(a)} to {clockText(b)}<button className="mp-link" onClick={() => setMarks(marks.filter((_, k) => k !== n))}>Remove</button></li>)}</ul>}
              </details>
              {reviewer && !editingName ? <p className="mp-hint">Answering as <strong>{reviewer}</strong> <button className="mp-link" onClick={() => setEditingName(true)}>Change</button></p> :
                <div className="mp-field"><label htmlFor="mp-reviewer">Your name</label><input id="mp-reviewer" maxLength="200" value={reviewer} onChange={e => setReviewer(e.target.value)} autoComplete="name" /></div>}
              <button className="mp-btn primary" disabled={busy} onClick={saveReview}>Save my answer</button>
            </>}
          </section>
        </div>
        <details className="mp-technical-item"><summary>Technical details for this video</summary>
          <div className="mp-technical-body">
            <section className="panel mp-section"><div className="mp-actions"><span>Mode: <strong>{result?.execution_mode || item.status}</strong></span><span>Inference: {result?.timings.total_seconds?.toFixed(2) ?? "—"}s</span><span>Answer: <strong>{verdictLabel(violenceVerdict(result).state)}</strong></span><span>Violence score: {metricText(violenceVerdict(result).score)} (flag at {metricText(violenceVerdict(result).threshold)})</span></div><p>{item.clip.spec.source}</p></section>
            <div className="mp-legacy"><Timeline result={result} current={current} onSeek={seek} /></div>
            <section className="panel mp-section"><h2>Violence score over time</h2>{!result?.indian_pilot?.windows?.length ? <p>{result?.indian_pilot ? "One score for the whole video." : "The violence model is not loaded."}</p> : <div className="mp-scroll"><table><thead><tr><th>Time</th><th>Violence score</th><th>Answer</th></tr></thead><tbody>{result.indian_pilot.windows.map((w, i) => <tr key={i}><td><button className="mp-link" onClick={() => seek(w.start_sec)}>{clockText(w.start_sec)}–{clockText(w.end_sec)}</button></td><td>{metricText(w.violence_score)}</td><td>{w.above_threshold ? "Violence" : "Non-violence"}</td></tr>)}</tbody></table></div>}<p className="muted">Scores come from the violence / non-violence model only. Scores are uncalibrated.</p><details><summary>Frozen hashes, timings and raw model evidence</summary><pre>{pretty({ ...result, behavior: undefined, final_alert: undefined })}</pre></details></section>
            <section className="panel mp-section"><h2>Verified reference and history</h2><p>The verified reference can be revealed only after a review is saved. Reviews are operator feedback and do not become ground truth.</p><div className="mp-actions"><button disabled={busy || !item.reviews.length} onClick={() => action(async () => setReference(await request(`/items/${item.item_id}/reference`)))}>Reveal verified reference after review</button><a href={`${base}/export?item_id=${item.item_id}&format=json&${exportQuery}`} download>Export this clip result</a></div>{reference !== undefined && <pre>{reference ? pretty(reference) : "No verified reference supplied."}</pre>}<details><summary>Review history ({item.reviews.length})</summary><pre>{pretty(item.reviews)}</pre></details></section>
          </div>
        </details>
      </>)}

      {page === "finished" && <>
        <h1>Finished videos</h1>
        {!finished.length ? <div className="mp-empty"><p>No answers saved yet. Videos you review will be listed here.</p></div> : <>
          <div className="mp-toolbar no-print"><a className="mp-btn secondary small" href={`${base}/export?format=csv&${exportQuery}`} download>Save as spreadsheet</a><button className="mp-btn quiet small" onClick={() => window.print()}>Print this list</button></div>
          <ul className="mp-list">{finished.map(r => { const answer = decisions.find(d => d.value === r.review_decision); return <li key={r.item_id} className="mp-row">
            {thumb}<span className="mp-row-name">{clipName(r.clip_id)}<small>{r.reviews.at(-1)?.reviewer ? `Answered by ${r.reviews.at(-1).reviewer}` : "Answered"}</small></span>
            <span className="mp-row-tools"><span className={`mp-badge tone-${answer?.tone || "muted"}`}><Icon name={answer?.icon || "check"} size={16} />{decisionLabel(r.review_decision)}</span>{removed.has(r.clip_id) ? <span className="mp-hint mp-inline">Video removed</span> : <button className="mp-btn quiet small no-print" disabled={busy} onClick={() => openItem(r.item_id)}>Open</button>}</span>
          </li>; })}</ul>
        </>}
      </>}

      {page === "technical" && <>
        <h1>Technical details</h1>
        <p className="mp-lead">For project staff. Everything here works the same as before.</p>
        <div className="mp-warning">Human-review research prototype. UCF ROC-AUC 0.7441 · DCSASS macro F1 0.2140 · cascade alert F1 0.4733. Scores are uncalibrated. Outputs do not establish guilt or intent.</div>
        <nav className="mp-nav" aria-label="Technical pages">{technicalPages.map(p => <button key={p} aria-current={technical === p ? "page" : undefined} onClick={() => setTechnical(p)}>{p}</button>)}</nav>
        {technical === "Professor console" && <div className="mp-legacy"><Legacy /></div>}
        {technical === "Accuracy" && <><div className="mp-metrics panel"><div><strong>{dashboard?.library_count ?? "—"}</strong><span>Catalog clips</span></div><div><strong>{dashboard?.reviews_pending ?? "—"}</strong><span>Reviews pending</span></div>{["queued", "running", "completed", "failed", "cancelled"].map(s => <div key={s}><strong>{dashboard?.jobs[s] || 0}</strong><span>{s} batches</span></div>)}</div><Evaluation report={dashboard?.evaluation} /></>}
        {technical === "Video library" && <section className="panel mp-section"><h2>Video library</h2><p>Unlabeled footage remains unlabeled. Import files must already be inside the configured local import directory.</p>
          <div className="mp-actions"><label>Search<input value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} placeholder="Clip, source or notes" /></label><label>Population<select value={population} onChange={e => { setPopulation(e.target.value); setOffset(0); }}><option value="">All populations</option>{["evaluation", "curated_demo", "upload", "synthetic"].map(v => <option key={v}>{v}</option>)}</select></label><label>Assignment<select value={assignment} onChange={e => { setAssignment(e.target.value); setOffset(0); }}><option value="">All assignments</option>{["train", "validation", "test", "demo", "unassigned"].map(v => <option key={v}>{v}</option>)}</select></label></div>
          <div className="mp-actions"><label className="mp-file">Read manifest JSON<input type="file" accept=".json" disabled={busy} onChange={e => { const file = e.target.files[0]; if (file) { setManifest(null); setPreview(null); action(async () => { const payload = JSON.parse(await file.text()); setManifest(payload); setPreview(await post("/import?dry_run=true", payload)); }); } e.target.value = ""; }} /></label><button disabled={busy || !manifest || !preview} onClick={() => action(async () => { const r = await post("/import?dry_run=false", manifest); setMessage(`${r.imported.length} imported, ${r.duplicates.length} duplicates.`); setManifest(null); setPreview(null); })}>Commit inspected manifest</button><button disabled={busy || !selected.length} onClick={submit}>Batch submit ({selected.length})</button><button onClick={() => action(async () => { const r = await fetch(base + "/backup", { method: "POST" }); if (!r.ok) throw new Error("Backup unavailable"); const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = "municipal-backup.sqlite3"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>Download SQLite backup</button></div>
          {preview && <pre>Dry run only: {pretty(preview)}</pre>}
          <div className="mp-scroll"><table><thead><tr><th><input type="checkbox" aria-label="Select visible clips" checked={clips.length > 0 && clips.every(c => selected.includes(c.clip_id))} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...clips.filter(c => c.status === "available").map(c => c.clip_id)])] : selected.filter(id => !clips.some(c => c.clip_id === id)))} /></th><th>Clip / source</th><th>Media</th><th>Population</th><th>Provenance & rights</th><th>Status</th></tr></thead><tbody>{clips.map(c => <tr key={c.clip_id}><td><input type="checkbox" aria-label={`Select ${c.clip_id}`} disabled={c.status !== "available"} checked={selected.includes(c.clip_id)} onChange={() => setSelected(toggleSelection(selected, c.clip_id))} /></td><td><strong>{c.clip_id}</strong><p>{c.source_video_id}</p><details><summary>Source details</summary><p>{c.spec.source}</p><p>Selection: {c.spec.selection_method}</p><p>Annotation: {c.spec.annotation_status}</p><p>{c.spec.notes}</p><code>{c.sha256}</code></details></td><td>{c.metadata.duration.toFixed(2)}s · {c.metadata.fps.toFixed(1)} fps<p>{c.metadata.resolution.join(" × ")}</p><a href={c.video_url} target="_blank" rel="noreferrer">Play original</a></td><td>{c.population}<p>{c.assignment}</p></td><td>{c.spec.license}<p>External handover: {c.spec.municipal_redistribution_permission ? "permitted" : "not permitted / unknown"}</p><p>Geography: {c.spec.location || "Unknown"} · {c.spec.location_confidence}</p></td><td>{c.status}{c.owned_upload === 1 && c.status !== "deleted" && <button disabled={busy} onClick={() => action(async () => { await request(`/clips/${c.clip_id}/upload`, { method: "DELETE" }); setMessage("Managed upload deleted; audit and results retained."); })}>Delete managed upload</button>}</td></tr>)}</tbody></table></div>
          {!clips.length && <p className="mp-empty">No matching clips. Import a manifest or add authorized local uploads.</p>}
          <div className="mp-actions"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button><span>{offset + 1}–{Math.min(total, offset + 100)} of {total}</span><button disabled={offset + 100 >= total} onClick={() => setOffset(offset + 100)}>Next</button></div>
        </section>}
        {technical === "Processing queue" && <section className="panel mp-section"><h2>Processing queue</h2><p>One GPU inference at a time. Cancellation finishes the active clip and stops the remaining clips. Interrupted work resumes within its retry budget.</p>{!jobs.length && <p className="mp-empty">No batches submitted yet.</p>}{jobs.map(j => <article className="mp-job" key={j.job_id}><div className="mp-actions"><strong>{j.status}</strong><code>{j.job_id}</code><span>{j.created_at}</span><button disabled={busy || !["queued", "running"].includes(j.status)} onClick={() => action(() => post(`/jobs/${j.job_id}/cancel`))}>Cancel pending clips</button><button disabled={busy || !j.items.some(i => ["failed", "cancelled"].includes(i.status))} onClick={() => action(() => post(`/jobs/${j.job_id}/retry`, { idempotency_key: uid() }))}>Retry failed / cancelled</button></div><progress value={j.progress} max="1" aria-label="Completed clips" /><p>{j.items.filter(i => ["completed", "failed", "cancelled"].includes(i.status)).length} / {j.items.length} clips finished</p><div className="mp-scroll"><table><thead><tr><th>Clip</th><th>Status</th><th>Attempts</th><th>Evidence / error</th></tr></thead><tbody>{j.items.map(i => <tr key={i.item_id}><td>{i.clip_id}</td><td>{i.status}</td><td>{i.attempts}</td><td>{i.status === "completed" ? <button onClick={() => openItem(i.item_id)}>Analyze & review</button> : i.error || "Awaiting execution"}</td></tr>)}</tbody></table></div></article>)}</section>}
        {technical === "Results & exports" && <section className="panel mp-section"><h2>Results and operator feedback</h2><p>Exports omit raw videos and actor imagery. External handover excludes records without explicit redistribution permission. Reference labels are opt-in.</p><div className="mp-actions no-print"><label><input type="checkbox" checked={includeReferences} onChange={e => setIncludeReferences(e.target.checked)} /> Include legitimate verified references</label><label><input type="checkbox" checked={external} onChange={e => setExternal(e.target.checked)} /> External handover rights filter</label><a href={`${base}/export?format=json&${exportQuery}`} download>Download JSON</a><a href={`${base}/export?format=csv&${exportQuery}`} download>Download CSV</a><button onClick={() => window.print()}>Print report / save PDF</button></div><div className="mp-scroll"><table><thead><tr><th>Clip / population</th><th>Status / execution</th><th>Prediction</th><th>Feedback / error examples</th><th>Evidence</th></tr></thead><tbody>{results.map(r => <tr key={r.item_id}><td>{r.clip_id}<p>{r.population} · {r.source}</p></td><td>{r.status}<p>{r.execution_mode || "No inference result"}</p></td><td>{r.violence_answer ? verdictLabel(r.violence_answer) : "No violence score"}</td><td>{r.review_decision || "Unreviewed"}<p>{r.reviewer_notes || r.failure_reason || r.abstention_reason}</p></td><td><button onClick={() => openItem(r.item_id)}>Open</button></td></tr>)}</tbody></table></div></section>}
      </>}
    </main>
    <footer className="mp-footer no-print"><button className="mp-link" onClick={() => go(page === "technical" ? "home" : "technical")}>{page === "technical" ? "Back to the main screens" : "Technical details"}</button><span>Research prototype for human review. Runs on this computer only.</span></footer>
  </div>;
}
