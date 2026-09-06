// Hall geometry for the 3D view. All numbers come from the 1:100 seating plan (tent 12 x 24 m).
// Seats come from /api/layout at runtime, so this file only knows how to place them.
export type ApiSeat = { kind: "seat"; seatNo: number; row: number; col: number; zone: string; facing: "ark" | "away"; tableId: string; side: "a" | "b"; pairSeatNo?: number };
export type Seat = { num: number; row: number; col: number; zone: "m" | "w"; facing: "a" | "b"; r0: number; block: "r" | "c" | "l"; x: number; z: number };
export type Table = { x: number; z: number; w: number; key: string; split: boolean };

// ---------- geometry from the dimensioned plan (PDF, 1:100): tent 12 x 24 m ----------
// x: hall axis = 0, entrance wall (right when facing the ark) = +6. z: front wall = 0, back wall = 24 (shifted by -12 for the camera).
const HALL_W = 12, HALL_L = 24, Z0 = -12;
const cm = (v: number) => v / 100;
const PITCH = 0.6;                       // 60 cm per person
// right wall carries a 30 cm bookcase with a 40 cm clearance in front of it, paid for by the two aisles:
// 10 + 360 + 80 + 240 + 80 + 360 + 40 + 30 = 1200
const LIB_D = 0.3, LIB_GAP = 0.4, AISLE = 0.8;
const R_CX = 6 - LIB_D - LIB_GAP - 1.8;              // 3.5
const C_CX = R_CX - 1.8 - AISLE - 1.2;               // -0.3
const L_CX = C_CX - 1.2 - AISLE - 1.8;               // -4.1
const BLOCK_CX: Record<"r" | "c" | "l", number> = { r: R_CX, c: C_CX, l: L_CX };
// row starts (cm from the front wall): 90 libraries + 150 front, then 174 rows with 42 gaps, 270 transverse aisle, 90 + mechitza + 60, women's rows with a 45 gap
const ROW_START: Record<number, number> = { 4: 240, 7: 456, 10: 672, 13: 888, 18: 1332, 21: 1548, 26: 1872, 29: 2091 };
const tableZ = (r0: number) => Z0 + cm(ROW_START[r0] + 50 + 37);   // chair 50 + half table 37
const blockOf = (col: number): "r" | "c" | "l" => (col <= 8 ? "r" : col <= 14 ? "c" : "l");
const SHORT = "18-r";                                       // row 5 right table shortened to 180 for the washing corner
const seatX = (s: { col: number }, r0: number) => {
  const b = blockOf(s.col);
  if (`${r0}-${b}` === SHORT) return R_CX - 0.9 + (6.5 - s.col) * 0.45;   // 4 API seats on the 180 table at the aisle side
  return b === "r" ? BLOCK_CX.r + (5.5 - s.col) * PITCH : b === "c" ? BLOCK_CX.c + (12.5 - s.col) * PITCH : BLOCK_CX.l + (19.5 - s.col) * PITCH;
};


export function buildSeats(cells: ApiSeat[]): Seat[] {
  return cells.filter((c) => c.kind === "seat").map((c) => {
    const facing: "a" | "b" = c.facing === "ark" ? "a" : "b";
    const r0 = facing === "a" ? c.row : c.row - 1;
    const seat: Seat = { num: c.seatNo, row: c.row, col: c.col, zone: c.zone === "נשים" ? "w" : "m", facing, r0, block: blockOf(c.col), x: 0, z: 0 };
    seat.x = seatX(seat, r0);
    // Same order as the 2D map: the ark-facing row (layout row r0) is the one
    // nearer the ark, its opposite sits on the far side of the table.
    seat.z = tableZ(r0) + (facing === "a" ? -0.66 : 0.66);
    return seat;
  });
}
export function buildTables(seats: Seat[]): Table[] {
  const out: Table[] = []; const seen = new Set<string>();
  seats.forEach((s) => {
    const k = `${s.r0}-${s.block}`; if (seen.has(k)) return; seen.add(k);
    const short = k === SHORT;
    out.push({ x: short ? R_CX - 0.9 : BLOCK_CX[s.block], z: tableZ(s.r0), w: s.block === "c" ? 2.4 : short ? 1.8 : 3.6, key: k, split: !short && s.block !== "c" });
  });
  return out;
}
export const ELEMENTS = {
  wall: HALL_W / 2,
  zFront: Z0, zBack: Z0 + HALL_L,
  ark: { x: C_CX, z: Z0 + cm(30), w: 1.5, d: 0.6 },
  libraries: [],
  // brown bookcase along the whole right wall, 40 deep, broken only by the men's door, the washing corner and the women's door
  wallLibrary: [
    { z1: Z0 + cm(20), z2: Z0 + cm(1212) },
    { z1: Z0 + cm(1506), z2: Z0 + cm(2275) },
  ],
  amudim: [{ x: C_CX + 1.4, z: Z0 + cm(90) }, { x: C_CX - 1.4, z: Z0 + cm(90) }],
  bimah: { x: C_CX, z: Z0 + cm(1062 + 135), w: 2.2, d: 1.5 },
  siddurim: { z1: Z0 + cm(1062), z2: Z0 + cm(1212) },        // 150 x 40 on the entrance wall, ark side of the aisle
  menDoor: { z1: Z0 + cm(1212), z2: Z0 + cm(1332) },        // 120
  wash: { x1: R_CX, x2: 6 - LIB_D, z1: Z0 + cm(1332), z2: Z0 + cm(1506) },   // 180 x 174, from the short table to the wall
  mechitza: { z: Z0 + cm(1812) },
  womenDoor: { z1: Z0 + cm(2275), z2: Z0 + cm(2390) },      // 115, rear strip
  exits: [],   // only the two main entrances
  acGaps: [435, 651, 867, 1506, 2046].map((v) => Z0 + cm(v + 21)),   // wall AC units in the 42/45 cm gaps
};


export { tableZ, R_CX, C_CX, L_CX, Z0, cm };
