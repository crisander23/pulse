import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Pulse - live ideas, together",
  description: "Create live polls, invite your audience, and watch every response come together in real time.",
  icons: { icon: "/favicon.svg" },
  openGraph: { title: "Pulse - live ideas, together", description: "Turn every audience into a conversation.", images: [{ url: "/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: "Pulse - live ideas, together", description: "Turn every audience into a conversation.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
