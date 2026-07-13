import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Free Process Map Generator — GrowThriveScale",
  description:
    "Turn a plain-English process description into a downloadable draw.io swimlane diagram and an Excel process register — free, in under a minute, no account.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-slate-50 text-slate-900 antialiased flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
