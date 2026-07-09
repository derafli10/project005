import { NextResponse } from "next/server";
import { baseDb } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { DailyDigestService } from "@/lib/services/daily-digest.service";

/**
 * Scheduled Cron Endpoint: GET /api/webhooks/cron
 * Designed for Vercel Cron.
 *
 * Supports query parameter `type=digest` for daily digest processing (runs every 30 mins)
 * or defaults/resolves `type=wrapped` for weekly wrapped card rendering (runs Sunday at 21:00).
 *
 * Prevents Serverless Execution Timeouts by dispatching user payloads
 * to the Inngest background queue for distributed, parallel chunk processing.
 *
 * Requirements: 11.1, 11.8, 13.3
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

    const { searchParams } = new URL(request.url);
    const cronType = searchParams.get("type");

    const now = new Date();
    const nowStr = now.toISOString();

    if (cronType === "digest") {
      // 1. Fetch users who have daily digest enabled
      const users = await baseDb.user.findMany({
        where: { digestEnabled: true },
        select: { id: true, digestEnabled: true, digestTime: true },
      });

      // 2. Filter users whose digestTime matches current time ± 15 mins
      const matchingUsers = users.filter((user) =>
        DailyDigestService.shouldSendDigest(user, now)
      );

      // 3. Dispatch to background worker queue via Inngest
      const events = matchingUsers.map((user) => ({
        name: "app/digest.process",
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
          message: `Dispatched daily digest background jobs for ${matchingUsers.length} users.`,
          dispatchedCount: matchingUsers.length,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } else {
      // Default: Weekly Wrapped cron job
      const users = await baseDb.user.findMany({
        select: { id: true },
      });

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
    }
  } catch (error: any) {
    console.error("[Cron Webhook Error]", error);
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
