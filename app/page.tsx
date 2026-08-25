"use client";

/**
 * The public flow, as a rolling steps wizard modeled on the original paper
 * registration form: identify → details & aliyot → takanon + dues → pick a
 * seat → done. Each step is one screen on a phone; the map only appears after
 * the declarations, which is what the gabbai's manual flow always enforced.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaimResponse,
  CompiledLayout,
  LookupResult,
  RegistrationData,
  SeatMapPayload,
} from "@/lib/domain";
import { normalizePhone, totalPrice } from "@/lib/domain";
import { SeatMap, Legend, type SeatSelection } from "@/components/SeatMap";

const POLL_MS = 4_000;
type Step = 0 | 1 | 2 | 3 | 4;
const STEP_TITLES = ["זיהוי", "פרטים ועליות", "תקנון ותשלום", "בחירת מקום", "סיום"];

export default function WizardPage() {
  const [step, setStep] = useState<Step>(0);

  // Identity
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [reservedSeats, setReservedSeats] = useState<number[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");
  const [multi, setMulti] = useState<Array<{ memberId: string; name: string }>>([]);

  // Registration details
  const [email, setEmail] = useState("");
  const [aliyah1, setAliyah1] = useState("");
  const [aliyah2, setAliyah2] = useState("");
  const [notes, setNotes] = useState("");
  const [takanonApproved, setTakanonApproved] = useState(false);
  const [duesDeclared, setDuesDeclared] = useState(false);

  // Map + claim
  const [layout, setLayout] = useState<CompiledLayout | null>(null);
  const [map, setMap] = useState<SeatMapPayload | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimedSeats, setClaimedSeats] = useState<number[]>([]);
  const layoutVersionRef = useRef("");
  const requestIdRef = useRef("");

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
      if (m.layoutVersion && m.layoutVersion !== layoutVersionRef.current) await fetchLayout();
    } catch { /* next tick retries */ }
  }, [fetchLayout]);

  useEffect(() => {
    fetchLayout();
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [fetchLayout, poll]);

  const mode = map?.mode ?? "CLOSED";
  const phase = map?.phase ?? "A";

  /* ---------- step 0: identify ---------- */
  const doLookup = async () => {
    const p = normalizePhone(phone);
    if (!p) { setLookupMsg("מספר טלפון לא תקין"); return; }
    setLookupBusy(true);
    setLookupMsg("");
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p }),
      });
      const data = await res.json();
      const r: LookupResult = data.result ?? { kind: "UNKNOWN" };
      if (r.kind === "MULTI") { setMulti(r.candidates); return; }
      if (r.kind === "CHAZAKA" || r.kind === "MEMBER_NO_CHAZAKA") {
        setName(r.name);
        setReservedSeats(r.reservedSeats ?? []);
        setStep(1);
        return;
      }
      // UNKNOWN
      if (phase === "A") {
        setLookupMsg("המספר לא נמצא ברשימת בעלי החזקה. אם היה לך מקום בשנה שעברה — פנה לגבאי בוואטסאפ ונפתור מיד.");
      } else {
        // Round B welcomes everyone; they just type their name at the next step.
        setName("");
        setReservedSeats([]);
        setStep(1);
      }
    } catch {
      setLookupMsg("שגיאת תקשורת, נסה שוב");
    } finally {
      setLookupBusy(false);
    }
  };

  /* ---------- step 3: seat selection ---------- */
  const toggleSeat = (sel: SeatSelection) => {
    setNotice("");
    setSelected((cur) => {
      if (cur.includes(sel.seatNo)) {
        return cur.filter((n) => n !== sel.seatNo && n !== sel.pairSeatNo);
      }
      let next = [...cur, sel.seatNo];
      if (sel.facing === "ark" && sel.pairSeatNo) {
        const pairCode = map?.status[String(sel.pairSeatNo)] ?? "0";
        const pairIsMine = reservedSeats.includes(sel.pairSeatNo);
        if ((pairCode === "0" || pairIsMine) && !next.includes(sel.pairSeatNo)) {
          next = [...next, sel.pairSeatNo];
          setNotice(`מקום הפונה לארון נבחר יחד עם המקום שמולו — צורף גם מקום ${sel.pairSeatNo}.`);
        }
      }
      if (next.length > 3) {
        setNotice("עד 3 מקומות לרכישה אחת.");
        return cur;
      }
      return next;
    });
    if (!requestIdRef.current) requestIdRef.current = `c-${crypto.randomUUID()}`;
  };

  const price = totalPrice(selected.length);

  const submitClaim = async () => {
    setClaimBusy(true);
    setNotice("");
    try {
      const registration: RegistrationData = {
        aliyah1, aliyah2, takanonApproved, duesDeclared, notes,
      };
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: requestIdRef.current,
          seatNos: selected,
          name: name.trim(),
          phone: normalizePhone(phone),
          email: email.trim(),
          registration,
        }),
      });
      const data: ClaimResponse = await res.json();
      if (data.ok) {
        setClaimedSeats(data.seatNos);
        setStep(4);
        poll();
        return;
      }
      switch (data.code) {
        case "TAKEN":
          setNotice("המקום נתפס זה עתה. בחר מקום אחר.");
          setSelected([]);
          requestIdRef.current = `c-${crypto.randomUUID()}`;
          poll();
          break;
        case "RESERVED_FOR_OTHER":
          setNotice(`המקום שמור לבעל חזקה (${data.holder ?? ""}). בחר מקום אחר.`);
          setSelected([]);
          requestIdRef.current = `c-${crypto.randomUUID()}`;
          break;
        case "PAIR_REQUIRED":
          setNotice(`מקום הפונה לארון נמכר יחד עם מקום ${data.pairSeatNo}. סמן גם אותו.`);
          break;
        case "CAP_REACHED":
          setNotice(`תקרה: עד ${data.cap} מקומות לטלפון.`);
          break;
        case "ROUND_A_NOT_YOURS":
          setNotice("בסבב הנוכחי בוחרים רק בעלי חזקה.");
          break;
        case "SALE_CLOSED":
          setNotice("המכירה סגורה כרגע.");
          break;
        case "BUSY":
        case "TOO_FAST":
          setNotice("המערכת עמוסה, נסה שוב בעוד רגע.");
          break;
        default:
          setNotice("שגיאה זמנית. נסה שוב.");
      }
    } catch {
      setNotice("שגיאת תקשורת. נסה שוב.");
    } finally {
      setClaimBusy(false);
    }
  };

  const waHref = map?.gabbaiPhone
    ? `https://wa.me/${map.gabbaiPhone}?text=${encodeURIComponent(
        `שלום, לא הצלחתי להיכנס לבחירת מקומות. הטלפון שלי: ${normalizePhone(phone) || phone}`,
      )}`
    : undefined;

  /* ---------- shared chrome ---------- */
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3 p-3">
      <header className="text-center">
        <h1 className="text-lg font-bold">בחירת מקומות תשפ&quot;ז</h1>
        <p className="text-xs opacity-70">בית הכנסת חב&quot;ד &quot;בית מנחם&quot; — גני איילון</p>
      </header>

      {/* progress */}
      <ol className="flex items-center justify-center gap-1 text-[10px]">
        {STEP_TITLES.map((t, i) => (
          <li key={t} className="flex items-center gap-1">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${
                i < step ? "bg-seat-free text-white" : i === step ? "bg-ark text-white" : "bg-gray-200"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={i === step ? "font-bold" : "opacity-50"}>{t}</span>
            {i < STEP_TITLES.length - 1 && <span className="opacity-30">—</span>}
          </li>
        ))}
      </ol>

      {mode !== "OPEN" && step < 4 && (
        <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          {mode === "READONLY" ? "המכירה מוקפאת זמנית." : "המכירה עדיין לא נפתחה — ניתן לצפות במפה בלבד."}
          {layout && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs underline">הצג את מפת האולם</summary>
              <div className="mt-2">
                <SeatMap layout={layout} map={map} selected={[]} onToggleSeat={() => {}} />
              </div>
            </details>
          )}
        </div>
      )}

      {/* ---------- step 0 ---------- */}
      {step === 0 && mode === "OPEN" && (
        <section className="flex flex-col gap-3 rounded-lg border bg-white p-4">
          <h2 className="font-bold">שלום! נתחיל בזיהוי</h2>
          <p className="text-sm opacity-70">
            {phase === "A"
              ? "סבב ראשון — בעלי מקום משנה שעברה. הכנס טלפון ונאתר את המקום השמור לך."
              : "הכנס מספר טלפון להתחלה."}
          </p>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="טלפון נייד"
            className="rounded border p-3 text-lg"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
          />
          <button
            onClick={doLookup}
            disabled={lookupBusy}
            className="rounded-lg bg-ark p-3 font-bold text-white disabled:opacity-50"
          >
            {lookupBusy ? "בודק…" : "המשך"}
          </button>
          {multi.length > 0 && (
            <div className="rounded border p-2 text-sm">
              <p className="mb-1">המספר משותף לכמה מתפללים — מי מכם?</p>
              {multi.map((c) => (
                <button
                  key={c.memberId}
                  onClick={() => { setName(c.name); setMulti([]); setStep(1); }}
                  className="m-1 rounded border px-3 py-1"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {lookupMsg && (
            <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">
              {lookupMsg}
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer"
                  className="mt-2 block w-max rounded bg-green-600 px-4 py-2 font-bold text-white">
                  וואטסאפ לגבאי
                </a>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---------- step 1 ---------- */}
      {step === 1 && (
        <section className="flex flex-col gap-3 rounded-lg border bg-white p-4">
          <h2 className="font-bold">{name ? `שלום ${name}!` : "פרטים אישיים"}</h2>
          {reservedSeats.length > 0 && (
            <div className="rounded border border-sky-400 bg-sky-50 p-2 text-sm">
              🪑 המקום שלך משנה שעברה — <b className="tnum">{reservedSeats.join(", ")}</b> — שמור לך
              {map?.reservedUntil ? ` עד ${map.reservedUntil}` : " לזמן מוגבל"}.
            </div>
          )}
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="שם מלא (יוצג על המפה)" className="rounded border p-3" autoComplete="name" />
          <input value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="אימייל לאישור (רשות)" className="rounded border p-3" inputMode="email" dir="ltr" />
          <div className="rounded border p-2 text-sm">
            <p className="mb-2">
              כל חבר משלם זכאי ל<b>שתי עליות לתורה</b> בשנה (יום הולדת / יארצייט / אחר).
              בחר שני תאריכים עכשיו — ללא רישום מראש לא תינתן עלייה ברגע האחרון:
            </p>
            <input value={aliyah1} onChange={(e) => setAliyah1(e.target.value)}
              placeholder="תאריך עברי 1 — למשל: כא סיוון" className="mb-2 w-full rounded border p-2" />
            <input value={aliyah2} onChange={(e) => setAliyah2(e.target.value)}
              placeholder="תאריך עברי 2 — למשל: ו תשרי" className="w-full rounded border p-2" />
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={name.trim().length < 2}
            className="rounded-lg bg-ark p-3 font-bold text-white disabled:opacity-40"
          >
            המשך
          </button>
          <button onClick={() => setStep(0)} className="text-sm underline opacity-60">חזרה</button>
        </section>
      )}

      {/* ---------- step 2 ---------- */}
      {step === 2 && (
        <section className="flex flex-col gap-3 rounded-lg border bg-white p-4">
          <h2 className="font-bold">תקנון ותשלום</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={takanonApproved}
              onChange={(e) => setTakanonApproved(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>
              קראתי ואני מאשר את{" "}
              <a href="https://docs.google.com/document/d/1504h4i-Xj4iMDlVG37b5NuWjvShEdZdoVlDppABP574/view"
                target="_blank" rel="noopener noreferrer" className="underline">
                תקנון בית הכנסת
              </a>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={duesDeclared}
              onChange={(e) => setDuesDeclared(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>
              הסדרתי את <b>דמי החבר לתשפ&quot;ז</b> ואת כל חובותיי לשנת תשפ&quot;ו
              (או אסדיר מול הגבאי לפני תחילת השנה)
            </span>
          </label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="הארות / הערות יתקבלו בברכה" className="rounded border p-2 text-sm" rows={2} />
          <button
            onClick={() => setStep(3)}
            disabled={!takanonApproved || !duesDeclared}
            className="rounded-lg bg-ark p-3 font-bold text-white disabled:opacity-40"
          >
            המשך לבחירת מקום
          </button>
          <button onClick={() => setStep(1)} className="text-sm underline opacity-60">חזרה</button>
        </section>
      )}

      {/* ---------- step 3 ---------- */}
      {step === 3 && (
        <section className="flex flex-col gap-2">
          {reservedSeats.length > 0 && (
            <div className="rounded border border-sky-400 bg-sky-50 p-2 text-sm">
              המקום שלך מהבהב במפה — לחץ עליו לאישור, או בחר מקום אחר.
              {map?.reservedUntil && <> שמור עד <b>{map.reservedUntil}</b>.</>}
            </div>
          )}
          <Legend />
          {notice && <div className="rounded border bg-white p-2 text-sm">{notice}</div>}
          {layout ? (
            <SeatMap
              layout={layout}
              map={map}
              selected={selected}
              myPhone={normalizePhone(phone)}
              myReservedSeats={reservedSeats}
              onToggleSeat={toggleSeat}
            />
          ) : (
            <p className="p-8 text-center opacity-60">טוען את מפת האולם…</p>
          )}
          <div className="sticky bottom-2 rounded-lg border bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="tnum">
                {selected.length
                  ? `נבחרו: ${[...selected].sort((a, b) => a - b).join(", ")}`
                  : "לחץ על מקום פנוי במפה"}
              </span>
              <b className="tnum">{price} ₪</b>
            </div>
            <button
              onClick={submitClaim}
              disabled={!selected.length || claimBusy}
              className="w-full rounded-lg bg-ark p-3 font-bold text-white disabled:opacity-40"
            >
              {claimBusy ? "רושם…" : `אישור סופי — ${price} ₪`}
            </button>
          </div>
          <button onClick={() => setStep(2)} className="text-sm underline opacity-60">חזרה</button>
        </section>
      )}

      {/* ---------- step 4 ---------- */}
      {step === 4 && (
        <section className="flex flex-col items-center gap-3 rounded-lg border bg-white p-6 text-center">
          <span className="text-4xl">🎉</span>
          <h2 className="text-lg font-bold">המקום שלך נרשם!</h2>
          <p className="tnum">
            מקומות <b>{claimedSeats.join(", ")}</b> על שם <b>{name}</b>
          </p>
          <p className="text-sm opacity-70">
            סכום לתשלום מול הגבאי: <b className="tnum">{totalPrice(claimedSeats.length)} ₪</b>
            {email ? " · אישור נשלח למייל" : ""}
          </p>
          {layout && (
            <div className="w-full">
              <SeatMap layout={layout} map={map} selected={claimedSeats} onToggleSeat={() => {}} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
