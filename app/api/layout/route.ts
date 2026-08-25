import { gasPost, UpstreamError } from "@/lib/gas";
import type { CompiledLayout } from "@/lib/domain";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Geometry only. Static for the whole sale, so cached hard — the client keeps
 * it keyed by version and refetches only when the seatmap reports a new one.
 */
let cached: CompiledLayout | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

export async function GET() {
  try {
    if (!cached || Date.now() - cachedAt > TTL_MS) {
      const res = await gasPost<{ ok: boolean; compiled: CompiledLayout | null }>("getLayout");
      if (!res.ok || !res.compiled) throw new UpstreamError("UPSTREAM", "no layout");
      cached = res.compiled;
      cachedAt = Date.now();
    }
    return Response.json(cached, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch {
    if (cached) return Response.json(cached);
    return Response.json({ ok: false, code: "NO_LAYOUT" }, { status: 503 });
  }
}
