import { inngest } from "./inngest";
import { academicWrappedService } from "./services/academic-wrapped.service";
import { DailyDigestService } from "./services/daily-digest.service";
import { baseDb } from "./db";

/**
 * Inngest function that triggers for each user chunk to generate Academic Wrapped stats,
 * render the card, upload it to CDN, save the record, and register an in-app notification.
 */
export const processUserWrapped = inngest.createFunction(
  {
    id: "process-user-wrapped",
    name: "Process User Wrapped",
    triggers: { event: "app/wrapped.process" },
  },
  async ({ event, step }) => {
    const { userId, dateStr } = event.data;
    const date = new Date(dateStr);

    // 1. Fetch user to get name for the card.
    const user = await step.run("fetch-user", async () => {
      return baseDb.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
    });

    if (!user) return { success: false, error: "User not found" };
    const displayName = user.name || user.email.split("@")[0] || "Student";

    // 2. Generate stats, render PNG card, upload to Vercel Blob, and save AcademicWrapped record.
    const wrapped = await step.run("generate-wrapped-card", async () => {
      return academicWrappedService.generateAndSave(userId, displayName, date);
    });

    // 3. Create TaskEditLog entry to trigger in-app notification preview (Task 17.3, Requirement 11.8).
    // NOTE: The notification system uses TaskEditLog as the mechanism for in-app notifications.
    // To send a notification, we need:
    //   - An existing task that the user has progress on
    //   - A different editorId (not the user) to trigger "unread" state
    // We encode the wrapped card metadata in the fieldName/oldValue/newValue fields.
    await step.run("send-in-app-notification", async () => {
      // Find any task this user has progress on, preferring recently completed ones.
      const progress = await baseDb.userTaskProgress.findFirst({
        where: { userId },
        select: { taskId: true },
        orderBy: { completedAt: "desc" },
      });

      if (progress) {
        // Ensure a system user exists for cron notifications.
        // We'll use a deterministic ID to avoid duplicates on subsequent runs.
        const systemUserId = "system-cron";
        await baseDb.user.upsert({
          where: { id: systemUserId },
          create: {
            id: systemUserId,
            email: "system-cron@project005.internal",
            name: "Academic Wrapped",
            role: "ADMIN",
          },
          update: {
            name: "Academic Wrapped",
          },
        });

        // Create an edit log entry to trigger in-app notification.
        // The notification component will show: "{title} was updated by {name}"
        // We encode the wrapped card info in oldValue (message) and newValue (imageUrl).
        await baseDb.taskEditLog.create({
          data: {
            taskId: progress.taskId,
            editorId: systemUserId,
            fieldName: "academicWrapped",
            oldValue: `Your Weekly Wrapped is ready! 🎉`,
            newValue: wrapped.imageUrl || "",
          },
        });
      }
    });

    return { success: true, userId, imageUrl: wrapped.imageUrl };
  }
);

/**
 * Inngest function that triggers for each user to execute daily digest message delivery idempotently.
 */
export const processDailyDigest = inngest.createFunction(
  {
    id: "process-daily-digest",
    name: "Process Daily Digest",
    triggers: { event: "app/digest.process" },
  },
  async ({ event, step }) => {
    const { userId, dateStr } = event.data;
    const date = new Date(dateStr);

    await step.run("deliver-digest", async () => {
      await DailyDigestService.attemptIdempotentDelivery(userId, date);
    });

    return { success: true, userId };
  }
);

