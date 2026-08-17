import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import {
  ChangeDeltaWebhookStore,
  dispatchChangeDeltaWebhooks,
  readChangeDeltaWebhookConfig,
} from "@/lib/monitoring/change-delta-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (cronSecret.length < 32 || cronSecret.length > 256) {
    return problem(503, "webhook-dispatch-unconfigured");
  }
  if (!constantTimeEqual(
    request.headers.get("authorization") ?? "",
    `Bearer ${cronSecret}`,
  )) {
    return problem(401, "unauthorized");
  }

  try {
    const store = new ChangeDeltaWebhookStore(
      new SupabaseHttpClient(readSupabaseConfig()),
    );
    const summary = await dispatchChangeDeltaWebhooks({
      store,
      config: readChangeDeltaWebhookConfig(),
    });
    return NextResponse.json(summary, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error("change delta webhook dispatch unavailable");
    return problem(503, "webhook-dispatch-unavailable");
  }
}

function problem(status: number, error: string) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}
