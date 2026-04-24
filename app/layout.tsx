import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { LocaleProvider } from "@/contexts/LocaleContext";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Track Policy",
  description:
    "Interactive atlas of AI and data center policy across world, regional, and state governments.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans bg-white text-ink antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('scrollRestoration' in history) history.scrollRestoration = 'manual';`,
          }}
        />
        <LocaleProvider>
          {children}
        </LocaleProvider>
        <Analytics />
      </body>
    </html>
  );
}
