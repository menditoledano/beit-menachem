"use client";

/**
 * The gabbai console. Lives in the web app rather than a Sheets custom menu
 * because Apps Script menus do not run in the Sheets mobile app — and a rush
 * is exactly when the gabbai is standing in the hall with a phone.
 *
 * Interaction model: tap seats on the map to build a selection, then apply
 * one operation to it. No typed seat numbers anywhere. Destructive actions
 * ask once, inline — never a browser confirm().
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompiledLayout, SeatMapPayload } from "@/lib/domain";
import { SeatMap } from "@/components/SeatMap";

interface SeatDetail {
  seatNo: number;
  status: string;
  holderName: string;
  holderPhone: string;
  holderEmail: string;
  paid: boolean;
  chazakaName: string;
  chazakaPhone: string;
  note: string;
}

interface LogRow {
  time: string;
  action: string;
  seats: string;
  name: string;
  result: string;
  detail: string;
}

/** Ops that change state irreversibly enough to deserve an inline confirm. */
const CONFIRM_OPS = new Set(["release", "releaseReservedSeats", "clearRegistrations", "phaseB"]);

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tokenOk, setTokenOk] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState("");

  const [map, setMap] = useState<SeatMapPayload | null>(null);
  const [layout, setLayout] = useState<CompiledLayout | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [details, setDetails] = useState<SeatDetail[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState("");
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ label: string; run: () => void } | null>(null);
  const [assignName, setAssignName] = useState("");
  const [assignPhone, setAssignPhone] = useState("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (kind: "ok" | "err", text: string) => {
    setFlash({ kind, text });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 5000);
  };

  const call = useCallback(
    async (payload: object): Promise<Record<string, unknown>> => {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) throw new Error("סיסמה שגויה או נעילה זמנית");
      return res.json();
    },
    [token],
  );

  const refresh = useCallback(async () => {
    const [m, l] = await Promise.all([
      call({ action: "seatmap" }),
      call({ action: "recentLog" }),
    ]);
    if (m.ok) setMap(m.map as SeatMapPayload);
    const lr = l.result as { rows: LogRow[] } | undefined;
    if (lr) setLog(lr.rows);
  }, [call]);

  const login = async () => {
    setLoginBusy(true);
    setLoginErr("");
    try {
      await refresh();
      const lay = await fetch("/api/layout");
      if (lay.ok) setLayout(await lay.json());
      setTokenOk(true);
      localStorage.setItem("adminToken", token);
    } catch (e) {
      setLoginErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoginBusy(false);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("adminToken");
    if (saved) setToken(saved);
  }, []);

  // Auto-refresh the console every 10s while open — the sale moves without us.
  useEffect(() => {
    if (!tokenOk) return;
    const id = setInterval(() => refresh().catch(() => {}), 10_000);
    return () => clearInterval(id);
  }, [tokenOk, refresh]);

  // Selection details load whenever the selection changes.
  useEffect(() => {
    if (!tokenOk || !selected.length) { setDetails([]); return; }
    let cancelled = false;
    call({ action: "seatDetails", seatNos: selected })
      .then((d) => {
        if (cancelled) return;
        const r = d.result as { seats: SeatDetail[] } | undefined;
        setDetails(r?.seats ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selected, tokenOk, call]);

  const run = async (label: string, payload: object, opts?: { keepSelection?: boolean }) => {
    setBusy(label);
    try {
      const data = await call(payload);
      if (data.ok === false) {
        say("err", `${label}: ${String(data.message ?? data.code ?? "שגיאה")}`);
      } else {
        const result = data.result ?? (data as { seatNos?: number[] }).seatNos ?? "בוצע";
        say("ok", `${label}: ${typeof result === "string" ? result : JSON.stringify(result)}`);
        if (!opts?.keepSelection) setSelected([]);
      }
      await refresh();
    } catch (e) {
      say("err", `${label}: ${e instanceof Error ? e.message : "שגיאה"}`);
    } finally {
      setBusy("");
      setPendingConfirm(null);
    }
  };

  /** Wraps run() with an inline confirmation when the op is destructive. */
  const guarded = (opKey: string, label: string, payload: object) => {
    if (CONFIRM_OPS.has(opKey)) {
      setPendingConfirm({ label, run: () => run(label, payload) });
    } else {
      run(label, payload);
    }
  };

  const counts = useMemo(() => {
    const c = { free: 0, taken: 0, pending: 0, reserved: 0, blocked: 0 };
    if (map) {
      for (const v of Object.values(map.status)) {
        if (v === "0") c.free++;
        else if (v === "1") c.taken++;
        else if (v === "2") c.pending++;
        else if (v === "4") c.reserved++;
        else c.blocked++;
      }
    }
    return c;
  }, [map]);

  /* ---------- login ---------- */
  if (!tokenOk) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
        <h1 className="text-center text-2xl font-bold text-brand-maroon">מסך גבאי</h1>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && token && login()}
          placeholder="סיסמת ניהול"
          className="field text-center"
          autoFocus
        />
        <button onClick={login} disabled={!token || loginBusy} className="btn-primary">
          {loginBusy ? "נכנס…" : "כניסה"}
        </button>
        {loginErr && <p className="pill pill-warn text-center">{loginErr}</p>}
      </main>
    );
  }

  const opBtn = "rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold shadow-sm active:scale-95 disabled:opacity-40";

  /* ---------- console ---------- */
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-brand-maroon">מסך גבאי</h1>
        <div className="tnum flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-seat-free/15 px-2.5 py-1">פנוי {counts.free}</span>
          <span className="rounded-full bg-seat-reserved/15 px-2.5 py-1">שמור {counts.reserved}</span>
          <span className="rounded-full bg-black/10 px-2.5 py-1">תפוס {counts.taken}</span>
          {counts.pending > 0 && (
            <span className="rounded-full bg-seat-pending/20 px-2.5 py-1">משוריין {counts.pending}</span>
          )}
          {counts.blocked > 0 && (
            <span className="rounded-full bg-black/20 px-2.5 py-1">חסום {counts.blocked}</span>
          )}
        </div>
      </header>

      {flash && (
        <div aria-live="polite"
          className={`pill step-in ${flash.kind === "ok" ? "pill-success" : "pill-warn"}`}>
          {flash.text}
        </div>
      )}

      {/* sale state */}
      <section className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-bold">
          מכירה: <b className="text-brand-maroon">{map?.mode === "OPEN" ? "פתוחה" : map?.mode === "READONLY" ? "מוקפאת" : "סגורה"}</b>
          {" · "}סבב: <b className="text-brand-maroon">{map?.phase === "A" ? "א' (חזקות)" : "ב' (פתוח)"}</b>
        </span>
        <div className="flex flex-wrap gap-2">
          <button disabled={!!busy || map?.mode === "OPEN"} className={opBtn}
            onClick={() => run("פתיחת מכירה", { action: "setConfig", key: "MODE", value: "OPEN" })}>
            ▶ פתח
          </button>
          <button disabled={!!busy || map?.mode === "READONLY"} className={opBtn}
            onClick={() => run("הקפאה", { action: "setConfig", key: "MODE", value: "READONLY" })}>
            ⏸ הקפא
          </button>
          <button disabled={!!busy || map?.mode === "CLOSED"} className={opBtn}
            onClick={() => run("סגירה", { action: "setConfig", key: "MODE", value: "CLOSED" })}>
            ⏹ סגור
          </button>
          {map?.phase === "A" && (
            <button disabled={!!busy} className={`${opBtn} border-amber-400 text-amber-800`}
              onClick={() => guarded("phaseB", "פתיחת סבב ב'", { action: "setConfig", key: "PHASE", value: "B" })}>
              פתח סבב ב&apos;
            </button>
          )}
        </div>
      </section>

      {/* map + selection */}
      <section className="card p-3">
        <p className="mb-2 text-sm opacity-70">
          לחץ על מקומות במפה כדי לבחור אותם, ואז בחר פעולה.
          {selected.length > 0 && (
            <b className="tnum"> נבחרו: {[...selected].sort((a, b) => a - b).join(", ")}</b>
          )}
        </p>
        {layout ? (
          <SeatMap
            layout={layout}
            map={map}
            selected={selected}
            adminMode
            onToggleSeat={(sel) =>
              setSelected((cur) =>
                cur.includes(sel.seatNo)
                  ? cur.filter((n) => n !== sel.seatNo)
                  : [...cur, sel.seatNo],
              )
            }
          />
        ) : (
          <p className="p-6 text-center opacity-50">טוען מפה…</p>
        )}

        {selected.length > 0 && (
          <div className="step-in mt-3 flex flex-col gap-3">
            {/* selection details */}
            <div className="overflow-x-auto rounded-xl bg-[#f8f6f2] p-3 text-sm">
              {details.length === 0 ? (
                <p className="opacity-50">טוען פרטים…</p>
              ) : (
                details.map((d) => (
                  <div key={d.seatNo} className="flex flex-wrap items-center gap-2 border-b border-black/5 py-1 last:border-0">
                    <b className="tnum w-14">מקום {d.seatNo}</b>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs">{d.status}</span>
                    {d.holderName && <span>{d.holderName}</span>}
                    {d.holderPhone && <span className="tnum text-xs opacity-60" dir="ltr">{d.holderPhone}</span>}
                    {d.chazakaName && !d.holderName && (
                      <span className="text-xs opacity-60">חזקה: {d.chazakaName}{d.chazakaPhone ? "" : " (בלי טלפון)"}</span>
                    )}
                    {d.status === "תפוס" && (
                      <span className={`text-xs font-bold ${d.paid ? "text-green-700" : "text-amber-700"}`}>
                        {d.paid ? "✓ שולם" : "לא שולם"}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* ops on selection */}
            <div className="flex flex-wrap gap-2">
              <button disabled={!!busy} className={opBtn}
                onClick={() => run("סימון שולם", { action: "gabbai", op: "markPaid", seatNos: selected })}>
                💰 סמן שולם
              </button>
              <button disabled={!!busy} className={`${opBtn} border-red-300 text-red-700`}
                onClick={() => guarded("release", `שחרור ${selected.length} מקומות`, { action: "gabbai", op: "release", seatNos: selected })}>
                🔓 שחרר
              </button>
              <button disabled={!!busy} className={opBtn}
                onClick={() => run("חסימה", { action: "gabbai", op: "block", seatNos: selected })}>
                🚫 חסום
              </button>
              <button disabled={!!busy} className={opBtn}
                onClick={() => run("ביטול חסימה", { action: "gabbai", op: "unblock", seatNos: selected })}>
                ↩️ בטל חסימה
              </button>
              <button disabled={!!busy} className={opBtn} onClick={() => setSelected([])}>
                נקה בחירה
              </button>
            </div>

            {/* manual assign */}
            <div className="flex flex-wrap items-center gap-2">
              <input value={assignName} onChange={(e) => setAssignName(e.target.value)}
                placeholder="שם לשיבוץ ידני" className="field h-10 min-h-0 flex-1 text-sm" />
              <input value={assignPhone} onChange={(e) => setAssignPhone(e.target.value)}
                placeholder="טלפון" className="field h-10 min-h-0 w-36 text-sm" dir="ltr" />
              <button
                disabled={!!busy || assignName.trim().length < 2}
                className={`${opBtn} bg-brand-maroon text-white`}
                onClick={() =>
                  run("שיבוץ ידני", {
                    action: "gabbai", op: "assign", seatNos: selected,
                    name: assignName.trim(), phone: assignPhone.trim(),
                  })
                }>
                שבץ למקומות שנבחרו
              </button>
            </div>
          </div>
        )}
      </section>

      {/* data operations */}
      <section className="card flex flex-col gap-3 p-4">
        <h2 className="font-bold">נתונים וחזקות</h2>
        <div className="flex flex-wrap gap-2">
          <button disabled={!!busy} className={opBtn}
            onClick={() => run("ייבוא מתפללים", { action: "importMembers" })}>
            רענן רשימת מתפללים
          </button>
          <button disabled={!!busy} className={opBtn}
            onClick={() => run("הצלבת חזקות", { action: "runChazakaMatching" })}>
            הרץ הצלבת חזקות
          </button>
          <button disabled={!!busy} className={opBtn}
            onClick={() => run("אישור התאמות", { action: "approveAutoChazaka" })}>
            אשר התאמות אוטומטיות
          </button>
          <button disabled={!!busy} className={opBtn}
            onClick={() => run("זריעת חזקות", { action: "seedChazakaSeats" })}>
            זרע חזקות על המפה
          </button>
          <button disabled={!!busy} className={`${opBtn} border-red-300 text-red-700`}
            onClick={() => guarded("releaseReservedSeats", "שחרור כל החזקות שלא מומשו", { action: "releaseReservedSeats" })}>
            שחרר חזקות שלא מומשו
          </button>
          <button disabled={!!busy} className={opBtn}
            onClick={() => run("סריקת תפוגה", { action: "runExpiryNow" })}>
            הרץ תפוגת משוריינים
          </button>
        </div>
        <p className="text-xs opacity-50">
          התאמות ידניות — בטאב _Chazaka בגיליון. עריכת מבנה האולם —{" "}
          <a href="/admin/layout-editor" className="font-semibold underline">בעורך האולם</a>.
        </p>
      </section>

      {/* activity feed */}
      <section className="card p-4">
        <h2 className="mb-2 font-bold">פעילות אחרונה</h2>
        <div className="flex flex-col gap-1 text-xs">
          {log.length === 0 ? (
            <p className="opacity-50">אין פעילות עדיין.</p>
          ) : (
            log.map((r, i) => (
              <div key={i} className="tnum flex flex-wrap gap-2 border-b border-black/5 py-1 last:border-0">
                <span className="opacity-50">{r.time}</span>
                <b>{r.action}</b>
                {r.seats && <span>מקומות {r.seats}</span>}
                {r.name && <span>{r.name}</span>}
                <span className={r.result === "ok" ? "text-green-700" : "text-amber-700"}>{r.result}</span>
                {r.detail && <span className="opacity-50">{r.detail}</span>}
              </div>
            ))
          )}
        </div>
      </section>

      {/* inline confirmation */}
      {pendingConfirm && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-4 shadow-2xl backdrop-blur safe-bottom">
          <div className="mx-auto flex max-w-lg flex-col gap-2">
            <p className="font-bold">לאשר: {pendingConfirm.label}?</p>
            <p className="text-sm opacity-60">הפעולה נרשמת ביומן ואינה ניתנת לביטול אוטומטי.</p>
            <div className="flex gap-2">
              <button onClick={pendingConfirm.run} disabled={!!busy}
                className="btn-primary flex-1">
                {busy || "כן, בצע"}
              </button>
              <button onClick={() => setPendingConfirm(null)} className="btn-ghost">ביטול</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
