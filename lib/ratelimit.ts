/**
 * In-memory sliding-window rate limiter for the API routes.
 *
 * Per-instance state is acceptable here: Vercel keeps warm instances for the
 * traffic levels of a 200-seat sale, and the goal is abuse damping, not exact
 * accounting. The durable limits (seat cap per phone) live in Apps Script,
 * recounted from the sheet inside the lock.
 */

const windows = new Map<string, number[]>();

export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);
  // Opportunistic cleanup so the map cannot grow unbounded across a long sale.
  if (windows.size > 5_000) {
    for (const [k, v] of windows) {
      if (v.every((t) => now - t > windowMs)) windows.delete(k);
    }
  }
  return true;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

export function checkOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // server-side calls and older same-origin posts
  try {
    const originHost = new URL(origin).host;
    // Self-origin is always fine — this keeps the check working on any
    // deployment URL (preview, temporary, custom domain) without config.
    if (originHost === req.headers.get("host")) return true;
    const allowed = (process.env.ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    return allowed.includes(originHost);
  } catch {
    return false;
  }
}
