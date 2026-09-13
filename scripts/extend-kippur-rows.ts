/**
 * Adds two temporary women's strips (Yom Kippur only) behind the existing
 * women's section, without renumbering anything: seats 1..N are proven
 * unchanged against the live compiled layout before extendLayout is called.
 *
 * Run:  npx tsx scripts/extend-kippur-rows.ts [--apply]
 */
import { readFileSync } from "node:fs";
import { numberSeats, type HallLayout, type TableSpec } from "@/lib/layout";
import { compileLayout } from "@/lib/compile";
import { KIPPUR_ZONE } from "@/lib/domain";

const env: Record<string, string> = {};
for (const line of readFileSync("/Users/mendito/repos/shul-seats/.env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const [k, ...v] = t.split("=");
  env[k] = v.join("=").trim().replace(/^["']|["']$/g, "");
}

async function gas<T>(payload: object): Promise<T> {
  const res = await fetch(env.GAS_URL, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, secret: env.GAS_SECRET }),
    redirect: "follow",
  });
  const text = await res.text();
  if (!text.trim().startsWith("{")) throw new Error("non-JSON from GAS: " + text.slice(0, 120));
  return JSON.parse(text) as T;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { layout } = await gas<{ ok: boolean; layout: HallLayout | null }>({ action: "loadLayout" });
  if (!layout) throw new Error("no saved layout");
  const live = await fetch("https://beit-menachem.vercel.app/api/layout").then((r) => r.json());
  const liveSeats = live.cells.filter((c: { kind: string }) => c.kind === "seat");
  console.log("saved tables", layout.tables.length, "rows", layout.rows, "live seats", liveSeats.length, "version", live.version);

  const lastWomen = layout.tables.filter((t) => t.zone === "נשים").sort((a, b) => b.row - a.row)[0];
  // Same rhythm as the editor's strips: 2 seat rows + 1 aisle row.
  const r1 = lastWomen.row + 3;
  const r2 = r1 + 3;
  // Same three groups as the front women's strip (6 / 4 / 6), same columns.
  const front = layout.tables.filter((t) => t.id.startsWith("t-w1-"));
  const added: TableSpec[] = [];
  [r1, r2].forEach((row, i) => {
    for (const g of front) {
      added.push({
        kind: "table", id: `t-k${i + 1}-${g.id.split("-").pop()}`, row, col: g.col,
        orientation: "h", seatsPerSide: g.seatsPerSide, zone: KIPPUR_ZONE,
      });
    }
  });
  const next: HallLayout = {
    ...layout,
    rows: r2 + 3,
    tables: [...layout.tables, ...added],
    elements: [
      ...layout.elements,
      {
        kind: "element", id: "kippur-rows", label: "שורות זמניות — יום כיפור בלבד",
        row: r1 - 1, col: 2, rowSpan: 1, colSpan: layout.cols - 1,
      },
    ],
    numberingOrder: [...layout.numberingOrder, ...added.map((t) => t.id)],
  };

  const seats = numberSeats(next);
  const compiled = compileLayout(next);
  // Prove the prefix is untouched against what the public map serves today.
  const byNo = new Map(seats.map((s) => [s.seatNo, s]));
  for (const c of liveSeats) {
    const s = byNo.get(c.seatNo);
    if (!s) throw new Error(`seat ${c.seatNo} missing`);
    const same = s.tableId === c.tableId && s.side === c.side && (s.facingArk ? "ark" : "away") === c.facing &&
      s.pairSeatNo === c.pairSeatNo && s.zone === c.zone && s.row === c.row && s.col === c.col;
    if (!same) throw new Error(`seat ${c.seatNo} changed: ${JSON.stringify(s)} vs ${JSON.stringify(c)}`);
  }
  const fresh = seats.filter((s) => s.seatNo > liveSeats.length);
  console.log("prefix unchanged:", liveSeats.length, "seats; adding", fresh.length,
    "seats", fresh[0].seatNo, "-", fresh[fresh.length - 1].seatNo, "rows", r1, r2, "grid rows", next.rows);
  if (!apply) { console.log("dry run — pass --apply to write"); return; }
  const out = await gas<{ ok: boolean; result?: unknown; error?: string }>({
    action: "extendLayout", layout: next, seats, compiled,
  });
  console.log(JSON.stringify(out));
}

main().catch((e) => { console.error(e); process.exit(1); });
