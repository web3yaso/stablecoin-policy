import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { LocaleProvider } from "@/contexts/LocaleContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stablecoin Policy",
  description:
    "Interactive atlas of stablecoin policy across countries, regions, and US states.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
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
