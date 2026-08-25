/**
 * The shul's logo, rebuilt as inline SVG from the banner artwork: three
 * mountain peaks over the name. Inline SVG keeps it crisp at any size and
 * ships no image bytes.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <svg
        viewBox="0 0 120 34"
        className={compact ? "h-6" : "h-9"}
        aria-hidden="true"
      >
        <g stroke="var(--brand-maroon)" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 30 L26 8 L40 22" />
          <path d="M34 30 L54 12 L66 24" />
          <path d="M60 30 L84 6 L114 30" />
        </g>
      </svg>
      <span
        className={`font-bold text-brand-gold ${compact ? "text-xs" : "text-sm"}`}
      >
        בית כנסת חב&quot;ד
      </span>
      <span
        className={`font-black text-brand-maroon ${compact ? "text-lg" : "text-3xl"}`}
      >
        בית מנחם
      </span>
      {!compact && <span className="text-xs tracking-widest">גני איילון</span>}
    </div>
  );
}
