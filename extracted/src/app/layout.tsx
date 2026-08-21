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
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-900 text-white antialiased overflow-hidden h-screen w-screen">
        {children}
      </body>
    </html>
  );
}
