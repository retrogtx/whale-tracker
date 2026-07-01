import { NextResponse } from "next/server";
import { getTracker } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(getTracker().snapshot());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface UpdateBody {
  live?: unknown;
  threshold?: unknown;
  apiKey?: unknown;
  accountId?: unknown;
  budget?: unknown;
  copyTradeId?: unknown;
}

export async function POST(req: Request) {
  try {
    const tracker = getTracker();
    const body = (await req.json()) as UpdateBody;

    if (typeof body.apiKey === "string" || typeof body.accountId === "string") {
      tracker.setCredentials(
        typeof body.apiKey === "string" ? body.apiKey : undefined,
        typeof body.accountId === "string" ? body.accountId : undefined,
      );
    }
    if (typeof body.threshold === "number") {
      const r = tracker.setThreshold(body.threshold);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    }
    if (typeof body.budget === "number") {
      const r = tracker.setBudget(body.budget);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    }
    if (typeof body.live === "boolean") {
      const r = tracker.setLive(body.live);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    }
    if (typeof body.copyTradeId === "string") {
      const r = await tracker.copyTradeNow(body.copyTradeId);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    }

    return NextResponse.json(tracker.snapshot());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
