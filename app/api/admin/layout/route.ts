import { gasPost, requireAdmin, UpstreamError } from "@/lib/gas";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Load the saved (raw, editable) layout. */
export async function GET(req: Request) {
  if (!requireAdmin(req)) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  try {
    return Response.json(await gasPost("loadLayout"));
  } catch (err) {
    const code = err instanceof UpstreamError ? err.code : "UPSTREAM";
    return Response.json({ ok: false, code }, { status: 502 });
  }
}

/** Save a draft, or publish when body.publish is set. */
export async function POST(req: Request) {
  if (!requireAdmin(req)) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const action = body.publish ? "publishLayout" : "saveLayout";
    return Response.json(await gasPost(action, body));
  } catch (err) {
    const code = err instanceof UpstreamError ? err.code : "UPSTREAM";
    return Response.json(
      { ok: false, code, message: err instanceof Error ? err.message : "" },
      { status: 502 },
    );
  }
}
