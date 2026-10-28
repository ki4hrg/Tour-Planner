import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// "The Pilgrim's Way" type system:
// - Fraunces (display): a characterful old-style serif standing in for the
//   transitional Caslon types of Wesley's own 18th-c. English printing.
// - Hanken Grotesk (body/UI): warm humanist sans, legible at small sizes.
// - IBM Plex Mono (data): times, dates, refs, costs — the planning "ledger" voice.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tour Planner",
  description: "Plan pilgrimage trips, locations, and itineraries.",
  applicationName: "Tour Planner",
  appleWebApp: { capable: true, title: "Tours", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2e5e4e",
  width: "device-width",
  initialScale: 1,
  // Comfortable mobile use without zoom traps on tap.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${fraunces.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
