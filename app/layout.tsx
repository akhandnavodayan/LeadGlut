import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadGlut — Find your next customer",
  description: "Intent-led leads for ambitious teams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
