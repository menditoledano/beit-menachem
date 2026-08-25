"use client";

/**
 * The claim form, shown once at least one seat is selected. Presents the
 * pairing requirement as a combined action ("המקום ומולו") rather than an
 * error, computes the price ladder locally for display, and keeps one
 * requestId across retries so a double-tap can never buy twice.
 */

import { useMemo, useRef, useState } from "react";
import type { ClaimResponse } from "@/lib/domain";
import { normalizePhone, totalPrice } from "@/lib/domain";

export function ClaimSheet({
  selected,
  onDone,
  onClear,
  prefill,
}: {
  selected: number[];
  onDone: (claimed: number[]) => void;
  onClear: () => void;
  /** Identity carried over from the Round A gate; locks name+phone together. */
  prefill?: { name: string; phone: string } | null;
}) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One id per user intent. Regenerated only when the selection changes, so
  // network retries and double-taps replay the same claim instead of stacking.
  const requestIdRef = useRef<string>("");
  const selKey = selected.join(",");
  const prevKeyRef = useRef(selKey);
  if (prevKeyRef.current !== selKey || !requestIdRef.current) {
    prevKeyRef.current = selKey;
    requestIdRef.current = `c-${crypto.randomUUID()}`;
  }

  const price = useMemo(() => totalPrice(selected.length), [selected.length]);
  const phoneOk = normalizePhone(phone) !== "";
  const canSubmit = selected.length > 0 && name.trim().length >= 2 && phoneOk && !busy;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: requestIdRef.current,
          seatNos: selected,
          name: name.trim(),
          phone: normalizePhone(phone),
          email: email.trim(),
        }),
      });
      const data: ClaimResponse = await res.json();
      if (data.ok) {
        onDone(data.seatNos);
        return;
      }
      switch (data.code) {
        case "TAKEN":
          setError("המקום נתפס זה עתה על ידי מישהו אחר. בחר מקום אחר.");
          onClear();
          break;
        case "PAIR_REQUIRED":
          setError(`מקום הפונה לארון נמכר יחד עם המקום שמולו (מקום ${data.pairSeatNo}). סמן גם אותו.`);
          break;
        case "CAP_REACHED":
          setError(`הגעת לתקרה — עד ${data.cap} מקומות לטלפון אחד.`);
          break;
        case "ROUND_A_NOT_YOURS":
          setError("בסבב הנוכחי בוחרים רק בעלי חזקה משנה שעברה. סבב פתוח ייפתח בהמשך.");
          break;
        case "SALE_CLOSED":
          setError("המכירה סגורה כרגע.");
          break;
        case "BUSY":
        case "TOO_FAST":
          setError("המערכת עמוסה, נסה שוב בעוד רגע.");
          break;
        default:
          setError("שגיאה זמנית. נסה שוב.");
      }
    } catch {
      setError("שגיאת תקשורת. נסה שוב.");
    } finally {
      setBusy(false);
    }
  };

  if (!selected.length) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 rounded-t-2xl border-t bg-white p-4 shadow-2xl">
      <div className="mx-auto flex max-w-md flex-col gap-2">
        <div className="flex items-center justify-between">
          <b className="tnum">
            {selected.length === 1
              ? `מקום ${selected[0]}`
              : `מקומות ${[...selected].sort((a, b) => a - b).join(", ")}`}
          </b>
          <span className="tnum rounded bg-ark px-2 py-0.5 text-sm text-white">{price} ₪</span>
          <button onClick={onClear} className="text-sm underline">ביטול</button>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם מלא (יוצג על המפה)"
          className="rounded border p-2"
          autoComplete="name"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="טלפון נייד"
          className="rounded border p-2"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="אימייל (רשות)"
          className="rounded border p-2"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-lg bg-ark p-3 font-bold text-white disabled:opacity-40"
        >
          {busy ? "תופס…" : `אישור — ${price} ₪`}
        </button>
        <p className="text-center text-[11px] opacity-60">
          התשלום מוסדר מול הגבאי. המקום נרשם מיידית על שמך.
        </p>
      </div>
    </div>
  );
}
