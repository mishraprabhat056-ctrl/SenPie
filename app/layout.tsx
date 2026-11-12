import type { Metadata } from "next";
import React from "react";
import { Quicksand } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-quicksand",
});

export const metadata = {
  title: "SenPie | Enterprise BI & AI Analytics",
  description: "Enterprise-grade BI dashboard with deep research capabilities",
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${quicksand.variable}`}>
      <body className="font-sans antialiased bg-zinc-950 text-zinc-100">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}