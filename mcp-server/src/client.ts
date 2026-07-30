// Typed HTTP client for the cohort-lens BFF. Reads its config from env; every
// request forwards a static user JWT + X-Org-Id. Non-2xx responses that carry
// the BFF's typed error envelope are re-thrown as `BffError` with the code
// preserved, so the MCP layer can surface it verbatim to the caller.

export class BffError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "BffError";
  }
}

type Env = {
  url: string;
  jwt: string;
  orgId: string;
};

function readEnv(): Env {
  const url = process.env.COHORT_LENS_URL;
  const jwt = process.env.COHORT_LENS_JWT;
  const orgId = process.env.COHORT_LENS_ORG_ID;
  const missing = [
    !url && "COHORT_LENS_URL",
    !jwt && "COHORT_LENS_JWT",
    !orgId && "COHORT_LENS_ORG_ID",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`missing env: ${missing.join(", ")}`);
  }
  return { url: url!, jwt: jwt!, orgId: orgId! };
}

export class BffClient {
  constructor(private readonly env: Env = readEnv()) {}

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.env.url}/${path}`, {
      method: "POST",
      headers: this.headers({ contentType: true }),
      body: JSON.stringify(body),
    });
    return this.handle<T>(res);
  }

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${this.env.url}/${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const res = await fetch(url, { method: "GET", headers: this.headers() });
    return this.handle<T>(res);
  }

  private headers(opts: { contentType?: boolean } = {}): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.env.jwt}`,
      "X-Org-Id": this.env.orgId,
    };
    if (opts.contentType) h["Content-Type"] = "application/json";
    return h;
  }

  private async handle<T>(res: Response): Promise<T> {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text.length > 0 ? JSON.parse(text) : null; } catch { /* text kept */ }
    if (!res.ok) {
      const env = parsed as { error?: { code?: string; message?: string; details?: unknown } } | null;
      const code = env?.error?.code ?? `http_${res.status}`;
      const msg = env?.error?.message ?? `BFF returned ${res.status}`;
      throw new BffError(code, msg, res.status, env?.error?.details);
    }
    return parsed as T;
  }
}
