import { ImageResponse } from "next/og";

/**
 * Link-preview card (WhatsApp, Telegram, iMessage). Rendered once at build
 * time from the same three-peaks logo the site header draws, so the preview
 * always matches the page. Satori ships no Hebrew glyphs, so Heebo is fetched
 * from Google Fonts during the build.
 */
export const alt = 'בית כנסת חב"ד בית מנחם — בחירת מקומות תשפ"ז';
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function heebo(weight: number) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=Heebo:wght@${weight}&subset=hebrew`,
    { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" } },
  ).then((r) => r.text());
  const url = css.match(/src: url\((https:[^)]+\.ttf)\)/)?.[1];
  if (!url) throw new Error(`Heebo ${weight}: no ttf url in Google Fonts css`);
  return fetch(url).then((r) => r.arrayBuffer());
}

// Satori lays glyphs out left-to-right with no bidi pass, so Hebrew strings
// are reversed by hand into visual order before rendering.
const rtl = (s: string) => [...s].reverse().join("");

export default async function Image() {
  const [bold, black] = await Promise.all([heebo(700), heebo(900)]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #fdfbf7 0%, #f3ede3 100%)",
          fontFamily: "Heebo",
        }}
      >
        <svg width="360" height="102" viewBox="0 0 120 34">
          <g
            stroke="#9a1b33"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 30 L26 8 L40 22" />
            <path d="M34 30 L54 12 L66 24" />
            <path d="M60 30 L84 6 L114 30" />
          </g>
        </svg>
        <div style={{ fontSize: 40, fontWeight: 700, color: "#8a6420", marginTop: 8 }}>
          {rtl('בית כנסת חב"ד')}
        </div>
        <div style={{ fontSize: 120, fontWeight: 900, color: "#9a1b33", lineHeight: 1.05 }}>
          {rtl("בית מנחם")}
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, color: "#241d1a", letterSpacing: 6 }}>
          {rtl("גני איילון")}
        </div>
        <div
          style={{
            marginTop: 44,
            padding: "14px 40px",
            borderRadius: 999,
            background: "#9a1b33",
            color: "#fff",
            fontSize: 38,
            fontWeight: 700,
          }}
        >
          {rtl('בחירת מקומות לשנת תשפ"ז')}
        </div>
      </div>
    ),
    { ...size, fonts: [
      { name: "Heebo", data: bold, weight: 700, style: "normal" },
      { name: "Heebo", data: black, weight: 900, style: "normal" },
    ] },
  );
}
