import { NextResponse } from "next/server";
import { baseDb } from "@/lib/db";
import { inngest } from "@/lib/inngest";

/**
 * Scheduled Cron Endpoint: GET /api/webhooks/cron
 * Designed for Vercel Cron to run every Sunday at 21:00.
 *
 * Prevents Serverless Execution Timeouts by dispatching user payloads
 * to the Inngest background queue for distributed, parallel chunk processing.
 *
 * Requirements: 11.1, 11.8
 */
export async function GET(request: Request) {
  try {
    // Verify cron authorization signature if cron secret is configured
    const authHeader = request.headers.get("Authorization");
    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Fetch all users who need weekly wrapped cards generated.
    const users = await baseDb.user.findMany({
      select: { id: true },
    });

    const nowStr = new Date().toISOString();
    const dispatched: string[] = [];

    // 2. Offload the processing payload to Inngest for parallel background execution.
    // This executes in milliseconds, avoiding HTTP gateway timeouts.
    const events = users.map((user) => ({
      name: "app/wrapped.process",
      data: {
        userId: user.id,
        dateStr: nowStr,
      },
    }));

    if (events.length > 0) {
      await inngest.send(events);
    }

    return new NextResponse(
      JSON.stringify({
        success: true,
        message: `Dispatched background jobs for ${users.length} users.`,
        dispatchedCount: users.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[Weekly Wrapped Cron Error]", error);
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: error.message || "Internal Server Error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
