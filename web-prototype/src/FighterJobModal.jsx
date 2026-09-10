import { useEffect, useRef, useState } from "react";
import { availableFighterTargets, CHARACTER_MESHES } from "../shared/fighter-targets.js";
import ModalPage from "./ModalPage.jsx";
import { formatFighterJobError } from "../shared/fighter-job-ui.js";

const ACTIVE = new Set(["queued", "running", "retrying"]);

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function statusHeadline(job) {
  switch (job?.status) {
    case "queued":
      return "Waiting for a generation worker";
    case "running":
      return "Generating";
    case "retrying":
      return "Retrying";
    case "failed":
      return "Generation failed";
    case "cancelled":
      return "Cancelled";
    case "complete":
      return "Ready to fight";
    default:
      return "";
  }
}

// Generation details for one fighter job: the live stage, how long it has
// been running, the pipeline's last log lines, and retry when it failed.
// Opened by tapping a generating or failed grid tile and automatically when a
// job that was visible while it ran fails.
export default function FighterJobModal({ job, onClose, onDelete, onRetry, onSaveSettings, open }) {
  const closeRef = useRef(null);
  const [now, setNow] = useState(() => Date.now());
  const [logOpen, setLogOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [retarget, setRetarget] = useState("mario");
  const [saving, setSaving] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [meleeUrl,setMeleeUrl]=useState("");
  const [exportingSource,setExportingSource]=useState(false);
  const [downloadFormat, setDownloadFormat] = useState(null);
  const [downloadError, setDownloadError] = useState("");
  const downloadRef = useRef(null);
  useEffect(() => {
    setRetarget(job?.character?.base || "mario");
    setCopyMessage("");
    setMeleeUrl("");
    setDownloadError("");
    setDownloadFormat(null);
    return () => downloadRef.current?.abort();
  }, [open, job?.id]);

  const active = ACTIVE.has(job?.status);
  useEffect(() => {
    if (!open || !active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    setLogOpen(job?.status === "failed");
    setRetryError("");
    setConfirmDelete(false);
    setDeleting(false);
  }, [open, job?.id, job?.status]);

  if (!job) return <ModalPage className="fighter-job-overlay" open={false} />;

  const downloadUrl = job.character?.bundleUrl
    ? new URL(job.character.bundleUrl, window.location.origin).href
    : "";
  const failed = job.status === "failed";
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  const startedAt = Date.parse(job.startedAt || job.createdAt || "");
  const endedAt = Date.parse(job.completedAt || (active ? "" : job.updatedAt) || "");
  const elapsed = formatElapsed((Number.isFinite(endedAt) ? endedAt : now) - startedAt);
  const retryLabel = job.retry?.label || "Retry generation";
  const logTail = Array.isArray(job.logTail) ? job.logTail : [];

  async function download(format) {
    if (downloadRef.current && !downloadRef.current.signal.aborted) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    setDownloadFormat(format); setDownloadError("");
    try {
      const { characterDownload, saveDownload } = await import("./character-download.js");
      const file = await characterDownload(downloadUrl, format, {
        name: job.slug || job.character?.name || job.name,
        fkind: CHARACTER_MESHES.find(target => target.value === retarget)?.fkind,
      }, controller.signal);
      if (!controller.signal.aborted) saveDownload(file);
    } catch (error) {
      if (!controller.signal.aborted) setDownloadError(error.message || "Could not prepare this download. Please try again.");
    } finally {
      if (downloadRef.current === controller) {
        downloadRef.current = null;
        if (!controller.signal.aborted) setDownloadFormat(null);
      }
    }
  }

  async function retry(close) {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryError("");
    try {
      await onRetry(job);
      close();
    } catch (error) {
      setRetryError(error.message || "Could not retry this fighter.");
    } finally {
      setRetrying(false);
    }
  }

  async function remove(close) {
    if (!onDelete || deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setRetryError("");
    try {
      await onDelete(job);
      close();
    } catch (error) {
      setRetryError(error.message || "Could not delete this fighter.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <ModalPage
      id="fighter-job-overlay"
      className="fighter-job-overlay"
      bodyClass="is-fighter-job-open"
      dismissOnBackdrop
      initialFocusRef={closeRef}
      onRequestClose={onClose}
      open={open}
      role="presentation"
    >
      {(close) => (
        <section
          className={`modal-page-surface fighter-job-screen ${failed ? "is-failed" : ""}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="fighter-job-title"
          aria-describedby={job.status === "complete" ? "fighter-retarget-help" : "fighter-job-copy"}
        >
          <div className="fighter-job-content">
            <h2 id="fighter-job-title" className="launch-flow-title fighter-job-title">
              {job.character?.name || job.name}
            </h2>
            <p className="fighter-job-headline" role="status" aria-live="polite">
              {statusHeadline(job)}
              {active && <span className="fighter-job-headline-dot" aria-hidden="true" />}
            </p>

            {job.status === "complete" && onSaveSettings && (
              <section className="fighter-settings">
                <h3>Character settings</h3>
                <p id="fighter-retarget-help">Choose the fighter whose moves and animations your character uses.</p>
                <select id="fighter-retarget" aria-label="Target fighter" value={retarget} disabled={saving || deleting || !!downloadFormat}
                  aria-describedby="fighter-retarget-help"
                  onChange={async (event) => {
                    const nextTarget = event.target.value;
                    const previousTarget = job.character?.base || "mario";
                    if (saving || nextTarget === previousTarget) return;
                    setRetarget(nextTarget);
                    setSaving(true);
                    setRetryError("");
                    try {
                      await onSaveSettings(job, nextTarget);
                    } catch (error) {
                      setRetarget(previousTarget);
                      setRetryError(error.message || "Could not save fighter settings.");
                    } finally {
                      setSaving(false);
                    }
                  }}>
                  {availableFighterTargets(job.artifacts).map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </section>
            )}

            {job.status === "complete" && downloadUrl && (
              <section className="fighter-settings fighter-download" aria-labelledby="fighter-download-label">
                <label id="fighter-download-label" htmlFor="fighter-download-url">Play locally or download</label>
                <p id="fighter-download-help">Play on your computer by following the <a href="https://github.com/turtlesoupy/opensmash/blob/main/BUILDING.md" target="_blank" rel="noopener noreferrer">local-build instructions on GitHub</a> and providing this character URL.</p>
                <input id="fighter-download-url" type="url" readOnly value={downloadUrl}
                  aria-describedby="fighter-download-help" onFocus={(event) => event.target.select()} />
                <div className="fighter-download-actions">
                  <button className="launch-flow-action" type="button" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(downloadUrl);
                      setCopyMessage("Download URL copied.");
                    } catch {
                      setCopyMessage("Select the URL above to copy it manually.");
                    }
                  }}>Copy URL</button>
                  <button className="launch-flow-action" type="button" disabled={exportingSource} onClick={async()=>{
                    setExportingSource(true);setDownloadError("");
                    try {
                      const response=await fetch(`/api/fighters/${job.id}/export-source`,{method:'POST'});
                      const result=await response.json();if(!response.ok)throw Error(result.error||'Could not export character.');
                      const url=new URL(result.url,window.location.origin).href;setMeleeUrl(url);
                      try {await navigator.clipboard.writeText(url);setCopyMessage('Melee import URL copied.');}
                      catch {setCopyMessage('Select the Melee URL below to copy it.');}
                    }catch(error){setDownloadError(error.message);}
                    finally{setExportingSource(false);}
                  }}>{exportingSource?'Preparing Melee link…':'Copy Melee import URL'}</button>
                  <button className="launch-flow-action" type="button" disabled={!!downloadFormat || saving}
                    onClick={() => download("osb6")}>{downloadFormat === "osb6" ? "Downloading OSB6…" : "Download OSB6"}</button>
                  <button className="launch-flow-action" type="button" disabled={!!downloadFormat || saving}
                    onClick={() => download("obj")}>{downloadFormat === "obj" ? "Preparing OBJ…" : "Download OBJ"}</button>
                </div>
                <p>Copy a Melee import URL to reuse your character in Melee. Anyone with that link can download its generated mesh and game art.</p>
                {meleeUrl && <input aria-label="Melee import URL" type="url" readOnly value={meleeUrl} onFocus={event=>event.target.select()}/>}
                {downloadFormat && <p role="status">{downloadFormat === "obj" ? "Converting your character to OBJ…" : "Downloading your character…"}</p>}
                {downloadError && <p role="alert">{downloadError}</p>}
                {copyMessage && <p role="status">{copyMessage}</p>}
              </section>
            )}

            {job.status !== "complete" && <>
            <dl className="fighter-job-facts">
              <div>
                <dt>Stage</dt>
                <dd>{job.stageLabel || job.stage || job.status}</dd>
              </div>
              <div>
                <dt>Progress</dt>
                <dd>{progress}%</dd>
              </div>
              {elapsed && (
                <div>
                  <dt>{active ? "Elapsed" : "Ran for"}</dt>
                  <dd>{elapsed}</dd>
                </div>
              )}
              {job.attempt > 1 && (
                <div>
                  <dt>Attempt</dt>
                  <dd>{job.attempt}</dd>
                </div>
              )}
              {job.retry?.nextAttemptAt && (
                <div>
                  <dt>Next try</dt>
                  <dd>{formatElapsed(Date.parse(job.retry.nextAttemptAt) - now) || "now"}</dd>
                </div>
              )}
            </dl>

            <div className="fighter-job-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
              <i style={{ width: `${progress}%` }} />
            </div>

            <div id="fighter-job-copy" className="fighter-job-copy">
              {failed && <p className="launch-flow-copy">{formatFighterJobError(job)}</p>}
              {failed && job.error && (
                <p className="fighter-job-raw-error">
                  <span>Error</span> {job.error}
                </p>
              )}
              {!failed && active && (
                <p className="launch-flow-copy">
                  A fighter usually takes a few minutes. You can close this and keep playing; the tile
                  updates on its own.
                </p>
              )}
            </div>

            {logTail.length > 0 && (
              <div className="fighter-job-log">
                <button
                  className="fighter-job-log-toggle"
                  type="button"
                  aria-expanded={logOpen}
                  aria-controls="fighter-job-log-lines"
                  onClick={() => setLogOpen((value) => !value)}
                >
                  {logOpen ? "Hide pipeline log" : `Show pipeline log (${logTail.length} ${logTail.length === 1 ? "line" : "lines"})`}
                </button>
                <pre id="fighter-job-log-lines" hidden={!logOpen}>{logTail.join("\n")}</pre>
              </div>
            )}

            </>}

            {retryError && <p className="fighter-job-retry-error" role="alert">{retryError}</p>}

            <div className="fighter-job-actions">
              {failed && onRetry && (
                <button
                  className="launch-flow-action fighter-job-retry"
                  type="button"
                  disabled={retrying}
                  onClick={() => retry(close)}
                >
                  {retrying ? "Retrying…" : retryLabel}
                </button>
              )}
              {!active && onDelete && (
                <button
                  className={`launch-flow-action fighter-job-delete ${confirmDelete ? "is-confirming" : ""}`.trim()}
                  type="button"
                  disabled={deleting || saving}
                  onClick={() => remove(close)}
                >
                  {deleting ? "Deleting…" : confirmDelete ? "Really delete? Tap again" : "Delete fighter"}
                </button>
              )}
              <button
                ref={closeRef}
                className="launch-flow-action launch-flow-cancel fighter-job-cancel"
                type="button"
                onClick={() => close()}
              >
                Close
              </button>
            </div>
          </div>
        </section>
      )}
    </ModalPage>
  );
}
