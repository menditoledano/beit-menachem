import { gasPost, UpstreamError } from "@/lib/gas";
import { allow, checkOrigin, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Swap one of the caller's own seats for a free one in the same section.
 * Same shape as /api/claim: whitelisted fields, IP in the body for the audit
 * log, and the same per-IP throttle — a move is as expensive as a claim.
 */
export async function POST(req: Request) {
  if (!checkOrigin(req)) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  const ip = clientIp(req);
  if (!allow(`claim:${ip}`, 10, 60_000)) {
    return Response.json({ ok: false, code: "TOO_FAST", retryAfterMs: 30_000 }, { status: 429 });
  }

  try {
    const body = await req.json();
    const result = await gasPost("move", {
      requestId: String(body.requestId ?? ""),
      phone: String(body.phone ?? ""),
      fromSeatNo: Number(body.fromSeatNo),
      toSeatNo: Number(body.toSeatNo),
      ip,
    });
    return Response.json(result);
  } catch (err) {
    const code = err instanceof UpstreamError ? err.code : "UPSTREAM";
    return Response.json({ ok: false, code }, { status: 502 });
  }
}
