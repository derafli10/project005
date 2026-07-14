import "server-only";

import { baseDb } from "@/lib/db";
import { PriorityEngineService, type PrioritizableTask } from "./priority-engine.service";
import { DeliveryStatus, DigestChannel, type User, type Task, type Locale } from "@/generated/prisma";
import { ExternalServiceError, ValidationError } from "@/lib/errors/domain-errors";
import { getTranslation } from "@/i18n/utils";
import { MonitoringService } from "@/lib/monitoring";

// ─── TYPES ──────────────────────────────────────────────────────────────────

/** Result shape for WhatsApp API calls. */
export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** Result shape for Telegram API calls. */
export interface TelegramSendResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

// ─── RETRY HELPER ───────────────────────────────────────────────────────────

/**
 * Run an asynchronous operation with exponential backoff.
 *
 * @param fn          The async function to execute.
 * @param maxAttempts Maximum number of attempts (default 3).
 * @param baseDelay   Initial delay in ms before first retry (default 1000).
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = process.env.NODE_ENV === "test" ? 0 : 1000
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

// ─── SERVICE ────────────────────────────────────────────────────────────────

export class DailyDigestService {
  /**
   * Determine if the user should be sent a digest now.
   * Checks current time against user digestTime ± 15 min window.
   */
  static shouldSendDigest(user: Pick<User, "digestEnabled" | "digestTime">, now: Date = new Date()): boolean {
    if (!user.digestEnabled || !user.digestTime) {
      return false;
    }

    const parts = user.digestTime.split(":").map(Number);
    const digestHour = parts[0];
    const digestMin = parts[1];
    if (digestHour === undefined || digestMin === undefined || isNaN(digestHour) || isNaN(digestMin)) {
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
   *
   * Returns:
   * - `added`: New Parent Tasks created within 24h
   * - `deadlineChanged`: Tasks with deadline edits in TaskEditLog within 24h
   * - `escalations`: Tasks whose timeUrgency component delta > 1000 basis points
   *
   * Requirement 13.9
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
   * Generate the digest message for a user.
   *
   * Includes:
   * - Pending Parent Task count (isSubTask=false filter)
   * - Top 3 tasks by JIT Priority_Score
   * - "What changed since yesterday?" section (new tasks, deadline changes, priority escalations)
   *
   * Supports both EN and ID locales via early shifted translation logic.
   *
   * Requirements: 13.8, 13.9
   */
  static async generateDigestMessage(userId: string, locale: Locale = "ID", now: Date = new Date()): Promise<string> {
    // Early-shift translation: resolve translator for the user's locale once
    const t = (key: string, params?: Record<string, string>) => getTranslation(locale, key, params);

    // 1. Pending parent task count (excluding subtasks)
    const pendingCount = await baseDb.userTaskProgress.count({
      where: {
        userId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        task: {
          isSubTask: false,
        },
      },
    });

    // 2. Get all pending parent tasks for JIT priority scoring
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
    // batchCalculate already sorts DESC by priorityScore
    const top3 = JITScored.slice(0, 3).map((item, index) => {
      const matchedTask = progressRows.find((r) => r.task.id === item.task.id)?.task;
      return t("digest.taskScore", {
        rank: String(index + 1),
        title: matchedTask?.title ?? item.task.id,
        score: String(item.priorityScore),
      });
    });

    // 3. Get recent changes for "What changed since yesterday?" section
    const { added, deadlineChanged, escalations } = await this.getRecentChanges(userId, now);
    const noChanges = t("digest.noChanges");

    const changesSection = [
      t("digest.changesHeading"),
      t("digest.newlyAdded", {
        items: added.length > 0 ? added.map((task) => task.title).join(", ") : noChanges,
      }),
      t("digest.deadlineChanges", {
        items: deadlineChanged.length > 0 ? deadlineChanged.map((task) => task.title).join(", ") : noChanges,
      }),
      t("digest.priorityEscalations", {
        items: escalations.length > 0 ? escalations.map((task) => task.title).join(", ") : noChanges,
      }),
    ].join("\n");

    // 4. Assemble full message
    return [
      t("digest.greeting"),
      t("digest.pendingCount", { count: String(pendingCount) }),
      t("digest.top3Heading"),
      top3.length > 0 ? top3.join("\n") : t("digest.noTasks"),
      "",
      changesSection,
    ].join("\n");
  }

  /**
   * Send digest via WhatsApp Business API.
   *
   * Uses Twilio as primary provider, with Fonnte as a configurable alternative.
   * Wrapped with exponential backoff retry (max 3 attempts).
   *
   * Environment variables:
   * - WHATSAPP_PROVIDER: "twilio" | "fonnte" (default: "twilio")
   * - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
   * - FONNTE_API_TOKEN
   *
   * Requirements: 13.10
   *
   * @returns WhatsAppSendResult with success/error status
   */
  static async sendViaWhatsApp(to: string, message: string): Promise<WhatsAppSendResult> {
    if (!to) {
      throw new ValidationError("WhatsApp number is required");
    }

    const provider = (process.env.WHATSAPP_PROVIDER ?? "twilio").toLowerCase();

    return withRetry<WhatsAppSendResult>(async () => {
      if (provider === "fonnte") {
        return this._sendViaFonnte(to, message);
      }
      return this._sendViaTwilio(to, message);
    }, 3, 1000);
  }

  /**
   * Internal: Send via Twilio WhatsApp Business API.
   */
  private static async _sendViaTwilio(to: string, message: string): Promise<WhatsAppSendResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

    if (!accountSid || !authToken) {
      throw new ExternalServiceError(
        "WhatsApp",
        "Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env variables."
      );
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
        From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
        Body: message,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new ExternalServiceError("WhatsApp", `Twilio failed with status ${response.status}: ${text}`);
      MonitoringService.logExternalApiFailure("Twilio", "sendMessage", err, { to, status: response.status });
      throw err;
    }

    const data = (await response.json()) as { sid?: string };
    return {
      success: true,
      messageId: data.sid ?? undefined,
    };
  }

  /**
   * Internal: Send via Fonnte WhatsApp API.
   */
  private static async _sendViaFonnte(to: string, message: string): Promise<WhatsAppSendResult> {
    const apiToken = process.env.FONNTE_API_TOKEN;

    if (!apiToken) {
      throw new ExternalServiceError(
        "WhatsApp",
        "Fonnte credentials not configured. Set FONNTE_API_TOKEN env variable."
      );
    }

    const response = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: apiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: to,
        message,
        type: "text",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new ExternalServiceError("WhatsApp", `Fonnte failed with status ${response.status}: ${text}`);
      MonitoringService.logExternalApiFailure("Fonnte", "sendMessage", err, { to, status: response.status });
      throw err;
    }

    const data = (await response.json()) as { id?: string; status?: boolean };
    if (data.status === false) {
      const err = new ExternalServiceError("WhatsApp", "Fonnte returned failure status");
      MonitoringService.logExternalApiFailure("Fonnte", "sendMessage", err, { to, response: data });
      throw err;
    }

    return {
      success: true,
      messageId: data.id ?? undefined,
    };
  }

  /**
   * Send digest via Telegram Bot API.
   * Wrapped with exponential backoff retry (max 3 attempts).
   *
   * @returns TelegramSendResult with success/error status
   */
  static async sendViaTelegram(chatId: string, message: string): Promise<TelegramSendResult> {
    if (!chatId) {
      throw new ValidationError("Telegram chat ID is required");
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new ExternalServiceError(
        "Telegram",
        "Telegram credentials not configured. Set TELEGRAM_BOT_TOKEN env variable."
      );
    }

    return withRetry<TelegramSendResult>(async () => {
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
        const err = new ExternalServiceError("Telegram", `Telegram failed with status ${response.status}: ${text}`);
        MonitoringService.logExternalApiFailure("Telegram", "sendMessage", err, { chatId, status: response.status });
        throw err;
      }

      const data = (await response.json()) as { result?: { message_id?: number } };
      return {
        success: true,
        messageId: data.result?.message_id ?? undefined,
      };
    }, 3, 1000);
  }

  /**
   * Safely attempt idempotent delivery for the user at the given date/time.
   *
   * Flow:
   * 1. INSERT execution token (idempotency guard via composite unique [userId, digestDate])
   * 2. If P2002 duplicate, fail-fast (already sent today)
   * 3. Generate digest message with user locale
   * 4. Deliver via configured channel with retry
   * 5. Update log to SENT or FAILED
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
    } catch (error: unknown) {
      // Check if it's a Prisma duplicate key error (P2002)
      if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") {
        // Fast-fail: already delivered/attempted today
        return;
      }
      throw error;
    }

    try {
      // Step 2: Generate message with user's locale preference
      const message = await this.generateDigestMessage(userId, user.locale, now);

      // Step 3: Run delivery via configured channel (retry is inside each send method)
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

      // Step 4: Success log update
      await baseDb.dailyDigestLog.update({
        where: { id: logId },
        data: {
          deliveryStatus: DeliveryStatus.SENT,
          errorMessage: null,
        },
      });
    } catch (err: unknown) {
      // Step 5: Failure log update
      const msg = err instanceof Error ? err.message : String(err);
      MonitoringService.captureException(err, {
        tags: { flow: "idempotent-digest-delivery" },
        extra: { userId, logId },
      });
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
