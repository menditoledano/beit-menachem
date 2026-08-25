"use client";

/**
 * Hall layout editor. The unit of editing is a table (two facing seat rows);
 * seat numbering, pairing and the ark-facing flag all derive from table
 * structure, so the gabbai arranges ~20 tables instead of ~190 chairs.
 *
 * RTL note: grid column 1 is the RIGHTMOST cell on screen. The ark lives at
 * high column indices, which renders on the LEFT — matching the physical hall.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HallLayout, TableSpec } from "@/lib/layout";
import { countSeats, numberSeats, seedFromOldHall, validateLayout } from "@/lib/layout";
import { compileLayout } from "@/lib/compile";

type Sel = { kind: "table" | "element"; id: string } | null;

export default function LayoutEditorPage() {
  const [token, setToken] = useState("");
  const [tokenOk, setTokenOk] = useState(false);
  const [layout, setLayout] = useState<HallLayout | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("adminToken");
    if (saved) setToken(saved);
  }, []);

  const authed = useCallback(
    (init?: RequestInit): RequestInit => ({
      ...init,
      headers: { ...init?.headers, "x-admin-token": token, "Content-Type": "application/json" },
    }),
    [token],
  );

  const load = useCallback(async () => {
    setBusy("טוען…");
    try {
      const res = await fetch("/api/admin/layout", authed());
      if (res.status === 403) { setMessage("סיסמה שגויה"); setTokenOk(false); return; }
      const data = await res.json();
      localStorage.setItem("adminToken", token);
      setTokenOk(true);
      setLayout(data.layout ?? seedFromOldHall());
      setMessage(data.layout ? "נטענה פריסה שמורה" : "נטען בסיס: האולם הישן מוגדל לפרופורציה החדשה");
    } finally {
      setBusy("");
    }
  }, [authed, token]);

  const seats = useMemo(() => (layout ? numberSeats(layout) : []), [layout]);
  const problems = useMemo(() => (layout ? validateLayout(layout) : []), [layout]);
  const errors = problems.filter((p) => p.severity === "error");

  const mutateTable = (id: string, fn: (t: TableSpec) => TableSpec) => {
    setLayout((l) => l && {
      ...l,
      tables: l.tables.map((t) => (t.id === id ? fn(t) : t)),
    });
  };

  const moveSel = (dr: number, dc: number) => {
    if (!sel || !layout) return;
    if (sel.kind === "table") {
      mutateTable(sel.id, (t) => ({ ...t, row: t.row + dr, col: t.col + dc }));
    } else {
      setLayout((l) => l && {
        ...l,
        elements: l.elements.map((e) =>
          e.id === sel.id ? { ...e, row: e.row + dr, col: e.col + dc } : e,
        ),
      });
    }
  };

  const addTable = () => {
    if (!layout) return;
    const id = `t-new-${Date.now() % 100000}`;
    setLayout({
      ...layout,
      tables: [...layout.tables, {
        kind: "table", id, row: 2, col: 2, orientation: "v", seatsPerSide: 6, zone: "מרכז",
      }],
      numberingOrder: [...layout.numberingOrder, id],
    });
    setSel({ kind: "table", id });
  };

  const removeSelected = () => {
    if (!sel || !layout || sel.kind !== "table") return;
    setLayout({
      ...layout,
      tables: layout.tables.filter((t) => t.id !== sel.id),
      numberingOrder: layout.numberingOrder.filter((id) => id !== sel.id),
    });
    setSel(null);
  };

  const save = async (publish: boolean) => {
    if (!layout) return;
    if (publish && errors.length) { setMessage("יש שגיאות — אי אפשר לפרסם"); return; }
    setBusy(publish ? "מפרסם…" : "שומר…");
    try {
      const body = publish
        ? { publish: true, layout, seats: numberSeats(layout), compiled: compileLayout(layout) }
        : { layout };
      const res = await fetch("/api/admin/layout", authed({ method: "POST", body: JSON.stringify(body) }));
      const data = await res.json();
      setMessage(data.ok
        ? (publish ? `פורסם: ${data.result.seats} מקומות, גרסה ${data.result.version}` : "נשמר")
        : `שגיאה: ${data.message || data.code}`);
    } finally {
      setBusy("");
    }
  };

  if (!tokenOk) {
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-3 p-8">
        <h1 className="text-xl font-bold">כניסת גבאי</h1>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="סיסמת ניהול"
          className="rounded border p-2"
        />
        <button onClick={load} disabled={!token || !!busy}
          className="rounded bg-ark p-2 font-bold text-white disabled:opacity-50">
          {busy || "כניסה"}
        </button>
        {message && <p className="text-sm text-red-700">{message}</p>}
      </main>
    );
  }

  if (!layout) return <main className="p-8">{busy || "…"}</main>;

  const selTable = sel?.kind === "table" ? layout.tables.find((t) => t.id === sel.id) : null;

  return (
    <main className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">עורך האולם</h1>
        <span className="rounded bg-ark px-2 py-1 text-sm text-white tnum">
          {countSeats(layout)} מקומות
        </span>
        <button onClick={addTable} className="rounded border px-3 py-1">+ שולחן</button>
        <button onClick={() => save(false)} disabled={!!busy} className="rounded border px-3 py-1">
          שמור טיוטה
        </button>
        <button onClick={() => save(true)} disabled={!!busy || errors.length > 0}
          className="rounded bg-ark px-3 py-1 font-bold text-white disabled:opacity-40">
          פרסם
        </button>
        {busy && <span className="text-sm">{busy}</span>}
        {message && <span className="text-sm opacity-70">{message}</span>}
      </header>

      {errors.length > 0 && (
        <div className="rounded border border-red-400 bg-red-50 p-2 text-sm text-red-800">
          {errors.map((p, i) => <div key={i}>{p.message}</div>)}
        </div>
      )}

      {selTable && (
        <div className="flex flex-wrap items-center gap-2 rounded border bg-white p-2 text-sm">
          <b>{selTable.id}</b>
          <button onClick={() => moveSel(-1, 0)} className="rounded border px-2">↑</button>
          <button onClick={() => moveSel(1, 0)} className="rounded border px-2">↓</button>
          {/* RTL: raising the column index moves the table toward the ark (left). */}
          <button onClick={() => moveSel(0, 1)} className="rounded border px-2">←</button>
          <button onClick={() => moveSel(0, -1)} className="rounded border px-2">→</button>
          <span className="mx-2">מקומות בכל צד:</span>
          <button onClick={() => mutateTable(selTable.id, (t) => ({ ...t, seatsPerSide: Math.max(1, t.seatsPerSide - 1) }))} className="rounded border px-2">−</button>
          <span className="tnum">{selTable.seatsPerSide}</span>
          <button onClick={() => mutateTable(selTable.id, (t) => ({ ...t, seatsPerSide: t.seatsPerSide + 1 }))} className="rounded border px-2">+</button>
          <select value={selTable.zone}
            onChange={(e) => mutateTable(selTable.id, (t) => ({ ...t, zone: e.target.value }))}
            className="rounded border px-1">
            <option>מזרח</option><option>מרכז</option><option>כניסה</option>
          </select>
          <button onClick={removeSelected} className="rounded border border-red-400 px-2 text-red-700">
            מחק שולחן
          </button>
        </div>
      )}

      <div className="overflow-auto rounded border bg-white p-2" style={{ overscrollBehavior: "contain" }}>
        <div
          className="grid w-max gap-1"
          style={{
            gridTemplateRows: `repeat(${layout.rows}, 28px)`,
            gridTemplateColumns: `repeat(${layout.cols}, 28px)`,
          }}
        >
          {seats.map((s) => (
            <button
              key={s.seatNo}
              onClick={() => setSel({ kind: "table", id: s.tableId })}
              className={`tnum rounded text-[10px] text-white ${
                s.facingArk ? "bg-seat-mine" : "bg-seat-free"
              } ${sel?.kind === "table" && sel.id === s.tableId ? "ring-2 ring-black" : ""}`}
              style={{ gridRow: s.row, gridColumn: s.col }}
              title={`${s.tableId} — מקום ${s.seatNo}${s.facingArk ? " (פונה לארון)" : ""}`}
            >
              {s.seatNo}
            </button>
          ))}
          {layout.elements.map((e) => (
            <button
              key={e.id}
              onClick={() => setSel({ kind: "element", id: e.id })}
              className={`flex items-center justify-center rounded bg-ark p-1 text-[10px] text-white ${
                sel?.kind === "element" && sel.id === e.id ? "ring-2 ring-black" : ""
              }`}
              style={{
                gridRow: `${e.row} / span ${e.rowSpan}`,
                gridColumn: `${e.col} / span ${e.colSpan}`,
                writingMode: e.rowSpan > e.colSpan * 2 ? "vertical-rl" : undefined,
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs opacity-60">
        כחול = פונה לארון, ירוק = מולו. לחיצה על מקום בוחרת את השולחן שלו.
        חיצים מזיזים את הנבחר; אלמנטים (ארון, בימה) זזים גם הם אחרי לחיצה עליהם.
      </p>
    </main>
  );
}
