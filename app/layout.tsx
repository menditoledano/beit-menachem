import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: 'מקומות — בית מנחם, גני איילון',
  description: 'בחירת מקומות לשנת תשפ"ז בבית הכנסת חב"ד "בית מנחם", גני איילון',
};

// The seat map is a wide grid the user scrolls horizontally. Locking the zoom
// keeps a two-finger pan from turning into an accidental page zoom mid-tap.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f3d2e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
