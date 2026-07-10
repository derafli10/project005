"use client";

import { useState, useTransition } from "react";
import { updateDigestSettingsAction, type DigestSettings } from "@/app/actions/digest";
import { DigestChannel } from "@/generated/prisma";

interface SettingsClientProps {
  initialSettings: DigestSettings;
}

/**
 * Settings Client Component.
 *
 * Provides a form for users to configure their Daily Digest preferences with:
 * - Toggle switch for enabling/disabling digest
 * - Time picker for digest delivery time (HH:MM format)
 * - Dropdown for delivery channel selection (WhatsApp/Telegram)
 * - Conditional contact info inputs based on selected channel
 *
 * Requirements: 13.1, 13.2
 */
export function SettingsClient({ initialSettings }: SettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [settings, setSettings] = useState<DigestSettings>(initialSettings);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await updateDigestSettingsAction(settings);
        if (result.success) {
          setMessage({ type: "success", text: "Settings saved successfully!" });
        } else {
          setMessage({ type: "error", text: "Failed to save settings. Please try again." });
        }
      } catch (error: any) {
        setMessage({
          type: "error",
          text: error.message || "An error occurred while saving settings.",
        });
      }
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Enable Digest Toggle */}
        <div className="flex items-start">
          <div className="flex items-center h-6">
            <input
              id="digestEnabled"
              type="checkbox"
              checked={settings.digestEnabled}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, digestEnabled: e.target.checked }))
              }
              className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
          </div>
          <div className="ml-3">
            <label htmlFor="digestEnabled" className="font-medium text-gray-900 cursor-pointer">
              Enable Daily Digest
            </label>
            <p className="text-sm text-gray-600 mt-1">
              Receive a daily summary of your pending tasks at your preferred time
            </p>
          </div>
        </div>

        {/* Digest Time Picker */}
        {settings.digestEnabled && (
          <>
            <div>
              <label htmlFor="digestTime" className="block text-sm font-medium text-gray-900 mb-2">
                Delivery Time
              </label>
              <input
                id="digestTime"
                type="time"
                value={settings.digestTime || ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, digestTime: e.target.value }))}
                required={settings.digestEnabled}
                className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Choose when you want to receive your daily digest (in your local time)
              </p>
            </div>

            {/* Delivery Channel Dropdown */}
            <div>
              <label
                htmlFor="deliveryChannel"
                className="block text-sm font-medium text-gray-900 mb-2"
              >
                Delivery Channel
              </label>
              <select
                id="deliveryChannel"
                value={settings.deliveryChannel}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    deliveryChannel: e.target.value as DigestChannel,
                  }))
                }
                className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={DigestChannel.WHATSAPP}>WhatsApp</option>
                <option value={DigestChannel.TELEGRAM}>Telegram</option>
              </select>
            </div>

            {/* WhatsApp Number Input */}
            {settings.deliveryChannel === DigestChannel.WHATSAPP && (
              <div>
                <label
                  htmlFor="whatsappNumber"
                  className="block text-sm font-medium text-gray-900 mb-2"
                >
                  WhatsApp Number
                </label>
                <input
                  id="whatsappNumber"
                  type="tel"
                  value={settings.whatsappNumber || ""}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, whatsappNumber: e.target.value }))
                  }
                  placeholder="+62812345678"
                  required={settings.digestEnabled && settings.deliveryChannel === DigestChannel.WHATSAPP}
                  className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Include country code (e.g., +62 for Indonesia)
                </p>
              </div>
            )}

            {/* Telegram Chat ID Input */}
            {settings.deliveryChannel === DigestChannel.TELEGRAM && (
              <div>
                <label
                  htmlFor="telegramChatId"
                  className="block text-sm font-medium text-gray-900 mb-2"
                >
                  Telegram Chat ID
                </label>
                <input
                  id="telegramChatId"
                  type="text"
                  value={settings.telegramChatId || ""}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, telegramChatId: e.target.value }))
                  }
                  placeholder="123456789"
                  required={settings.digestEnabled && settings.deliveryChannel === DigestChannel.TELEGRAM}
                  className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Get your chat ID by messaging @userinfobot on Telegram
                </p>
              </div>
            )}
          </>
        )}

        {/* Status Message */}
        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <button
            type="submit"
            disabled={isPending}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
