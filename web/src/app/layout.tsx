import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";
import HeaderUserMenu from "@/components/HeaderUserMenu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Roblox AI Clothing Generator – 2D Roblox Shirt Maker",
  description: "Generate 2D Roblox shirt designs instantly with our AI clothing generator.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <div className="min-h-screen w-full flex flex-col">
            <header className="w-full flex items-center justify-end p-4">
              <HeaderUserMenu />
            </header>
            <main className="flex-1 w-full">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
