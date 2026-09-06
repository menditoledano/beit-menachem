"use client";
// 3D hall view for the seat picker. Same data as the 2D map (/api/layout + /api/seatmap), same callbacks.
// Chairs are all one colour; status is shown by a ring on the floor under the chair.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ApiSeat, Seat, buildSeats, buildTables, ELEMENTS, tableZ, R_CX, C_CX, L_CX, Z0 } from "./hall3d-geometry";

export type SeatStatus = "free" | "taken" | "reserved" | "mine" | "selected";
export type Hall3DProps = {
  cells: ApiSeat[];                              // layout.cells from /api/layout
  statusOf: (seatNo: number) => SeatStatus;      // derived from /api/seatmap status + your own seats + current selection
  onToggle: (seatNo: number) => void;            // same handler the 2D squares call
  onHover?: (seatNo: number | null) => void;
  names?: Record<string, string>;                 // seatNo -> holder name (seatmap.holders); shown as a place card and a floating label
  readOnly?: boolean;                             // no picking, just viewing
  className?: string;
};

export default function Hall3D({ cells, statusOf, onToggle, onHover, names, readOnly, className }: Hall3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ status: statusOf, onToggle, onHover: onHover ?? (() => {}) });
  const repaintRef = useRef<() => void>(() => {});
  const namesRef = useRef<(n: Record<string, string>) => void>(() => {});
  // Latest callbacks for the scene's event handlers, refreshed before the
  // repaint below runs (effects run in declaration order).
  useEffect(() => { stateRef.current = { status: statusOf, onToggle, onHover: onHover ?? (() => {}) }; }, [statusOf, onToggle, onHover]);

  // status changed (poll, selection, confirmation) -> repaint rings only, no rebuild
  useEffect(() => { repaintRef.current(); }, [statusOf]);
  useEffect(() => { namesRef.current(names ?? {}); }, [names]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const state = { status: (n: number) => stateRef.current.status(n), onToggle: (n: number) => stateRef.current.onToggle(n), onHover: (n: number | null) => stateRef.current.onHover(n) };
    const SEATS: Seat[] = buildSeats(cells);
    const TABLES = buildTables(SEATS);
    const W = mount.clientWidth, H = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe6dbc4);
    scene.fog = new THREE.Fog(0xe6dbc4, 60, 120);

    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    // ~250 chairs with soft shadows is too much for a phone GPU; phones get flat lighting.
    renderer.shadowMap.enabled = W >= 768;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // ---------- procedural textures ----------
    const canvasTex = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, rep?: [number, number]) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; return t;
    };
    const woodTex = canvasTex(512, 512, (ctx) => {
      for (let i = 0; i < 6; i++) {
        const y = i * 86;
        ctx.fillStyle = `hsl(31, ${38 + Math.random() * 10}%, ${56 + Math.random() * 9}%)`; ctx.fillRect(0, y, 512, 84);
        for (let k = 0; k < 50; k++) {
          ctx.strokeStyle = `rgba(80,48,20,${0.04 + Math.random() * 0.09})`; ctx.lineWidth = 0.6 + Math.random() * 2;
          ctx.beginPath(); const yy = y + Math.random() * 84; ctx.moveTo(0, yy); ctx.bezierCurveTo(170, yy + 5, 340, yy - 5, 512, yy); ctx.stroke();
        }
        ctx.fillStyle = "rgba(50,28,10,.55)"; ctx.fillRect(0, y + 84, 512, 2);
      }
    }, [3, 12]);
    const woodRough = canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = "#777"; ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`; ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 1); }
    }, [3, 12]);
    const drapeTex = canvasTex(256, 64, (ctx) => {
      for (let x = 0; x < 256; x++) {
        const v = 0.5 + 0.5 * Math.sin((x / 256) * Math.PI * 12);
        ctx.fillStyle = `hsl(40, 42%, ${84 + v * 10}%)`; ctx.fillRect(x, 0, 1, 64);
      }
    }, [12, 1]);
    const roofTex = canvasTex(256, 64, (ctx) => {
      for (let x = 0; x < 256; x++) {
        const v = 0.5 + 0.5 * Math.sin((x / 256) * Math.PI * 16);
        ctx.fillStyle = `hsl(42, 38%, ${89 + v * 7}%)`; ctx.fillRect(x, 0, 1, 64);
      }
    }, [1, 16]);
    const clothTex = canvasTex(128, 128, (ctx) => {
      ctx.fillStyle = "#f5efe3"; ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 3500; i++) { ctx.fillStyle = `rgba(190,180,160,${Math.random() * 0.28})`; ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); }
    }, [4, 2]);
    const velvetTex = canvasTex(128, 128, (ctx) => {
      ctx.fillStyle = "#1c2a4e"; ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 3000; i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`; ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); }
    }, [2, 2]);
    const chairTex = canvasTex(128, 128, (ctx) => {
      ctx.fillStyle = "#b39a78"; ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(70,50,30,${Math.random() * 0.14})`; ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); }
    }, [2, 2]);
    const textTex = (txt: string, bg: string, fg: string, w = 256, h = 128, size = 60) => canvasTex(w, h, (ctx) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = fg; ctx.lineWidth = 4; ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = fg; ctx.font = `bold ${size}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, w / 2, h / 2);
    });

    // ---------- materials ----------
    const M = {
      floor: new THREE.MeshStandardMaterial({ map: woodTex, roughnessMap: woodRough, roughness: 0.55, metalness: 0.02 }),
      drape: new THREE.MeshStandardMaterial({ map: drapeTex, roughness: 1, side: THREE.DoubleSide }),
      roof: new THREE.MeshStandardMaterial({ map: roofTex, roughness: 1, side: THREE.DoubleSide }),
      darkWood: new THREE.MeshStandardMaterial({ color: 0x5e3b1f, roughness: 0.45, metalness: 0.05 }),
      oak: new THREE.MeshStandardMaterial({ color: 0x9c6b3d, roughness: 0.5 }),
      cloth: new THREE.MeshStandardMaterial({ map: clothTex, roughness: 1 }),
      velvet: new THREE.MeshStandardMaterial({ map: velvetTex, roughness: 0.95 }),
      chair: new THREE.MeshStandardMaterial({ map: chairTex, roughness: 0.9 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd9b54f, metalness: 0.9, roughness: 0.28 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xd0d4d7, metalness: 0.95, roughness: 0.22 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x8e9195, metalness: 0.85, roughness: 0.35 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xd8e6ee, transparent: true, opacity: 0.28, roughness: 0.04, metalness: 0.05, side: THREE.DoubleSide }),
      pot: new THREE.MeshStandardMaterial({ color: 0xd3cbbb, roughness: 0.8 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x3b6a37, roughness: 1 }),
      lattice: new THREE.MeshStandardMaterial({ color: 0xe6d9bd, roughness: 0.9, transparent: true, opacity: 0.9 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xcfa54a, metalness: 0.95, roughness: 0.22 }),
      walnut: new THREE.MeshStandardMaterial({ color: 0x2a1609, roughness: 0.4, metalness: 0.05 }),
      frosted: new THREE.MeshPhysicalMaterial({ color: 0xf4f1ea, transparent: true, opacity: 0.55, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }),
      stone: new THREE.MeshStandardMaterial({ color: 0xece6db, roughness: 0.18, metalness: 0.05 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xfff1d0 }),
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z);
      m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
    };

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(0xfff5df, 0xa5824f, 1.0));
    const sun = new THREE.DirectionalLight(0xffe4bd, 2.2);
    sun.position.set(-7, 20, 8);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 22, bottom: -22, near: 1, far: 60 });
    scene.add(sun);

    for (let z = ELEMENTS.zFront + 1.5; z < ELEMENTS.zBack; z += 3.6) [-ELEMENTS.wall + 0.35, ELEMENTS.wall - 0.35].forEach((x) => {
      const l = new THREE.PointLight(0xffc27a, 5, 6, 2); l.position.set(x > 0 ? x - 0.25 : x, 2.9, z); scene.add(l);
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffe3b0 })); g.position.copy(l.position); scene.add(g);
    });

    // ---------- shell: floor, draped walls (no roof) ----------
    const hallW = ELEMENTS.wall * 2, hallL = ELEMENTS.zBack - ELEMENTS.zFront, zMid = (ELEMENTS.zBack + ELEMENTS.zFront) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(hallW, hallL), M.floor);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, zMid); floor.receiveShadow = true; scene.add(floor);
    const wallH = 5.2, WX = ELEMENTS.wall;
    const wall = (w: number, pos: [number, number, number], ry: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), M.drape); m.position.set(pos[0], pos[1], pos[2]); m.rotation.y = ry; scene.add(m); };
    wall(hallL, [-WX, wallH / 2, zMid], Math.PI / 2); wall(hallL, [WX, wallH / 2, zMid], -Math.PI / 2);
    wall(hallW, [0, wallH / 2, ELEMENTS.zFront], 0); wall(hallW, [0, wallH / 2, ELEMENTS.zBack], Math.PI);
    const wallTop = new THREE.MeshStandardMaterial({ color: 0xd6d0c4, metalness: 0.5, roughness: 0.5 });
    [-1, 1].forEach((sg) => box(0.14, 0.14, hallL, wallTop, sg * WX, wallH, zMid, false));
    box(hallW, 0.14, 0.14, wallTop, 0, wallH, ELEMENTS.zFront, false); box(hallW, 0.14, 0.14, wallTop, 0, wallH, ELEMENTS.zBack, false);
    for (let z = ELEMENTS.zFront; z <= ELEMENTS.zBack + 0.01; z += 4) [-1, 1].forEach((sg) => box(0.12, wallH, 0.12, wallTop, sg * (WX - 0.07), wallH / 2, z, false));
    // slim tent trusses with ring chandeliers
    const trussMat = new THREE.MeshStandardMaterial({ color: 0xe9e4da, metalness: 0.4, roughness: 0.5 });
    for (let z = ELEMENTS.zFront + 3; z < ELEMENTS.zBack; z += 4.2) {
      box(hallW, 0.1, 0.1, trussMat, 0, wallH + 0.05, z, false);
      [C_CX - 3.2, C_CX + 3.2].forEach((x) => {
        box(0.02, 1.2, 0.02, M.brass, x, wallH - 0.6, z, false);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 12, 48), M.brass); ring.rotation.x = Math.PI / 2; ring.position.set(x, wallH - 1.2, z); scene.add(ring);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.015, 8, 48), M.glow); halo.rotation.x = Math.PI / 2; halo.position.set(x, wallH - 1.23, z); scene.add(halo);
        const pl = new THREE.PointLight(0xffe6c2, 40, 12, 2); pl.position.set(x, wallH - 1.4, z); scene.add(pl);
      });
    }
    // 1 m grid on the floor, as on the plan
    const gridMat = new THREE.LineBasicMaterial({ color: 0x8b6a45, transparent: true, opacity: 0.18 });
    for (let x = -6; x <= 6; x += 1) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.004, ELEMENTS.zFront), new THREE.Vector3(x, 0.004, ELEMENTS.zBack)]), gridMat));
    for (let z = 0; z <= 24; z += 1) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6, 0.004, Z0 + z), new THREE.Vector3(6, 0.004, Z0 + z)]), gridMat));

    // ---------- front wall: ark on the floor, two 425 x 40 libraries, two amudim ----------
    const A = ELEMENTS.ark;
    box(A.w + 1.0, 0.06, A.d + 0.9, M.stone, A.x, 0.03, A.z + 0.3);                                     // stone plinth, flush with the floor
    box(A.w, 2.9, A.d, M.walnut, A.x, 1.45, A.z);
    [-1, 1].forEach((sg) => { box(0.18, 3.0, A.d + 0.16, M.walnut, A.x + sg * (A.w / 2 + 0.09), 1.5, A.z); box(0.06, 2.6, 0.06, M.brass, A.x + sg * (A.w / 2 + 0.09), 1.4, A.z + A.d / 2 + 0.06); });
    box(A.w + 0.6, 0.22, A.d + 0.3, M.walnut, A.x, 3.11, A.z);
    const archTrim = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.03, 8, 40, Math.PI), M.brass); archTrim.position.set(A.x, 3.22, A.z + A.d / 2 + 0.16); scene.add(archTrim);
    const archFill = new THREE.Mesh(new THREE.CircleGeometry(0.68, 40, 0, Math.PI), M.walnut); archFill.position.set(A.x, 3.22, A.z + A.d / 2 + 0.15); scene.add(archFill);
    const parochet = new THREE.Mesh(new THREE.PlaneGeometry(A.w - 0.2, 2.5), M.velvet); parochet.position.set(A.x, 1.4, A.z + A.d / 2 + 0.01); scene.add(parochet);
    box(A.w - 0.2, 0.05, 0.05, M.brass, A.x, 2.68, A.z + A.d / 2 + 0.03, false);                            // parochet rod
    [-0.2, 0.2].forEach((dx) => { const t = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24, 0, Math.PI), M.brass); t.position.set(A.x + dx, 2.3, A.z + A.d / 2 + 0.03); scene.add(t); box(0.32, 0.3, 0.02, M.brass, A.x + dx, 2.15, A.z + A.d / 2 + 0.03, false); });   // tablets
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 10, 28), M.brass); crown.position.set(A.x, 2.72, A.z + A.d / 2 + 0.05); scene.add(crown);
    const nerTamid = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), M.glow); nerTamid.position.set(A.x, 2.55, A.z + A.d / 2 + 0.55); scene.add(nerTamid);
    box(0.012, 2.5, 0.012, M.brass, A.x, 3.85, A.z + A.d / 2 + 0.55, false);
    const nerLight = new THREE.PointLight(0xffd9a0, 6, 5, 2); nerLight.position.copy(nerTamid.position); scene.add(nerLight);
    const arkSign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.24), new THREE.MeshStandardMaterial({ map: textTex("ארון קודש", "#2a1a0c", "#e0c27a", 320, 80, 48) })); arkSign.position.set(A.x, 2.9, A.z + A.d / 2 + 0.17); scene.add(arkSign);
    ELEMENTS.amudim.forEach((P) => { box(0.5, 1.1, 0.5, M.walnut, P.x, 0.55, P.z); box(0.54, 0.03, 0.54, M.brass, P.x, 1.115, P.z, false); });
    // wall wash uplights along the front wall
    for (let x = -5; x <= 5; x += 2.5) { const u = new THREE.PointLight(0xffe2b8, 4, 6, 2); u.position.set(x, 0.3, ELEMENTS.zFront + 0.25); scene.add(u); }
    const brownBooks = [0x3a2210, 0x4a2e16, 0x56361c, 0x2e1a0c, 0x62401f, 0x452a12].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }));
    ELEMENTS.wallLibrary.forEach((L) => {
      const zc = (L.z1 + L.z2) / 2, len = L.z2 - L.z1;
      box(0.03, 2.4, len, M.walnut, WX - 0.015, 1.2, zc);                       // back panel
      box(0.3, 0.04, len, M.walnut, WX - 0.15, 2.4, zc); box(0.3, 0.01, len, M.glow, WX - 0.15, 2.375, zc, false); box(0.02, 0.06, len, M.brass, WX - 0.31, 2.4, zc, false);   // top with LED strip and brass edge
      for (let z = L.z1; z <= L.z2 + 0.01; z += (len / Math.round(len / 0.9))) box(0.3, 2.4, 0.03, M.walnut, WX - 0.15, 1.2, z);   // uprights
      for (let y = 0.12; y < 2.3; y += 0.45) { box(0.3, 0.03, len, M.walnut, WX - 0.15, y, zc, false); box(0.02, 0.03, len, M.brass, WX - 0.3, y, zc, false); }                           // shelves
      for (let y = 0.12; y < 2.3; y += 0.45) for (let z = L.z1 + 0.06; z < L.z2 - 0.06; z += 0.075) {
        const h = 0.24 + Math.random() * 0.14;
        const bk = new THREE.Mesh(new THREE.BoxGeometry(0.2 + Math.random() * 0.04, h, 0.055), brownBooks[Math.floor(Math.random() * 6)]); bk.position.set(WX - 0.15, y + 0.02 + h / 2, z); scene.add(bk);
      }
    });


    // ---------- Torah reading table, on the floor, centred in the 270 aisle ----------
    const B = ELEMENTS.bimah;
    box(B.w - 0.7, 0.9, B.d - 0.6, M.walnut, B.x, 0.45, B.z);
    box(B.w - 0.6, 0.03, B.d - 0.5, M.brass, B.x, 0.9, B.z, false);
    box(B.w - 0.5, 0.16, B.d - 0.45, M.velvet, B.x, 0.99, B.z);
    box(0.5, 0.06, 0.35, M.brass, B.x, 1.1, B.z - 0.25, false);
    box(B.w - 0.8, 0.01, B.d - 0.7, M.glow, B.x, 0.02, B.z, false);   // underglow
    const bimahSign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.24), new THREE.MeshStandardMaterial({ map: textTex("בימת ספר תורה", "#1c2a4e", "#e0c27a", 320, 76, 40) })); bimahSign.position.set(B.x, 0.6, B.z + (B.d - 0.6) / 2 + 0.01); scene.add(bimahSign);

    // ---------- mechitza, full width ----------
    const MZ = ELEMENTS.mechitza;
    box(hallW, 0.75, 0.08, M.walnut, 0, 0.375, MZ.z);
    box(hallW, 0.02, 0.1, M.brass, 0, 0.76, MZ.z, false);
    const glassPanel = new THREE.Mesh(new THREE.PlaneGeometry(hallW, 1.05), M.frosted); glassPanel.position.set(0, 1.3, MZ.z); scene.add(glassPanel);
    box(hallW, 0.04, 0.06, M.brass, 0, 1.84, MZ.z, false);
    for (let x = -6; x <= 6.01; x += 1.2) box(0.05, 1.86, 0.05, M.brass, x, 0.93, MZ.z, false);
    const mechSignMat = new THREE.MeshStandardMaterial({ map: textTex("עזרת נשים", "#3b2a1a", "#e0c27a", 320, 70, 44) });
    [L_CX, C_CX, R_CX].forEach((x) => [0, Math.PI].forEach((ry) => { const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.26), mechSignMat); sg.position.set(x, 2.05, MZ.z + (ry ? -0.07 : 0.07)); sg.rotation.y = ry; scene.add(sg); }));

    // ---------- doors ----------
    const doorOn = (wallSide: "r" | "l" | "b", c1: number, c2: number, label: string | null, exitOnly = false) => {
      const w = c2 - c1, c = (c1 + c2) / 2, leaves = w > 1.3 ? 2 : 1, lw = w / leaves;
      const g = new THREE.Group();
      for (let i = 0; i < leaves; i++) {
        const off = (i - (leaves - 1) / 2) * lw;
        const fr = new THREE.Mesh(new THREE.BoxGeometry(lw, 2.4, 0.06), M.frame); fr.position.set(off, 1.2, 0); g.add(fr);
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.14, 2.26), M.glass); pane.position.set(off, 1.2, 0.04); g.add(pane);
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), M.frame); h.position.set(off + (leaves === 2 ? (i ? -1 : 1) * (lw / 2 - 0.12) : lw / 2 - 0.12), 1.05, 0.08); g.add(h);
      }
      const light = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.1, 2.5), new THREE.MeshBasicMaterial({ color: 0xfff7e6 })); light.position.set(0, 1.25, -0.05); g.add(light);
      const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.28), new THREE.MeshStandardMaterial({ map: textTex(exitOnly ? "יציאת חירום" : "יציאה", "#1f8f4a", "#ffffff", 300, 88, exitOnly ? 40 : 52), emissive: 0x1f8f4a, emissiveIntensity: 0.8 })); exit.position.set(0, 2.8, 0.07); g.add(exit);
      if (label) { const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.34), new THREE.MeshStandardMaterial({ map: textTex(label, "#1b1b1b", "#d9c48a", 340, 88, 44) })); sign.position.set(0, 3.25, 0.07); g.add(sign); }
      if (wallSide === "r") { g.position.set(WX - 0.02, 0, c); g.rotation.y = -Math.PI / 2; }
      else if (wallSide === "l") { g.position.set(-WX + 0.02, 0, c); g.rotation.y = Math.PI / 2; }
      else { g.position.set(c, 0, ELEMENTS.zBack - 0.02); g.rotation.y = Math.PI; }
      scene.add(g);
    };
    doorOn("r", ELEMENTS.menDoor.z1, ELEMENTS.menDoor.z2, "כניסת גברים");
    doorOn("r", ELEMENTS.womenDoor.z1, ELEMENTS.womenDoor.z2, "כניסת נשים");

    // ---------- entrance wall: siddurim sign on the bookcase next to the door, washing & coffee corner 180 x 174 ----------
    {
      const S = ELEMENTS.siddurim, zc = (S.z1 + S.z2) / 2;
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.26), new THREE.MeshStandardMaterial({ map: textTex("סידורים", "#4a2e16", "#e0c27a", 260, 70, 44) })); sg.position.set(WX - 0.32, 2.62, zc); sg.rotation.y = -Math.PI / 2; scene.add(sg);
    }
    {
      const Wc = ELEMENTS.wash, zc = (Wc.z1 + Wc.z2) / 2, xw = WX - 0.3;
      const runner = new THREE.Mesh(new THREE.PlaneGeometry(Wc.x2 - Wc.x1, Wc.z2 - Wc.z1), new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 1 })); runner.rotation.x = -Math.PI / 2; runner.position.set((Wc.x1 + Wc.x2) / 2, 0.006, zc); scene.add(runner);   // drainage mat
      box(0.03, 2.3, Wc.z2 - Wc.z1, M.stone, WX - 0.015, 1.15, zc);                                        // stone backsplash panel
      box(0.6, 0.85, Wc.z2 - Wc.z1 - 0.1, M.walnut, xw, 0.425, zc);                                         // continuous walnut counter along the wall
      box(0.64, 0.04, Wc.z2 - Wc.z1 - 0.06, M.stone, xw, 0.87, zc);
      box(0.6, 0.01, Wc.z2 - Wc.z1 - 0.1, M.glow, xw, 0.86, zc, false);                                      // LED under the counter lip
      // washing side (toward the men's door)
      const sz = Wc.z1 + 0.45;
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.13, 24, 1, true), M.stone); basin.position.set(xw, 0.85, sz); scene.add(basin);
      const tap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 8, 20, Math.PI), M.brass); tap.position.set(xw + 0.22, 1.0, sz); scene.add(tap);
      [-0.32, 0.32].forEach((dz) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.15, 14), M.brass); cup.position.set(xw - 0.15, 0.975, sz + dz); scene.add(cup); });
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0xd7e3ea, metalness: 0.3, roughness: 0.1 })); mirror.position.set(WX - 0.035, 1.6, sz); mirror.rotation.y = -Math.PI / 2; scene.add(mirror);
      box(0.72, 0.02, 0.02, M.brass, WX - 0.04, 2.06, sz, false);
      box(0.1, 0.3, 0.24, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 1 }), WX - 0.08, 1.2, sz + 0.62, false);
      // drink side (toward the mechitza): urn, water dispenser, glass shelf with cups
      const dz0 = Wc.z2 - 0.5;
      const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.42, 20), M.steel); urn.position.set(xw, 1.11, dz0 + 0.25); scene.add(urn);
      const urnTop = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.steel); urnTop.position.set(xw, 1.32, dz0 + 0.25); scene.add(urnTop);
      const disp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 20), M.glass); disp.position.set(xw, 1.15, dz0 - 0.3); scene.add(disp);
      box(0.2, 0.06, 0.2, M.brass, xw, 0.92, dz0 - 0.3, false);
      box(0.28, 0.02, 1.1, M.glass, WX - 0.16, 1.55, dz0, false);                                             // glass shelf
      box(0.28, 0.02, 1.1, M.glass, WX - 0.16, 1.95, dz0, false);
      for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), M.glass); c.position.set(WX - 0.16, 1.61 + (i > 6 ? 0.4 : 0), dz0 - 0.5 + (i % 7) * 0.16); scene.add(c); }
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.3), new THREE.MeshStandardMaterial({ map: textTex("נטילת ידיים וקפה", "#2a1a0c", "#e0c27a", 400, 88, 44) })); sg.position.set(WX - 0.05, 2.5, zc); sg.rotation.y = -Math.PI / 2; scene.add(sg);
    }
    const acMat = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.5 });
    ELEMENTS.acGaps.forEach((z) => box(0.28, 1.8, 0.4, acMat, -(WX - 0.15), 0.9, z));
    for (const [x, z] of [[-WX + 0.5, ELEMENTS.zFront + 0.5], [-WX + 0.5, ELEMENTS.zBack - 0.5], [-WX + 0.45, ELEMENTS.mechitza.z + 0.4], [-2.2, ELEMENTS.zFront + 0.5], [2.2, ELEMENTS.zFront + 0.5]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 12), M.pot); pot.position.set(x, 0.25, z); scene.add(pot);
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), M.leaf); lf.position.set(x, 1.0, z); lf.scale.y = 2.2; lf.castShadow = true; scene.add(lf);
    }

    // ---------- tables (2 x 180 x 74 on the sides, 240 x 74 centre) + chairs 49 x 42 ----------
    TABLES.forEach((t) => {
      box(t.w, 0.74, 0.74, M.cloth, t.x, 0.37, t.z);
      box(t.w + 0.04, 0.02, 0.78, M.cloth, t.x, 0.75, t.z, false);
      if (t.split) box(0.01, 0.03, 0.74, new THREE.MeshStandardMaterial({ color: 0xd9d0c0 }), t.x, 0.77, t.z, false);
      box(t.w + 0.2, 0.012, 0.3, M.velvet, t.x, 0.766, t.z, false);   // runner
    });
    SEATS.forEach((s) => { const bk = box(0.13, 0.03, 0.19, M.velvet, s.x, 0.775, tableZ(s.r0) + (s.facing === "a" ? 0.2 : -0.2)); bk.rotation.y = (Math.random() - 0.5) * 0.15; });
    const seatGeo = new THREE.BoxGeometry(0.42, 0.06, 0.45);
    const backGeo = new THREE.BoxGeometry(0.4, 0.36, 0.05);
    const legGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6);
    const ringGeo = new THREE.RingGeometry(0.26, 0.32, 32);
    const mineMat = new THREE.MeshBasicMaterial({ color: 0xd9b54f, transparent: true, opacity: 0.95, side: THREE.DoubleSide });   // gold: my seats (matches "המקום שלך מסומן בזהב")
    const selMat = new THREE.MeshBasicMaterial({ color: 0x3aa06b, transparent: true, opacity: 0.95, side: THREE.DoubleSide });    // green: chosen now, not yet confirmed
    const takenMat = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.55, side: THREE.DoubleSide });  // grey: taken by someone else
    const reservedMat = new THREE.MeshBasicMaterial({ color: 0x2f5fa8, transparent: true, opacity: 0.8, side: THREE.DoubleSide }); // blue: chazaka hold, same as the 2D legend
    const freeMat = mineMat; const ringMat = mineMat;
    const hoverMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const chairs = new Map<number, THREE.Group>(); const pickables: THREE.Object3D[] = [];
    SEATS.forEach((s) => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(seatGeo, M.chair); seat.position.y = 0.44; seat.castShadow = true; g.add(seat);
      const back = new THREE.Mesh(backGeo, M.chair); back.position.set(0, 0.72, -0.2); back.castShadow = true; g.add(back);
      [-0.17, 0.17].forEach((x) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.46, 6), M.gold); p.position.set(x, 0.67, -0.21); g.add(p); });
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), M.gold); rail.rotation.z = Math.PI / 2; rail.position.set(0, 0.905, -0.21); g.add(rail);
      [[-0.17, -0.2], [0.17, -0.2], [-0.17, 0.2], [0.17, 0.2]].forEach(([x, dz]) => { const l = new THREE.Mesh(legGeo, M.gold); l.position.set(x, 0.21, dz); g.add(l); });
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; ring.visible = false; g.add(ring);
      const hring = new THREE.Mesh(ringGeo, hoverMat); hring.rotation.x = -Math.PI / 2; hring.position.y = 0.011; hring.visible = false; g.add(hring);
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.facing === "a" ? Math.PI : 0;
      g.userData = { num: s.num, ring, hring };
      seat.userData.num = s.num; back.userData.num = s.num;
      scene.add(g); chairs.set(s.num, g); pickables.push(seat, back);
    });


    // ---------- holder names: a place card on the table + a floating label above the chair ----------
    const labelTex = (txt: string) => {
      const c = document.createElement("canvas"); c.width = 512; c.height = 128; const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = "rgba(255,252,245,0.92)"; ctx.beginPath(); ctx.roundRect(4, 4, 504, 120, 28); ctx.fill();
      ctx.strokeStyle = "#c9a54a"; ctx.lineWidth = 6; ctx.stroke();
      // The site font (Heebo via next/font) — its generated family name is only known at runtime.
      ctx.fillStyle = "#2a1a0c"; ctx.font = `bold 62px ${getComputedStyle(document.body).fontFamily || "sans-serif"}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = "rtl";
      let t = txt; while (ctx.measureText(t).width > 470 && t.length > 2) t = t.slice(0, -2) + "…";
      ctx.fillText(t, 256, 66);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return tex;
    };
    const cardGeo = new THREE.PlaneGeometry(0.34, 0.085);
    const labels = new Map<number, { card: THREE.Mesh; sprite: THREE.Sprite; text: string }>();
    const setNames = (nm: Record<string, string>) => {
      SEATS.forEach((st) => {
        const text = nm[String(st.num)];
        const cur = labels.get(st.num);
        if (!text) { if (cur) { scene.remove(cur.card); scene.remove(cur.sprite); labels.delete(st.num); } return; }
        if (cur && cur.text === text) return;
        if (cur) { scene.remove(cur.card); scene.remove(cur.sprite); }
        const tex = labelTex(text);
        const card = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, side: THREE.DoubleSide }));
        const tz = tableZ(st.r0), edge = st.facing === "a" ? 0.30 : -0.30;   // standing card at the table edge in front of the chair
        card.position.set(st.x, 0.80, tz + edge); card.rotation.y = st.facing === "a" ? 0 : Math.PI; card.rotation.x = -0.25 * (st.facing === "a" ? 1 : 1);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        sprite.scale.set(0.72, 0.18, 1); sprite.position.set(st.x, 1.18, st.z); sprite.renderOrder = 10;
        scene.add(card); scene.add(sprite);
        labels.set(st.num, { card, sprite, text });
      });
    };
    namesRef.current = setNames; setNames(names ?? {});

    // ---------- camera ----------
    const target = new THREE.Vector3(0, 0.6, 0);
    let theta = 0.25, phi = 0.85, radius = 22;
    const updateCam = () => {
      camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target);
    };
    updateCam();
    let dragging = false, panning = false, moved = 0, lx = 0, ly = 0, pinch = 0;
    const el = renderer.domElement;
    el.tabIndex = 0; el.style.outline = "none";
    const clampTarget = () => { target.x = Math.min(ELEMENTS.wall, Math.max(-ELEMENTS.wall, target.x)); target.z = Math.min(ELEMENTS.zBack, Math.max(ELEMENTS.zFront, target.z)); };
    const pan = (dx: number, dz: number) => {
      // move along the camera's ground-plane axes so arrows feel natural from any angle
      const f = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)), r = new THREE.Vector3(f.z, 0, -f.x);
      target.addScaledVector(r, dx).addScaledVector(f, dz); clampTarget(); updateCam();
    };
    const down = (x: number, y: number, isPan: boolean) => { dragging = true; panning = isPan; moved = 0; lx = x; ly = y; el.focus(); };
    const move = (x: number, y: number) => {
      if (!dragging) return;
      const dx = x - lx, dy = y - ly; lx = x; ly = y; moved += Math.abs(dx) + Math.abs(dy);
      if (panning) { pan(-dx * radius * 0.0015, -dy * radius * 0.0015); return; }
      theta -= dx * 0.006; phi = Math.min(1.5, Math.max(0.15, phi - dy * 0.006)); updateCam();
    };
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("mousedown", (e) => down(e.clientX, e.clientY, e.button !== 0 || e.shiftKey));
    const onWinMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onWinUp = () => (dragging = false);
    window.addEventListener("mousemove", onWinMove);
    window.addEventListener("mouseup", onWinUp);
    el.addEventListener("wheel", (e) => { e.preventDefault(); radius = Math.min(55, Math.max(3, radius + e.deltaY * 0.03)); updateCam(); }, { passive: false });
    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent, on: boolean) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "q", "e", "+", "-", "="].includes(k)) { e.preventDefault(); if (on) keys.add(k); else keys.delete(k); }
    };
    const onKeyDown = (e: KeyboardEvent) => onKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    const stepKeys = () => {
      if (!keys.size) return;
      const st = 0.012 * radius;
      if (keys.has("arrowup") || keys.has("w")) pan(0, -st);
      if (keys.has("arrowdown") || keys.has("s")) pan(0, st);
      if (keys.has("arrowleft") || keys.has("a")) pan(-st, 0);
      if (keys.has("arrowright") || keys.has("d")) pan(st, 0);
      if (keys.has("q")) { theta += 0.02; updateCam(); }
      if (keys.has("e")) { theta -= 0.02; updateCam(); }
      if (keys.has("+") || keys.has("=")) { radius = Math.max(3, radius * 0.97); updateCam(); }
      if (keys.has("-")) { radius = Math.min(55, radius * 1.03); updateCam(); }
    };
    el.addEventListener("touchstart", (e) => { if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY, false); else if (e.touches.length === 2) { pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); lx = (e.touches[0].clientX + e.touches[1].clientX) / 2; ly = (e.touches[0].clientY + e.touches[1].clientY) / 2; } }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
      else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        radius = Math.min(55, Math.max(3, radius * (pinch / d))); pinch = d;
        pan(-(cx - lx) * radius * 0.0015, -(cy - ly) * radius * 0.0015); lx = cx; ly = cy; updateCam();
      }
    }, { passive: true });
    el.addEventListener("touchend", () => (dragging = false));

    // ---------- picking ----------
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      return hit ? (hit.object.userData.num as number) : null;
    };
    const paint = (num: number) => {
      const g = chairs.get(num); if (!g) return;
      const st = state.status(num);
      g.userData.ring.material = st === "mine" ? mineMat : st === "selected" ? selMat : st === "reserved" ? reservedMat : st === "taken" ? takenMat : freeMat;
      g.userData.ring.visible = st !== "free";
      g.userData.hring.visible = false;
    };
    const repaintAll = () => chairs.forEach((_, n) => paint(n));
    const toggle = (num: number) => { state.onToggle(num); };
    if (!readOnly) el.addEventListener("click", (e) => { if (moved < 6) { const n = pick(e.clientX, e.clientY); if (n) toggle(n); } });
    let lastHover: number | null = null;
    el.addEventListener("mousemove", (e) => {
      const n = pick(e.clientX, e.clientY);
      if (n !== lastHover) { if (lastHover) paint(lastHover); const hg = n ? chairs.get(n) : undefined; if (hg) hg.userData.hring.visible = true; lastHover = n; state.onHover(n); el.style.cursor = n ? "pointer" : "grab"; }
    });

    repaintRef.current = repaintAll; repaintAll();
    const onResize = () => { const w = mount.clientWidth, h = mount.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    window.addEventListener("resize", onResize);
    let raf = 0; const loop = () => { stepKeys(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); }; loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onWinMove);
      window.removeEventListener("mouseup", onWinUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.dispose();
      mount.removeChild(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  return <div ref={mountRef} className={className ?? "w-full h-[70vh] rounded-xl overflow-hidden"} style={{ cursor: "grab" }} dir="ltr" />;
}
