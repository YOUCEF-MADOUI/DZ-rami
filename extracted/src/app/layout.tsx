import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "DZ-rami - Rami Algérien",
  description: "DZ-rami · Jeu de Rami algérien selon les règles de Bordj Bou Arréridj",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Keep pinch-zoom available for accessibility on small mobile screens.
  // `cover` lets the app draw under the notch/bars so the safe-area insets
  // declared in globals.css can reserve the right space.
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-900 text-white antialiased overflow-hidden h-dvh w-screen">
        {children}
      </body>
    </html>
  );
}
