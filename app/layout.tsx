import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mail-identities.css";
import "./pwa.css";

export const metadata: Metadata = {
  title: "Vyncuslim Mail",
  description: "Private domain webmail for Vyncuslim and Vynalth.",
  applicationName: "Vyncuslim Mail",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Vyncuslim Mail" },
  icons: {
    icon: [{ url: "/icons/mail-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f8fc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
