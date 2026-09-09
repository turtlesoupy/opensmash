class LocalDispatcher {
  constructor() {
    this.driver = "local";
  }

  async init() {}

  async dispatch() {
    return { executionName: null };
  }
}

class CloudRunDispatcher {
  constructor({ projectId, location, jobName }) {
    if (!projectId || !location || !jobName) {
      throw new Error(
        "GOOGLE_CLOUD_PROJECT, CLOUD_RUN_REGION, and CLOUD_RUN_WORKER_JOB are required for cloud-run execution",
      );
    }
    this.driver = "cloud-run";
    this.projectId = projectId;
    this.location = location;
    this.jobName = jobName;
    this.client = null;
  }

  async init() {
    const { v2 } = await import("@google-cloud/run");
    this.client = new v2.JobsClient();
  }

  async dispatch(job) {
    const name = this.client.jobPath(this.projectId, this.location, this.jobName);
    const [operation] = await this.client.runJob({
      name,
      overrides: {
        containerOverrides: [{
          env: [
            { name: "JOB_ID", value: job.id },
            { name: "JOB_REVISION", value: String(job.revision || 0) },
            { name: "JOB_KIND", value: job.jobKind || "fighter" },
          ],
        }],
      },
    });
    return { executionName: operation.name || null };
  }
}

// Cloud Run mints identity tokens for the service account through the
// metadata server; the audience is the worker service URL.
async function metadataIdToken(audience, fetchImpl = fetch) {
  const url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity" +
    `?audience=${encodeURIComponent(audience)}`;
  const response = await fetchImpl(url, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Identity token request failed: HTTP ${response.status}`);
  return (await response.text()).trim();
}

// Hands a job to the long-lived worker service (server/worker-service.js).
// Resolves once the worker has claimed the job and written its first
// ndjson line; the rest of the response is drained in the background so the
// worker's request stays in flight for the whole run (Cloud Run's autoscaler
// and CPU allocation follow in-flight requests).
export class CloudRunServiceDispatcher {
  constructor({ url, fetchImpl = fetch, idToken = null, acceptTimeoutMs = 120_000 }) {
    if (!/^https?:\/\//.test(url || "")) {
      throw new Error("FIGHTER_WORKER_URL is required for cloud-run-service execution");
    }
    this.driver = "cloud-run-service";
    this.url = url.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.idToken = idToken;
    this.acceptTimeoutMs = acceptTimeoutMs;
  }

  async init() {}

  async dispatch(job) {
    const headers = { "Content-Type": "application/json" };
    if (this.idToken) headers.Authorization = `Bearer ${await this.idToken(this.url)}`;
    const controller = new AbortController();
    // Only the wait for acceptance is bounded (it includes Cloud Run scaling
    // out a new instance); once accepted the stream lives as long as the run.
    const acceptTimer = setTimeout(() => controller.abort(), this.acceptTimeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.url}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId: job.id, revision: job.revision || 0, ...(job.jobKind ? {jobKind:job.jobKind} : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Worker refused the job: HTTP ${response.status} ${text.slice(0, 200)}`.trim());
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!buffer.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("Worker closed the stream before accepting the job");
        buffer += decoder.decode(value, { stream: true });
      }
      const first = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
      if (!first.accepted || !first.executionId) {
        throw new Error(first.error || "Worker did not accept the job");
      }
      clearTimeout(acceptTimer);
      void (async () => {
        try {
          while (!(await reader.read()).done) { /* keep the run's request in flight */ }
        } catch {
          // The run continues on the worker; the job lease is the source of truth.
        }
      })();
      return { executionName: first.executionId };
    } catch (error) {
      clearTimeout(acceptTimer);
      if (error.name === "AbortError") throw new Error("Worker did not accept the job in time");
      throw error;
    }
  }
}

export function createJobDispatcher() {
  const driver = process.env.FIGHTER_EXECUTION_MODE || "local";
  if (driver === "cloud-run-service") {
    return new CloudRunServiceDispatcher({
      url: process.env.FIGHTER_WORKER_URL,
      // FIGHTER_WORKER_AUTH=none for a worker on localhost.
      idToken: process.env.FIGHTER_WORKER_AUTH === "none" ? null : metadataIdToken,
    });
  }
  if (driver === "cloud-run") {
    return new CloudRunDispatcher({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
      location: process.env.CLOUD_RUN_REGION,
      jobName: process.env.CLOUD_RUN_WORKER_JOB,
    });
  }
  if (driver !== "local") throw new Error(`Unsupported FIGHTER_EXECUTION_MODE '${driver}'`);
  return new LocalDispatcher();
}
