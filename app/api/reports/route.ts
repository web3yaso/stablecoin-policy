import { NextResponse, type NextRequest } from "next/server";
import { listReports } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

type PublicReport = {
  slug: string;
  title: string;
  title_en?: string;
  summary: string;
  category: string;
  jurisdiction: string[];
  publishedAt: string;
  wordCount: number;
  priceUSD: number;
  fullContentUrl: string;
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request: NextRequest) {
  const rateLimit = checkRateLimit(getClientId(request));

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate-limit-exceeded" },
      {
        status: 429,
        headers: {
          ...corsHeaders(),
          "Cache-Control": "no-store",
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  const reports = await listReports();
  const baseUrl = new URL(request.url);
  const publicReports: PublicReport[] = reports.map((report) => ({
    slug: report.slug,
    title: report.title,
    ...(report.title_en ? { title_en: report.title_en } : {}),
    summary: report.summary,
    category: report.category,
    jurisdiction: report.jurisdiction,
    publishedAt: report.publishedAt,
    wordCount: report.wordCount,
    priceUSD: report.priceUSD,
    fullContentUrl: `${baseUrl.origin}/api/reports/${report.slug}`,
  }));

  const lastUpdated =
    reports
      .map((report) => Date.parse(report.publishedAt))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0] ?? Date.now();

  return NextResponse.json(
    {
      reports: publicReports,
      total: publicReports.length,
      lastUpdated: new Date(lastUpdated).toISOString(),
    },
    {
      headers: {
        ...corsHeaders(),
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function getClientId(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

function checkRateLimit(clientId: string):
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  pruneExpiredBuckets(now);

  const bucket = rateLimitBuckets.get(clientId);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(clientId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true };
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true };
}

function pruneExpiredBuckets(now: number) {
  for (const [clientId, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(clientId);
    }
  }
}
