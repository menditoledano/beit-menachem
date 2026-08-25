"use client";

/**
 * The public flow, as a rolling steps wizard modeled on the original paper
 * registration form: identify → details & aliyot → takanon + dues → pick a
 * seat → done. Each step is one screen on a phone; the map only appears after
 * the declarations, which is what the gabbai's manual flow always enforced.
 *
 * Presentation follows one design system (globals.css): a single card
 * surface, one primary action per screen, pills for every message, and a
 * step-in transition so the flow reads as one document unrolling.
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
import { Logo } from "@/components/Logo";

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

  const back = (to: Step) => (
    <button onClick={() => setStep(to)} className="btn-ghost self-start">
      → חזרה
    </button>
  );

  /* ---------- shared chrome ---------- */
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pb-8 pt-3">
      <header className="flex flex-col items-center gap-2">
        <Logo compact={step > 0} />
        {step === 0 && (
          <h1 className="text-[15px] font-semibold text-brand-maroon-dark">
            בחירת מקומות לשנת תשפ&quot;ז
          </h1>
        )}
      </header>

      {/* progress: a thin filling rail + the current step's name. */}
      {step < 4 && (
        <div className="flex flex-col gap-1.5" aria-label={`שלב ${step + 1} מתוך 4`}>
          <div className="flex gap-1.5" dir="rtl">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  i <= step ? "bg-brand-maroon" : "bg-black/10"
                }`}
              />
            ))}
          </div>
          <p className="text-center text-xs font-medium opacity-60">
            {STEP_TITLES[step]}
          </p>
        </div>
      )}

      {mode !== "OPEN" && step < 4 && (
        <div className="pill pill-warn step-in">
          {mode === "READONLY" ? "המכירה מוקפאת זמנית." : "המכירה עדיין לא נפתחה — ניתן לצפות במפה בלבד."}
        </div>
      )}
      {mode !== "OPEN" && step < 4 && layout && (
        <div className="card step-in p-3">
          <SeatMap layout={layout} map={map} selected={[]} onToggleSeat={() => {}} />
          <div className="pt-2"><Legend /></div>
        </div>
      )}

      {/* ---------- step 0 ---------- */}
      {step === 0 && mode === "OPEN" && (
        <section className="card step-in flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-xl font-bold">שלום 👋</h2>
            <p className="mt-1 text-sm opacity-60">
              {phase === "A"
                ? "סבב ראשון — בעלי מקום משנה שעברה. הכנס טלפון ונאתר את המקום השמור לך."
                : "הכנס מספר טלפון כדי להתחיל."}
            </p>
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="050-0000000"
            className="field text-center tracking-wider"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            aria-label="טלפון נייד"
            onKeyDown={(e) => e.key === "Enter" && doLookup()}
          />
          <button onClick={doLookup} disabled={lookupBusy} className="btn-primary">
            {lookupBusy ? "בודק…" : "המשך"}
          </button>
          {multi.length > 0 && (
            <div className="pill pill-info step-in">
              <p className="mb-2 font-semibold">המספר משותף לכמה מתפללים — מי מכם?</p>
              <div className="flex flex-wrap gap-2">
                {multi.map((c) => (
                  <button
                    key={c.memberId}
                    onClick={() => { setName(c.name); setMulti([]); setStep(1); }}
                    className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {lookupMsg && (
            <div className="pill pill-warn step-in" aria-live="polite">
              {lookupMsg}
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer"
                  className="mt-2 flex w-max items-center gap-2 rounded-full bg-green-600 px-4 py-2 font-bold text-white shadow">
                  וואטסאפ לגבאי
                </a>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---------- step 1 ---------- */}
      {step === 1 && (
        <section className="card step-in flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-xl font-bold">{name ? `שלום ${name.split(" ")[0]}!` : "פרטים אישיים"}</h2>
            {reservedSeats.length > 0 && (
              <div className="pill pill-hold mt-2">
                🪑 {reservedSeats.length === 1 ? "המקום שלך" : "המקומות שלך"} משנה שעברה —{" "}
                <b className="tnum">{reservedSeats.join(", ")}</b> —{" "}
                {reservedSeats.length === 1 ? "שמור" : "שמורים"} לך
                {map?.reservedUntil ? ` עד ${map.reservedUntil}` : " לזמן מוגבל"}.
                <div className="mt-1 font-semibold">
                  מחיר אישור: <span className="tnum">{totalPrice(reservedSeats.length)} ₪</span>
                </div>
                <div className="mt-1 text-xs opacity-75">
                  אפשר לאשר את המקום שלך, או לעבור למקום פנוי — מעבר מוותר על הישן.
                </div>
              </div>
            )}
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            שם מלא <span className="font-normal opacity-50">(יוצג על המפה)</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="field" autoComplete="name" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            אימייל <span className="font-normal opacity-50">(רשות, לאישור)</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              className="field" inputMode="email" dir="ltr" />
          </label>
          <div className="rounded-2xl bg-[#f8f6f2] p-4">
            <p className="text-sm leading-relaxed">
              כל חבר משלם זכאי ל<b>שתי עליות לתורה</b> בשנה (יום הולדת / יארצייט / אחר).
              בחר שני תאריכים עכשיו — ללא רישום מראש לא תינתן עלייה ברגע האחרון.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <input value={aliyah1} onChange={(e) => setAliyah1(e.target.value)}
                placeholder="תאריך עברי ראשון — למשל: כא סיוון" className="field bg-white" />
              <input value={aliyah2} onChange={(e) => setAliyah2(e.target.value)}
                placeholder="תאריך עברי שני — למשל: ו תשרי" className="field bg-white" />
            </div>
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={name.trim().length < 2}
            className="btn-primary"
          >
            המשך
          </button>
          {back(0)}
        </section>
      )}

      {/* ---------- step 2 ---------- */}
      {step === 2 && (
        <section className="card step-in flex flex-col gap-4 p-5">
          <h2 className="text-xl font-bold">תקנון ותשלום</h2>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#f8f6f2] p-4 text-sm leading-relaxed">
            <input type="checkbox" checked={takanonApproved}
              onChange={(e) => setTakanonApproved(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand-maroon)]" />
            <span>
              קראתי ואני מאשר את{" "}
              <a href="https://docs.google.com/document/d/1504h4i-Xj4iMDlVG37b5NuWjvShEdZdoVlDppABP574/view"
                target="_blank" rel="noopener noreferrer"
                className="font-semibold text-brand-maroon underline">
                תקנון בית הכנסת
              </a>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#f8f6f2] p-4 text-sm leading-relaxed">
            <input type="checkbox" checked={duesDeclared}
              onChange={(e) => setDuesDeclared(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand-maroon)]" />
            <span>
              הסדרתי את <b>דמי החבר לתשפ&quot;ז</b> ואת כל חובותיי לשנת תשפ&quot;ו
              (או אסדיר מול הגבאי לפני תחילת השנה)
            </span>
          </label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="הארות / הערות יתקבלו בברכה"
            className="field resize-none py-3" rows={2} />
          <button
            onClick={() => {
              if (reservedSeats.length && !selected.length) {
                setSelected(reservedSeats);
                if (!requestIdRef.current) requestIdRef.current = `c-${crypto.randomUUID()}`;
              }
              setStep(3);
            }}
            disabled={!takanonApproved || !duesDeclared}
            className="btn-primary"
          >
            המשך לבחירת מקום
          </button>
          {back(1)}
        </section>
      )}

      {/* ---------- step 3 ---------- */}
      {step === 3 && (
        <section
          className="step-in flex flex-col gap-3 self-center"
          style={{ width: "min(100vw - 1.5rem, 1100px)" }}
        >
          {reservedSeats.length > 0 && (
            <div className="pill pill-hold" aria-live="polite">
              {selected.some((n) => reservedSeats.includes(n))
                ? "המקום שלך מסומן — אישור סופי למטה. אפשר גם לעבור למקום פנוי."
                : "עברת למקום אחר — המקום הישן שלך ישוחרר עם האישור."}
              {map?.reservedUntil && <> שמור עד <b>{map.reservedUntil}</b>.</>}
            </div>
          )}
          {notice && <div className="pill pill-info" aria-live="polite">{notice}</div>}
          <div className="card p-3">
            {layout ? (
              <SeatMap
                layout={layout}
                map={map}
                selected={selected}
                myPhone={normalizePhone(phone)}
                myReservedSeats={reservedSeats}
                focusSeat={reservedSeats[0] ?? selected[0]}
                onToggleSeat={toggleSeat}
              />
            ) : (
              <p className="p-8 text-center opacity-50">טוען את מפת האולם…</p>
            )}
            <div className="pt-2"><Legend /></div>
          </div>

          <div className="safe-bottom sticky bottom-0 z-10 border-t border-black/5 bg-white/80 px-4 pt-3 backdrop-blur-xl">
            <div className="mx-auto flex max-w-lg flex-col gap-2">
              {selected.length === 0 ? (
                /* Nothing picked yet: a hint line, not a dead button. */
                <p className="pb-1 text-center text-sm opacity-60">
                  לחץ על מקום פנוי במפה כדי לבחור
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="tnum opacity-70">
                      נבחרו: {[...selected].sort((a, b) => a - b).join(", ")}
                    </span>
                    <b className="tnum text-lg">{price} ₪</b>
                  </div>
                  <button onClick={submitClaim} disabled={claimBusy} className="btn-primary">
                    {claimBusy ? "רושם…" : `אישור סופי — ${price} ₪`}
                  </button>
                </>
              )}
              {back(2)}
            </div>
          </div>
        </section>
      )}

      {/* ---------- step 4 ---------- */}
      {step === 4 && (
        <section className="card step-in flex flex-col items-center gap-4 p-6 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-seat-free/10 text-4xl">
            ✓
          </span>
          <div>
            <h2 className="text-2xl font-bold text-brand-maroon">המקום שלך נרשם!</h2>
            <p className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {claimedSeats.map((n) => (
                <span key={n}
                  className="tnum rounded-full bg-brand-maroon px-3 py-1 text-sm font-bold text-white">
                  מקום {n}
                </span>
              ))}
            </p>
            <p className="mt-2 text-sm opacity-60">
              על שם <b>{name}</b>
              {email ? " · אישור נשלח למייל" : ""}
            </p>
          </div>
          {map?.paymentUrl && (
            <a
              href={map.paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary max-w-xs no-underline"
            >
              💳 לתשלום מאובטח — {totalPrice(claimedSeats.length)} ₪
            </a>
          )}
          <p className="text-xs opacity-50">
            אפשר לשלם גם מאוחר יותר — המקום כבר רשום על שמך.
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
