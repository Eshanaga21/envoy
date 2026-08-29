import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Envoy — Your buyer agent",
  description: "AI-powered RFQ procurement with gated Razorpay payment.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
