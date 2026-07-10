import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { baseDb } from "@/lib/db";
import { SettingsClient } from "./SettingsClient";

/**
 * Settings page — Server Component.
 *
 * Allows authenticated users to configure their Daily Digest preferences:
 * - Enable/disable daily digest notifications
 * - Set preferred delivery time (HH:MM format)
 * - Choose delivery channel (WhatsApp or Telegram)
 * - Provide contact information (phone number or chat ID)
 *
 * Requirements: 13.1, 13.2
 */
export default async function SettingsPage() {
  // Authorization gate
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  // Fetch current user digest settings
  const user = await baseDb.user.findUnique({
    where: { id: userId },
    select: {
      digestEnabled: true,
      digestTime: true,
      deliveryChannel: true,
      whatsappNumber: true,
      telegramChatId: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-gray-600 mb-8">Manage your daily digest preferences</p>

        <SettingsClient
          initialSettings={{
            digestEnabled: user.digestEnabled,
            digestTime: user.digestTime,
            deliveryChannel: user.deliveryChannel,
            whatsappNumber: user.whatsappNumber,
            telegramChatId: user.telegramChatId,
          }}
        />
      </div>
    </main>
  );
}
