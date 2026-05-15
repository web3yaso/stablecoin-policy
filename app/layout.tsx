import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { LocaleProvider } from "@/contexts/LocaleContext";
import "./globals.css";

const SITE_URL = "https://stablecoin.web3law.tech";
const PARENT_SITE = "https://web3law.tech";
const PARENT_BRAND = "Web3Law Intelligence";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Stablecoin Policy Tracker — Web3Law Intelligence",
    template: "%s | Stablecoin Policy Tracker",
  },
  description:
    "Track stablecoin policy worldwide — 154 bills across US federal, US states, EU, and Asia-Pacific, with key politicians and live news. Part of Web3Law Intelligence.",
  keywords: [
    "stablecoin policy",
    "stablecoin regulation",
    "GENIUS Act",
    "STABLE Act",
    "MiCA stablecoin",
    "stablecoin tracker",
    "crypto regulation",
    "稳定币立法",
    "稳定币监管",
  ],
  authors: [{ name: PARENT_BRAND, url: PARENT_SITE }],
  creator: PARENT_BRAND,
  publisher: PARENT_BRAND,

  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Stablecoin Policy Tracker",
    title: "Stablecoin Policy Tracker — Web3Law Intelligence",
    description:
      "Track stablecoin policy worldwide. 154 bills, key politicians, live news.",
  },

  twitter: {
    card: "summary_large_image",
    title: "Stablecoin Policy Tracker — Web3Law Intelligence",
    description:
      "Track stablecoin policy worldwide. 154 bills, key politicians, live news.",
    site: "@web3law_tech",
    creator: "@web3law_tech",
  },

  robots: {
    index: true,
    follow: true,
  },

  alternates: {
    canonical: SITE_URL,
  },

  other: {
    "apple-mobile-web-app-title": "Stablecoin Policy",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="describedby" href="/.well-known/x402-skill.md" />
      </head>
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
