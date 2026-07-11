"use server";

/**
 * Digest Settings Server Action.
 *
 * Persists the user's Daily Digest preferences including:
 * - digestEnabled: whether to receive daily digests
 * - digestTime: preferred time in HH:MM format (e.g., "21:00", "06:30")
 * - deliveryChannel: WHATSAPP or TELEGRAM
 * - whatsappNumber: required if deliveryChannel is WHATSAPP
 * - telegramChatId: required if deliveryChannel is TELEGRAM
 *
 * Requirements: 13.1, 13.2
 */

import { auth } from "@/auth";
import { baseDb } from "@/lib/db";
import { AuthenticationError, ValidationError } from "@/lib/errors/domain-errors";
import type { ActionResult } from "@/lib/validation/schemas";
import { DigestChannel } from "@/generated/prisma";

export interface DigestSettings {
  digestEnabled: boolean;
  digestTime: string | null;
  deliveryChannel: DigestChannel;
  whatsappNumber: string | null;
  telegramChatId: string | null;
}

/**
 * Validate HH:MM time format.
 */
function isValidTimeFormat(time: string): boolean {
  const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
  return timeRegex.test(time);
}

/**
 * Update digest settings for the signed-in user.
 *
 * @param settings The digest settings to persist.
 * @returns `ActionResult<DigestSettings>` — the persisted settings on success.
 */
export async function updateDigestSettingsAction(
  settings: DigestSettings
): Promise<ActionResult<DigestSettings>> {
  // 1. Authorise — only authenticated users can update preferences.
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthenticationError("You must be signed in to update digest settings");
  }
  const userId = session.user.id;

  // 2. Validate inputs
  if (settings.digestEnabled) {
    // If digest is enabled, digestTime is required
    if (!settings.digestTime) {
      throw new ValidationError("Digest time is required when digest is enabled", {
        field: "digestTime",
      });
    }

    // Validate time format (HH:MM)
    if (!isValidTimeFormat(settings.digestTime)) {
      throw new ValidationError("Digest time must be in HH:MM format (e.g., 21:00 or 06:30)", {
        field: "digestTime",
      });
    }

    // Validate delivery channel and contact info
    if (settings.deliveryChannel === DigestChannel.WHATSAPP) {
      if (!settings.whatsappNumber || settings.whatsappNumber.trim() === "") {
        throw new ValidationError("WhatsApp number is required for WhatsApp delivery", {
          field: "whatsappNumber",
        });
      }
    } else if (settings.deliveryChannel === DigestChannel.TELEGRAM) {
      if (!settings.telegramChatId || settings.telegramChatId.trim() === "") {
        throw new ValidationError("Telegram chat ID is required for Telegram delivery", {
          field: "telegramChatId",
        });
      }
    } else {
      throw new ValidationError("Invalid delivery channel", { field: "deliveryChannel" });
    }
  }

  // 3. Persist to the User record
  const updatedUser = await baseDb.user.update({
    where: { id: userId },
    data: {
      digestEnabled: settings.digestEnabled,
      digestTime: settings.digestEnabled ? settings.digestTime : null,
      deliveryChannel: settings.deliveryChannel,
      whatsappNumber: settings.whatsappNumber?.trim() || null,
      telegramChatId: settings.telegramChatId?.trim() || null,
    },
    select: {
      digestEnabled: true,
      digestTime: true,
      deliveryChannel: true,
      whatsappNumber: true,
      telegramChatId: true,
    },
  });

  return {
    success: true,
    data: {
      digestEnabled: updatedUser.digestEnabled,
      digestTime: updatedUser.digestTime,
      deliveryChannel: updatedUser.deliveryChannel,
      whatsappNumber: updatedUser.whatsappNumber,
      telegramChatId: updatedUser.telegramChatId,
    },
  };
}

/**
 * Verify a Telegram connection by sending a verification message.
 *
 * @param telegramChatId The chat ID to test.
 * @returns Success or error message.
 */
export async function verifyTelegramConnectionAction(
  telegramChatId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthenticationError("You must be signed in to verify Telegram connection");
  }

  if (!telegramChatId || telegramChatId.trim() === "") {
    return { success: false, error: "Telegram Chat ID is required" };
  }

  try {
    const { DailyDigestService } = await import("@/lib/services/daily-digest.service");
    // Send a simple verification test message to the user
    const testResult = await DailyDigestService.sendViaTelegram(
      telegramChatId.trim(),
      "✅ Project005: Telegram connection verified successfully!"
    );

    if (testResult.success) {
      return { success: true };
    } else {
      return { success: false, error: testResult.error || "Failed to deliver message" };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to connect to Telegram. Please make sure you have started a chat with the bot.",
    };
  }
}

