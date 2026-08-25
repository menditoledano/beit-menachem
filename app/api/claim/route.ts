import { gasPost, UpstreamError } from "@/lib/gas";
import { allow, checkOrigin, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!checkOrigin(req)) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  const ip = clientIp(req);
  // Generous for humans, hostile to scripts: 10 claim attempts per minute per IP.
  if (!allow(`claim:${ip}`, 10, 60_000)) {
    return Response.json({ ok: false, code: "TOO_FAST", retryAfterMs: 30_000 }, { status: 429 });
  }

  try {
    const body = await req.json();
    const reg = body.registration;
    const result = await gasPost("claim", {
      requestId: String(body.requestId ?? ""),
      seatNos: Array.isArray(body.seatNos) ? body.seatNos.slice(0, 3) : [],
      name: String(body.name ?? ""),
      phone: String(body.phone ?? ""),
      email: String(body.email ?? ""),
      // Wizard answers (aliyot, takanon, dues declaration) — re-whitelisted
      // field by field so the proxy stays an explicit contract.
      registration: reg
        ? {
            aliyah1: String(reg.aliyah1 ?? ""),
            aliyah2: String(reg.aliyah2 ?? ""),
            takanonApproved: reg.takanonApproved === true,
            duesDeclared: reg.duesDeclared === true,
            notes: String(reg.notes ?? ""),
          }
        : undefined,
      // Apps Script cannot see headers; the IP rides in the body for the audit log.
      ip,
    });
    return Response.json(result);
  } catch (err) {
    const code = err instanceof UpstreamError ? err.code : "UPSTREAM";
    return Response.json({ ok: false, code }, { status: 502 });
  }
}
