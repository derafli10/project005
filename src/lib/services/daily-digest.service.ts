import "server-only";

import { baseDb } from "@/lib/db";
import { PriorityEngineService, type PrioritizableTask } from "./priority-engine.service";
import { DeliveryStatus, DigestChannel, type User, type Task } from "@/generated/prisma";
import { ExternalServiceError, ValidationError } from "@/lib/errors/domain-errors";

/**
 * Helper function to run an asynchronous task with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= maxAttempts) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export class DailyDigestService {
  /**
   * Determine if the user should be sent a digest now.
   * Checks current time against user digestTime ± 15 min window.
   */
  static shouldSendDigest(user: Pick<User, "digestEnabled" | "digestTime">, now: Date = new Date()): boolean {
    if (!user.digestEnabled || !user.digestTime) {
      return false;
    }

    const [digestHour, digestMin] = user.digestTime.split(":").map(Number);
    if (isNaN(digestHour) || isNaN(digestMin)) {
      return false;
    }

    const digestMinutesSinceMidnight = digestHour * 60 + digestMin;
    const currentMinutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();

    let diff = Math.abs(currentMinutesSinceMidnight - digestMinutesSinceMidnight);
    diff = Math.min(diff, 1440 - diff); // Account for day wrap-around

    return diff <= 15;
  }

  /**
   * Fetch parent tasks added or modified in the last 24 hours.
   */
  static async getRecentChanges(
    userId: string,
    now: Date = new Date()
  ): Promise<{ added: Task[]; deadlineChanged: Task[]; escalations: Task[] }> {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. New tasks added in the last 24 hours
    const added = await baseDb.task.findMany({
      where: {
        isSubTask: false,
        createdAt: { gte: dayAgo },
        userProgress: {
          some: {
            userId,
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 2. Tasks with deadline changes in the last 24 hours (tracked via TaskEditLog)
    const deadlineChangedLogs = await baseDb.taskEditLog.findMany({
      where: {
        fieldName: "deadlineAt",
        editedAt: { gte: dayAgo },
        task: {
          isSubTask: false,
          userProgress: {
            some: {
              userId,
              status: { in: ["PENDING", "IN_PROGRESS"] },
            },
          },
        },
      },
      select: {
        task: true,
      },
      orderBy: { editedAt: "desc" },
    });

    // Deduplicate tasks by ID
    const deadlineChangedMap = new Map<string, Task>();
    for (const log of deadlineChangedLogs) {
      deadlineChangedMap.set(log.task.id, log.task);
    }
    const deadlineChanged = Array.from(deadlineChangedMap.values());

    // 3. Priority escalations (timeUrgency component change > 1000 basis points)
    const pendingParentTasks = await baseDb.task.findMany({
      where: {
        isSubTask: false,
        userProgress: {
          some: {
            userId,
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
        },
      },
    });

    const escalations: Task[] = [];
    for (const task of pendingParentTasks) {
      const hoursRemainingNow = (task.deadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      const hoursRemainingThen = (task.deadlineAt.getTime() - dayAgo.getTime()) / (1000 * 60 * 60);

      const urgencyNow = PriorityEngineService.calculateTimeUrgency(hoursRemainingNow);
      const urgencyThen = PriorityEngineService.calculateTimeUrgency(hoursRemainingThen);

      if (urgencyNow - urgencyThen > 1000) {
        escalations.push(task);
      }
    }

    return { added, deadlineChanged, escalations };
  }

  /**
   * Generates the digest message for the user.
   */
  static async generateDigestMessage(userId: string, now: Date = new Date()): Promise<string> {
    // Get total pending parent tasks count
    const pendingCount = await baseDb.userTaskProgress.count({
      where: {
        userId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        task: {
          isSubTask: false,
        },
      },
    });

    // Get all pending parent tasks to perform JIT priority scoring
    const progressRows = await baseDb.userTaskProgress.findMany({
      where: {
        userId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        task: {
          isSubTask: false,
        },
      },
      select: {
        task: true,
      },
    });

    const prioritizable: PrioritizableTask[] = progressRows.map((r) => ({
      id: r.task.id,
      sksWeight: r.task.sksWeight,
      taskWeight: r.task.taskWeight,
      deadlineAt: r.task.deadlineAt,
    }));

    const JITScored = PriorityEngineService.batchCalculate(prioritizable, now);
    // Sort descending by priority score
    JITScored.sort((a, b) => b.priorityScore - a.priorityScore);
    const top3 = JITScored.slice(0, 3).map((item, index) => {
      const matchedTask = progressRows.find((r) => r.task.id === item.task.id)?.task;
      return `${index + 1}. ${matchedTask?.title} (Skor: ${item.priorityScore})`;
    });

    // Get recent changes
    const { added, deadlineChanged, escalations } = await this.getRecentChanges(userId, now);

    const changesSection = [
      "Perubahan sejak kemarin:",
      `- Baru ditambahkan: ${added.length > 0 ? added.map((t) => t.title).join(", ") : "-"}`,
      `- Perubahan deadline: ${
        deadlineChanged.length > 0 ? deadlineChanged.map((t) => t.title).join(", ") : "-"
      }`,
      `- Eskalasi prioritas: ${escalations.length > 0 ? escalations.map((t) => t.title).join(", ") : "-"}`,
    ].join("\n");

    return [
      `Halo! Berikut ringkasan tugas harianmu:`,
      `Total tugas tertunda: ${pendingCount}`,
      `Top 3 Tugas Prioritas:`,
      top3.length > 0 ? top3.join("\n") : "Tidak ada tugas tertunda.",
      "",
      changesSection,
    ].join("\n");
  }

  /**
   * Deliver the message via WhatsApp using Twilio or fallback API.
   */
  static async sendViaWhatsApp(to: string, message: string): Promise<void> {
    if (!to) {
      throw new ValidationError("WhatsApp number is required");
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER || "whatsapp:+14155238886"; // Twilio sandbox number

    if (!accountSid || !authToken) {
      // Simulate/mock behavior or fallback to mock fetch call for tests
      const response = await fetch("https://api.twilio.com/mock-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message }),
      });
      if (!response.ok) {
        throw new ExternalServiceError("WhatsApp", `Mock failure: ${response.statusText}`);
      }
      return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: `whatsapp:${to}`,
        From: from,
        Body: message,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ExternalServiceError("WhatsApp", `Twilio failed with status ${response.status}: ${text}`);
    }
  }

  /**
   * Deliver the message via Telegram using Telegram Bot API.
   */
  static async sendViaTelegram(chatId: string, message: string): Promise<void> {
    if (!chatId) {
      throw new ValidationError("Telegram chat ID is required");
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      // Simulate/mock behavior or fallback to mock fetch call for tests
      const response = await fetch("https://api.telegram.org/mock-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message }),
      });
      if (!response.ok) {
        throw new ExternalServiceError("Telegram", `Mock failure: ${response.statusText}`);
      }
      return;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ExternalServiceError("Telegram", `Telegram failed with status ${response.status}: ${text}`);
    }
  }

  /**
   * Safely attempt idempotent delivery for the user at the given date/time.
   */
  static async attemptIdempotentDelivery(userId: string, now: Date = new Date()): Promise<void> {
    const user = await baseDb.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ValidationError("User not found", { userId });
    }

    // Normalize today's date to midnight UTC for the composite unique key
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    let logId: string;
    try {
      // Step 1: Insert execution token first (idempotency step)
      const log = await baseDb.dailyDigestLog.create({
        data: {
          userId,
          digestDate: today,
          deliveryStatus: DeliveryStatus.FAILED, // Temporary, updated post-delivery
          errorMessage: "Delivery initiated",
        },
      });
      logId = log.id;
    } catch (error: any) {
      // Check if it's a Prisma duplicate key error (P2002)
      if (error?.code === "P2002") {
        // Fast-fail: already delivered/attempted today
        return;
      }
      throw error;
    }

    try {
      // Step 2: Generate message
      const message = await this.generateDigestMessage(userId, now);

      // Step 3: Run delivery with retries wrapping the API invocation
      await withRetry(async () => {
        if (user.deliveryChannel === DigestChannel.WHATSAPP) {
          if (!user.whatsappNumber) {
            throw new ValidationError("User does not have a registered WhatsApp number");
          }
          await this.sendViaWhatsApp(user.whatsappNumber, message);
        } else if (user.deliveryChannel === DigestChannel.TELEGRAM) {
          if (!user.telegramChatId) {
            throw new ValidationError("User does not have a registered Telegram chat ID");
          }
          await this.sendViaTelegram(user.telegramChatId, message);
        } else {
          throw new ValidationError("Unsupported delivery channel");
        }
      }, 3, 1000);

      // Step 4: Success log update
      await baseDb.dailyDigestLog.update({
        where: { id: logId },
        data: {
          deliveryStatus: DeliveryStatus.SENT,
          errorMessage: null,
        },
      });
    } catch (err: any) {
      // Step 5: Failure log update
      const msg = err instanceof Error ? err.message : String(err);
      await baseDb.dailyDigestLog.update({
        where: { id: logId },
        data: {
          deliveryStatus: DeliveryStatus.FAILED,
          errorMessage: msg.slice(0, 1000), // Prevent overflow
        },
      });
      throw err;
    }
  }
}
