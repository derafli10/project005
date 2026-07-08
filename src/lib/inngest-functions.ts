import { inngest } from "./inngest";
import { academicWrappedService } from "./services/academic-wrapped.service";
import { baseDb } from "./db";

/**
 * Inngest function that triggers for each user chunk to generate Academic Wrapped stats,
 * render the card, upload it to CDN, save the record, and register an in-app notification.
 */
export const processUserWrapped = inngest.createFunction(
  { id: "process-user-wrapped" },
  { event: "app/wrapped.process" as const },
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

    // 3. Create TaskEditLog entry to trigger in-app notification preview (Task 17.3 requirement).
    // We create a dummy system task or reuse the last completed task to link, or create a virtual task.
    // However, to integrate with getUnreadNotifications, a UserTaskProgress record must exist for the task.
    // Let's find one completed user task in this week to link to, or any task they have progress in.
    await step.run("send-in-app-notification", async () => {
      const progress = await baseDb.userTaskProgress.findFirst({
        where: { userId },
        select: { taskId: true },
      });

      if (progress) {
        // Create an edit log showing wrapped card is ready.
        // We use editorId: "system-wrapped" (not the user themselves) to trigger unread state.
        // The edit log's fieldName: "wrapped", oldValue: "", newValue: wrapped.imageUrl.
        await baseDb.taskEditLog.create({
          data: {
            taskId: progress.taskId,
            editorId: "system-wrapped-cron", // different from user, so it shows in unread notification
            fieldName: "wrapped",
            oldValue: "Weekly Wrapped Card is ready!",
            newValue: wrapped.imageUrl || "Share to Story",
          },
        });
      }
    });

    return { success: true, userId, imageUrl: wrapped.imageUrl };
  }
);
