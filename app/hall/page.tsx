"use client";

/**
 * /hall — a read-only 3D walk-through of the hall with the current holder
 * names, live from the same two endpoints the picker uses (/api/layout,
 * /api/seatmap). Nothing is selectable here; it is the seating plan as a
 * picture, for the WhatsApp group and for the gabbai's table.
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
import { Logo } from "@/components/Logo";

const Hall3D = dynamic(() => import("@/components/Hall3D"), {
  ssr: false,
  loading: () => <p className="p-8 text-center opacity-50">טוען את האולם…</p>,
});

const POLL_MS = 5_000;

export default function HallPage() {
  const [layout, setLayout] = useState<CompiledLayout | null>(null);
  const [map, setMap] = useState<SeatMapPayload | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showNames, setShowNames] = useState(true);
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

  const taken = map ? Object.values(map.status).filter((v) => v === "1").length : 0;
  const total = layout?.cells.filter((c) => c.kind === "seat").length ?? 0;
  const hoverName = hover !== null ? map?.holders[String(hover)] : undefined;
  const hoverCode = hover !== null ? map?.status[String(hover)] ?? "0" : "0";

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-3">
          <Logo compact />
          <div>
            <h1 className="whitespace-nowrap text-sm font-bold text-brand-maroon sm:text-base">הדמיית האולם</h1>
            <p className="hidden text-xs opacity-60 sm:block">
              {map ? `${taken} מתוך ${total} מקומות רשומים · מתעדכן כל ${POLL_MS / 1000} שניות` : "טוען…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
            שמות
          </label>
          <Link href="/" className="rounded-full border-2 border-brand-maroon/40 px-3 py-1 font-bold text-brand-maroon no-underline">
            לבחירת מקום
          </Link>
        </div>
      </header>
      {error && <p className="px-4 text-sm text-brand-maroon">{error}</p>}
      <div className="relative flex-1">
        {layout ? (
          <Hall3D
            cells={layout.cells as ApiSeat[]}
            statusOf={statusOf}
            onToggle={() => {}}
            onHover={setHover}
            names={showNames ? map?.holders ?? {} : {}}
            readOnly
            className="h-[calc(100vh-64px)] w-full"
          />
        ) : (
          <p className="p-8 text-center opacity-50">טוען את מפת האולם…</p>
        )}
        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1.5 text-xs">
          <div className="rounded-xl bg-white/90 px-3 py-1.5 shadow">
            {hover !== null
              ? `מקום ${hover}${hoverName ? ` — ${hoverName}` : hoverCode === "0" ? " — פנוי" : ""}`
              : "ריחוף על כיסא מציג את בעל המקום"}
          </div>
          <div className="flex gap-3 rounded-xl bg-white/90 px-3 py-1.5 shadow">
            <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[#2f5fa8]" />שמור</span>
            <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[#777]" />תפוס</span>
            <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full border border-black/20" />פנוי</span>
          </div>
        </div>
        <p className="pointer-events-none absolute bottom-3 left-3 hidden rounded-xl bg-white/90 px-3 py-1.5 text-xs shadow md:block">
          גרירה — סיבוב · Shift+גרירה — הזזה · גלגלת — זום
        </p>
      </div>
    </main>
  );
}
