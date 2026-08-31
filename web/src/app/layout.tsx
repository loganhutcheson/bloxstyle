import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Accessory Mode – Roblox Clothing",
  description: "Design a watch on a Roblox classic shirt texture and preview it in 3D.",
  icons: {
    icon: [
      { url: "/shirt_logo.jpg", type: "image/jpeg" },
      { url: "/tshirt-favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/shirt_logo.jpg",
    shortcut: "/shirt_logo.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
