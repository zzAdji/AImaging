import type { Metadata } from "next";
import { Sora, Instrument_Serif, Fira_Code } from "next/font/google";
import "./globals.css";
import LenisProvider from "@/components/layout/LenisProvider";
import { cn } from "@/lib/utils";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument-serif",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-fira-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AImaging",
  description:
    "Diagnostic radiographique par intelligence artificielle — Hôpital Général de Garoua.",
  icons: {
    icon: "/favicon.ico",
  },
};

import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import PageTransition from "@/components/layout/PageTransition";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="dark">
      <body
        className={cn(
          sora.variable,
          instrumentSerif.variable,
          firaCode.variable,
          "antialiased bg-primary text-foreground min-h-screen"
        )}
      >
        <LenisProvider>
          <PageTransition>
            <div className="noise-overlay" />
            <Navbar />
            <main>{children}</main>
            <Footer />
          </PageTransition>
        </LenisProvider>
      </body>
    </html>
  );
}
