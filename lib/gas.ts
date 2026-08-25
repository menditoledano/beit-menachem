/**
 * Server-side bridge to the Apps Script web app.
 *
 * Everything here runs in Next.js API routes only. The /exec URL and the shared
 * secret must never reach a browser bundle — the URL is the entire security
 * boundary of the backend.
 */

const GAS_TIMEOUT_MS = 25_000; // Apps Script cold start is 3-6s; leave headroom.

export class UpstreamError extends Error {
  constructor(
    public code: "UPSTREAM" | "TIMEOUT",
    message: string,
  ) {
    super(message);
  }
}

function gasUrl(): string {
  const url = process.env.GAS_URL;
  if (!url) throw new Error("GAS_URL is not configured");
  return url;
}

/**
 * POST to Apps Script. The Content-Type is text/plain by design: Apps Script
 * has no doOptions entry point, so any request that triggers a CORS preflight
 * dies before our code runs. Server-to-server has no CORS, but keeping the
 * simple-request shape means the same endpoint also works if ever called
 * directly during debugging.
 *
 * The secret rides in the body — Apps Script cannot read headers, and query
 * strings land in Google's execution logs.
 */
export async function gasPost<T>(action: string, payload: object = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);
  try {
    const res = await fetch(gasUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        ...payload,
        action,
        secret: process.env.GAS_SECRET,
      }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    // A non-JSON body is a Google interstitial: login page, quota error, 405.
    // Surface it as a clean upstream failure instead of a JSON parse crash.
    if (!text.trim().startsWith("{")) {
      console.error("GAS non-JSON response", res.status, text.slice(0, 300));
      throw new UpstreamError("UPSTREAM", `non-JSON upstream (${res.status})`);
    }
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (controller.signal.aborted) throw new UpstreamError("TIMEOUT", "GAS timeout");
    throw new UpstreamError("UPSTREAM", String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Admin auth with brute-force lockout. The token is short enough to memorise,
 * so the lockout carries the security weight: five wrong attempts from one IP
 * lock that IP out for fifteen minutes, which caps guessing at a rate that
 * makes a six-digit space unsearchable in practice.
 */
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function requireAdmin(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const rec = failedAttempts.get(ip);
  const now = Date.now();
  if (rec && rec.lockedUntil > now) return false;

  const token = req.headers.get("x-admin-token");
  if (token === expected) {
    failedAttempts.delete(ip);
    return true;
  }
  // Only attempts that actually presented a token count toward lockout —
  // a missing header is a UI state, not a guess.
  if (token) {
    const count = (rec?.count ?? 0) + 1;
    failedAttempts.set(ip, {
      count,
      lockedUntil: count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : 0,
    });
  }
  return false;
}
