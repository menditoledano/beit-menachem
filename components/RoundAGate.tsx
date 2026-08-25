"use client";

/**
 * Round A entry: phone-first, exact matching only, and a human fallback that
 * matters more than the algorithm. Every mismatch converts into a 30-second
 * WhatsApp conversation with the gabbai instead of a dead end.
 */

import { useState } from "react";
import type { LookupResult } from "@/lib/domain";
import { normalizePhone } from "@/lib/domain";

export function RoundAGate({
  gabbaiPhone,
  onVerified,
}: {
  /** International format for wa.me, e.g. 972542618833. */
  gabbaiPhone: string;
  onVerified: (name: string, phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");

  const check = async () => {
    const p = normalizePhone(phone);
    if (!p) { setError("מספר טלפון לא תקין"); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p }),
      });
      const data = await res.json();
      setResult(data.result ?? { kind: "UNKNOWN" });
    } catch {
      setError("שגיאת תקשורת, נסה שוב");
    } finally {
      setBusy(false);
    }
  };

  const waLink = (text: string) =>
    `https://wa.me/${gabbaiPhone}?text=${encodeURIComponent(text)}`;

  if (result?.kind === "CHAZAKA") {
    return (
      <div className="rounded border border-green-400 bg-green-50 p-3 text-sm">
        <p>שלום <b>{result.name}</b> — יש לך זכות קדימה מסבב שנה שעברה.</p>
        <button
          onClick={() => onVerified(result.name, normalizePhone(phone))}
          className="mt-2 rounded bg-ark px-4 py-2 font-bold text-white"
        >
          המשך לבחירת מקום
        </button>
      </div>
    );
  }

  if (result?.kind === "MULTI") {
    return (
      <div className="rounded border bg-white p-3 text-sm">
        <p className="mb-2">המספר משותף לכמה מתפללים — מי מכם?</p>
        {result.candidates.map((c) => (
          <button
            key={c.memberId}
            onClick={() => onVerified(c.name, normalizePhone(phone))}
            className="m-1 rounded border px-3 py-1"
          >
            {c.name}
          </button>
        ))}
      </div>
    );
  }

  if (result?.kind === "MEMBER_NO_CHAZAKA" || result?.kind === "UNKNOWN") {
    const msg =
      result.kind === "MEMBER_NO_CHAZAKA"
        ? "לא רשומה זכות קדימה על המספר הזה."
        : "המספר לא נמצא ברשימת המתפללים.";
    return (
      <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
        <p>{msg}</p>
        <p className="mt-1 opacity-70">
          אם היה לך מקום בשנה שעברה — כנראה שהטלפון אצלנו רשום אחרת. פנה לגבאי
          ונפתור את זה מיד:
        </p>
        <a
          href={waLink(
            `שלום, לא הצלחתי להיכנס לסבב החזקה. הטלפון שלי: ${normalizePhone(phone) || phone}. היה לי מקום בשנה שעברה.`,
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block rounded bg-green-600 px-4 py-2 font-bold text-white"
        >
          וואטסאפ לגבאי
        </a>
        <button onClick={() => setResult(null)} className="mr-3 text-sm underline">
          נסה מספר אחר
        </button>
      </div>
    );
  }

  return (
    <div className="rounded border bg-white p-3">
      <p className="mb-2 text-sm font-bold">סבב ראשון — בעלי מקום משנה שעברה</p>
      <p className="mb-2 text-xs opacity-70">
        הכנס את מספר הטלפון שלך כדי לבדוק זכות קדימה. הסבב הפתוח לכולם ייפתח
        בהמשך.
      </p>
      <div className="flex gap-2">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="טלפון נייד"
          className="flex-1 rounded border p-2"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
        />
        <button
          onClick={check}
          disabled={busy}
          className="rounded bg-ark px-4 font-bold text-white disabled:opacity-50"
        >
          {busy ? "בודק…" : "בדיקה"}
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
