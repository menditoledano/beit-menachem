"use client";

/**
 * The gabbai console. Lives in the web app rather than a Sheets custom menu
 * because Apps Script menus do not run in the Sheets mobile app — and a rush
 * is exactly when the gabbai is standing in the hall with a phone.
 */

import { useCallback, useEffect, useState } from "react";
import type { SeatMapPayload } from "@/lib/domain";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tokenOk, setTokenOk] = useState(false);
  const [map, setMap] = useState<SeatMapPayload | null>(null);
  const [seatInput, setSeatInput] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignPhone, setAssignPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("adminToken");
    if (saved) setToken(saved);
  }, []);

  const say = (m: string) => setLog((l) => [m, ...l].slice(0, 20));

  const call = useCallback(
    async (payload: object): Promise<Record<string, unknown>> => {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) throw new Error("סיסמה שגויה");
      return res.json();
    },
    [token],
  );

  const refresh = useCallback(async () => {
    const data = await call({ action: "seatmap" });
    if (data.ok) {
      setMap(data.map as SeatMapPayload);
      setTokenOk(true);
      localStorage.setItem("adminToken", token);
    }
  }, [call, token]);

  const seats = () =>
    seatInput
      .split(/[ ,]+/)
      .map(Number)
      .filter((n) => n >= 1);

  const run = async (label: string, payload: object) => {
    setBusy(true);
    try {
      const data = await call(payload);
      say(`${label}: ${JSON.stringify(data.result ?? data.code ?? data.ok)}`);
      await refresh();
    } catch (e) {
      say(`${label}: שגיאה — ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  if (!tokenOk) {
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-3 p-8">
        <h1 className="text-xl font-bold">מסך גבאי</h1>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="סיסמת ניהול"
          className="rounded border p-2"
        />
        <button
          onClick={() => refresh().catch((e) => say(String(e)))}
          disabled={!token}
          className="rounded bg-ark p-2 font-bold text-white disabled:opacity-50"
        >
          כניסה
        </button>
        {log[0] && <p className="text-sm text-red-700">{log[0]}</p>}
      </main>
    );
  }

  const taken = map ? Object.values(map.status).filter((v) => v === "1").length : 0;
  const pending = map ? Object.values(map.status).filter((v) => v === "2").length : 0;
  const free = map ? Object.values(map.status).filter((v) => v === "0").length : 0;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">מסך גבאי</h1>
        <span className="tnum text-sm">
          תפוס {taken} · משוריין {pending} · פנוי {free}
        </span>
      </header>

      <section className="rounded border bg-white p-3">
        <h2 className="mb-2 font-bold">מצב מכירה</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded bg-gray-100 px-2 py-1">
            מצב: <b>{map?.mode}</b> · סבב: <b>{map?.phase}</b>
          </span>
          <button disabled={busy} onClick={() => run("פתיחה", { action: "setConfig", key: "MODE", value: "OPEN" })} className="rounded border px-2 py-1">פתח מכירה</button>
          <button disabled={busy} onClick={() => run("הקפאה", { action: "setConfig", key: "MODE", value: "READONLY" })} className="rounded border px-2 py-1">הקפא</button>
          <button disabled={busy} onClick={() => run("סגירה", { action: "setConfig", key: "MODE", value: "CLOSED" })} className="rounded border px-2 py-1">סגור</button>
          <button disabled={busy} onClick={() => run("סבב ב", { action: "setConfig", key: "PHASE", value: "B" })} className="rounded border px-2 py-1 font-bold">פתח סבב ב&apos;</button>
        </div>
      </section>

      <section className="rounded border bg-white p-3">
        <h2 className="mb-2 font-bold">פעולות על מקומות</h2>
        <input
          value={seatInput}
          onChange={(e) => setSeatInput(e.target.value)}
          placeholder="מספרי מקומות, למשל: 12, 13"
          className="mb-2 w-full rounded border p-2"
          dir="ltr"
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <button disabled={busy} onClick={() => run("שחרור", { action: "gabbai", op: "release", seatNos: seats() })} className="rounded border border-red-400 px-2 py-1 text-red-700">שחרר</button>
          <button disabled={busy} onClick={() => run("שולם", { action: "gabbai", op: "markPaid", seatNos: seats() })} className="rounded border px-2 py-1">סמן שולם</button>
          <button disabled={busy} onClick={() => run("חסימה", { action: "gabbai", op: "block", seatNos: seats() })} className="rounded border px-2 py-1">חסום</button>
          <button disabled={busy} onClick={() => run("שחרור חסימה", { action: "gabbai", op: "unblock", seatNos: seats() })} className="rounded border px-2 py-1">בטל חסימה</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={assignName} onChange={(e) => setAssignName(e.target.value)} placeholder="שם לשיבוץ ידני" className="flex-1 rounded border p-2 text-sm" />
          <input value={assignPhone} onChange={(e) => setAssignPhone(e.target.value)} placeholder="טלפון" className="w-32 rounded border p-2 text-sm" dir="ltr" />
          <button
            disabled={busy || !assignName}
            onClick={() => run("שיבוץ", { action: "gabbai", op: "assign", seatNos: seats(), name: assignName, phone: assignPhone })}
            className="rounded bg-ark px-3 py-1 text-sm font-bold text-white disabled:opacity-40"
          >
            שבץ
          </button>
        </div>
      </section>

      <section className="rounded border bg-white p-3">
        <h2 className="mb-2 font-bold">חזקות ונתונים</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <button disabled={busy} onClick={() => run("הצלבת חזקות", { action: "runChazakaMatching" })} className="rounded border px-2 py-1">הרץ הצלבת חזקות</button>
          <button disabled={busy} onClick={() => run("אישור אוטומטיים", { action: "approveAutoChazaka" })} className="rounded border px-2 py-1">אשר התאמות אוטומטיות</button>
          <button disabled={busy} onClick={() => run("ייבוא מתפללים", { action: "importMembers" })} className="rounded border px-2 py-1">רענן רשימת מתפללים</button>
        </div>
        <p className="mt-2 text-xs opacity-60">
          התאמות לבדיקה ידנית — בטאב _Chazaka בגיליון. עריכת המפה —
          <a href="/admin/layout-editor" className="underline">בעורך האולם</a>.
        </p>
      </section>

      <section className="rounded border bg-white p-3 text-xs">
        <h2 className="mb-1 font-bold">יומן פעולות אחרון</h2>
        {log.length ? log.map((m, i) => <div key={i}>{m}</div>) : <p className="opacity-50">—</p>}
      </section>
    </main>
  );
}
