"use client";

/**
 * The public page: live hall map, seat selection with the pairing rule
 * expressed as a helpful auto-select, and the claim sheet.
 *
 * Geometry loads once per layout version; only the compact status payload is
 * polled. When the poll reports a new layoutVersion the geometry refetches —
 * that is the entire cache-invalidation story.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompiledLayout, SeatMapPayload } from "@/lib/domain";
import { SeatMap, Legend, type SeatSelection } from "@/components/SeatMap";
import { ClaimSheet } from "@/components/ClaimSheet";

const POLL_MS = 4_000;

export default function HomePage() {
  const [layout, setLayout] = useState<CompiledLayout | null>(null);
  const [map, setMap] = useState<SeatMapPayload | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const layoutVersionRef = useRef("");

  const fetchLayout = useCallback(async () => {
    const res = await fetch("/api/layout");
    if (res.ok) {
      const l: CompiledLayout = await res.json();
      layoutVersionRef.current = l.version;
      setLayout(l);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/seatmap");
      if (!res.ok) return;
      const m: SeatMapPayload = await res.json();
      setMap(m);
      if (m.layoutVersion && m.layoutVersion !== layoutVersionRef.current) {
        await fetchLayout();
      }
    } catch {
      /* transient poll failure — the next tick retries */
    }
  }, [fetchLayout]);

  useEffect(() => {
    fetchLayout();
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [fetchLayout, poll]);

  const toggleSeat = (sel: SeatSelection) => {
    setNotice("");
    setSelected((cur) => {
      if (cur.includes(sel.seatNo)) {
        // Deselecting an ark-facing seat also drops its auto-added pair.
        return cur.filter((n) => n !== sel.seatNo && n !== sel.pairSeatNo);
      }
      let next = [...cur, sel.seatNo];
      // The pairing rule as UX: picking an ark-facing seat pulls in its free
      // pair automatically, so the rule reads as "you get both" not "error".
      if (sel.facing === "ark" && sel.pairSeatNo) {
        const pairCode = map?.status[String(sel.pairSeatNo)] ?? "0";
        if (pairCode === "0" && !next.includes(sel.pairSeatNo)) {
          next = [...next, sel.pairSeatNo];
          setNotice(`מקום הפונה לארון נמכר יחד עם המקום שמולו — צורף גם מקום ${sel.pairSeatNo}.`);
        }
      }
      if (next.length > 3) {
        setNotice("עד 3 מקומות לרכישה אחת.");
        return cur;
      }
      return next;
    });
  };

  const onClaimed = (claimed: number[]) => {
    setSelected([]);
    setNotice(`נרשם! מקומות ${claimed.join(", ")} על שמך. אישור נשלח למייל.`);
    poll();
  };

  const mode = map?.mode ?? "CLOSED";

  return (
    <main className="flex flex-1 flex-col gap-3 p-3 pb-64">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">בחירת מקומות תשפ&quot;ז</h1>
          <p className="text-xs opacity-70">בית הכנסת חב&quot;ד &quot;בית מנחם&quot; — גני איילון</p>
        </div>
        <Legend />
      </header>

      {mode !== "OPEN" && (
        <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          {mode === "READONLY"
            ? "המכירה מוקפאת זמנית — המפה לצפייה בלבד."
            : "המכירה עדיין לא נפתחה. המפה לצפייה בלבד."}
        </div>
      )}
      {map?.phase === "A" && mode === "OPEN" && (
        <div className="rounded border border-blue-300 bg-blue-50 p-2 text-sm">
          סבב ראשון — בעלי חזקה משנה שעברה בלבד. הסבב הפתוח ייפתח בהמשך.
        </div>
      )}
      {notice && <div className="rounded border bg-white p-2 text-sm">{notice}</div>}

      {layout ? (
        <SeatMap layout={layout} map={map} selected={selected} onToggleSeat={toggleSeat} />
      ) : (
        <p className="p-8 text-center opacity-60">טוען את מפת האולם…</p>
      )}

      <p className="text-[11px] opacity-50">
        המפה מתעדכנת אוטומטית. שם מוצג על מקום תפוס; פרטי קשר אינם מוצגים לציבור.
      </p>

      {mode === "OPEN" && (
        <ClaimSheet
          selected={selected}
          onDone={onClaimed}
          onClear={() => setSelected([])}
        />
      )}
    </main>
  );
}
