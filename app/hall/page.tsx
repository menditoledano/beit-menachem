"use client";

/**
 * /hall — a read-only 3D view of the hall, live from the same two endpoints
 * the picker uses (/api/layout, /api/seatmap). Tap a chair to see whose it
 * is; nothing is selectable for purchase here.
 *
 * seatmap.holders is already public (the 2D map draws it), so this page
 * exposes nothing new.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { CompiledLayout, SeatMapPayload } from "@/lib/domain";
import type { ApiSeat } from "@/components/hall3d-geometry";
import type { SeatStatus } from "@/components/Hall3D";

const Hall3D = dynamic(() => import("@/components/Hall3D"), {
  ssr: false,
  loading: () => <p className="p-8 text-center opacity-50">טוען את האולם…</p>,
});

const POLL_MS = 5_000;

export default function HallPage() {
  const [layout, setLayout] = useState<CompiledLayout | null>(null);
  const [map, setMap] = useState<SeatMapPayload | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadLayout = useCallback(async () => {
    const r = await fetch("/api/layout", { cache: "no-store" });
    if (!r.ok) throw new Error("layout");
    setLayout(await r.json());
  }, []);
  const loadMap = useCallback(async () => {
    try {
      const r = await fetch("/api/seatmap", { cache: "no-store" });
      if (!r.ok) return;
      const m: SeatMapPayload = await r.json();
      setMap(m);
      setError("");
      if (layout && m.layoutVersion !== layout.version) await loadLayout();
    } catch {
      setError("אין תקשורת עם המערכת, מציג נתונים אחרונים");
    }
  }, [layout, loadLayout]);

  useEffect(() => {
    loadLayout().catch(() => setError("לא הצלחתי לטעון את מפת האולם"));
  }, [loadLayout]);
  useEffect(() => {
    loadMap();
    const t = setInterval(loadMap, POLL_MS);
    return () => clearInterval(t);
  }, [loadMap]);

  const statusOf = useCallback(
    (n: number): SeatStatus => {
      const code = map?.status[String(n)] ?? "0";
      return code === "0" ? "free" : code === "4" ? "reserved" : "taken";
    },
    [map],
  );
  // Tapping the outlined chair again clears the card.
  const onSelect = useCallback((n: number) => setPicked((cur) => (cur === n ? null : n)), []);

  const taken = map ? Object.values(map.status).filter((v) => v !== "0").length : 0;
  const total = layout?.cells.filter((c) => c.kind === "seat").length ?? 0;
  const pickedCode = picked !== null ? map?.status[String(picked)] ?? "0" : "0";
  const pickedName = picked !== null ? map?.holders[String(picked)] : undefined;
  const pickedCell = picked !== null ? layout?.cells.find((c) => c.kind === "seat" && c.seatNo === picked) : undefined;
  const pickedZone = pickedCell?.kind === "seat" ? pickedCell.zone : "";

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#e6dbc4]">
      {layout ? (
        <Hall3D
          cells={layout.cells as ApiSeat[]}
          statusOf={statusOf}
          onSelect={onSelect}
          selectedSeat={picked}
          className="absolute inset-0"
        />
      ) : (
        <p className="p-8 text-center opacity-50">טוען את מפת האולם…</p>
      )}

      {/* Floating header: name, live count, way back. */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
      >
        <div className="rounded-2xl bg-white/90 px-3 py-1.5 shadow">
          <h1 className="text-sm font-bold leading-tight text-brand-maroon">בית מנחם — הדמיית האולם</h1>
          <p className="text-[11px] leading-tight opacity-60">
            {map ? `${taken} מתוך ${total} מקומות רשומים · לחץ על כיסא לשם` : "טוען…"}
          </p>
        </div>
        <Link
          href="/"
          className="pointer-events-auto flex h-10 items-center rounded-full bg-brand-maroon px-3 text-sm font-bold text-white no-underline shadow"
        >
          לבחירת מקום
        </Link>
      </header>
      {error && (
        <p className="absolute inset-x-3 top-16 rounded-xl bg-white/90 px-3 py-1.5 text-center text-xs text-brand-maroon shadow">{error}</p>
      )}

      {/* Detail card for the tapped chair, under the header — the bottom
          edge belongs to the thumb controls. */}
      {picked !== null && (
        <div
          className="step-in absolute inset-x-3 top-[calc(4.75rem+env(safe-area-inset-top))] mx-auto max-w-sm rounded-2xl bg-white/95 px-4 py-3 shadow-lg"
          role="dialog"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-bold text-brand-maroon">
                מקום {picked}
                {pickedZone === "נשים" && <span className="mr-2 text-xs font-normal opacity-60">עזרת נשים</span>}
              </div>
              <div className="text-sm">
                {pickedName
                  ? pickedName
                  : pickedCode === "0" ? "פנוי" : pickedCode === "2" ? "משוריין" : "תפוס"}
              </div>
            </div>
            <button onClick={() => setPicked(null)} className="btn-ghost text-sm" aria-label="סגור">✕</button>
          </div>
        </div>
      )}
    </main>
  );
}
