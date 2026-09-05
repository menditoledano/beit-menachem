import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://beit-menachem.vercel.app"),
  title: 'מקומות — בית מנחם, גני איילון',
  description: 'בחירת מקומות לשנת תשפ"ז בבית הכנסת חב"ד "בית מנחם", גני איילון',
};

// Page zoom stays ENABLED: older users enlarge text with pinch and browser
// zoom, and blocking that is an accessibility failure. The map has its own
// pinch handler scoped to its container, so the two do not fight.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#9a1b33",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
