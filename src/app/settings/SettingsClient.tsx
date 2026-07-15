"use client";

import { useState, useTransition } from "react";
import { updateDigestSettingsAction, verifyTelegramConnectionAction, type DigestSettings } from "@/app/actions/digest";
import { DigestChannel } from "@/generated/prisma";

interface SettingsClientProps {
  initialSettings: DigestSettings;
  botUsername: string;
  userEmail: string;
}

/**
 * Settings Client Component.
 *
 * Provides a form for users to configure their Daily Digest preferences with:
 * - Toggle switch for enabling/disabling digest
 * - Time picker for digest delivery time (HH:MM format)
 * - Dropdown for delivery channel selection (Email/Telegram)
 * - Conditional contact info inputs based on selected channel
 * - Premium Telegram connection linking and status verification flow
 *
 * Requirements: 13.1, 13.2
 */
export function SettingsClient({ initialSettings, botUsername, userEmail }: SettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [settings, setSettings] = useState<DigestSettings>(initialSettings);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Telegram verification flow state
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const handleVerifyTelegram = async () => {
    if (!settings.telegramChatId || settings.telegramChatId.trim() === "") {
      setVerifyStatus({ type: "error", text: "Please enter your Chat ID first." });
      return;
    }

    setVerifying(true);
    setVerifyStatus(null);

    try {
      const res = await verifyTelegramConnectionAction(settings.telegramChatId);
      if (res.success) {
        setVerifyStatus({
          type: "success",
          text: "Connection verified! A test message has been sent to your Telegram.",
        });
      } else {
        setVerifyStatus({
          type: "error",
          text: res.error || "Failed to verify connection. Make sure you started the chat with the bot.",
        });
      }
    } catch (err: any) {
      setVerifyStatus({
        type: "error",
        text: err.message || "An unexpected error occurred during verification.",
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 md:p-8 max-w-2xl mx-auto transition-all duration-300 hover:shadow-lg">
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Enable Digest Toggle */}
        <div className="flex items-start bg-gray-50/50 p-4 rounded-xl border border-gray-100/80">
          <div className="flex items-center h-6">
            <input
              id="digestEnabled"
              type="checkbox"
              checked={settings.digestEnabled}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, digestEnabled: e.target.checked }))
              }
              className="w-5 h-5 text-blue-600 bg-white border-gray-300 rounded-lg focus:ring-blue-500 focus:ring-2 cursor-pointer transition"
            />
          </div>
          <div className="ml-4">
            <label htmlFor="digestEnabled" className="font-semibold text-gray-800 cursor-pointer text-base">
              Enable Daily Digest
            </label>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              Receive an automated, highly-tailored daily summary of your pending tasks and recent updates at your preferred time.
            </p>
          </div>
        </div>

        {/* Digest Settings (Time and Channel) */}
        {settings.digestEnabled && (
          <div className="space-y-6 pt-2 animate-fade-in">
            {/* Delivery Time Input */}
            <div className="flex flex-col">
              <label htmlFor="digestTime" className="text-sm font-semibold text-gray-700 mb-2">
                Delivery Time
              </label>
              <input
                id="digestTime"
                type="time"
                value={settings.digestTime || ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, digestTime: e.target.value }))}
                required={settings.digestEnabled}
                className="block w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800 transition"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Set when you want to receive your digest (formatted as HH:MM).
              </p>
            </div>

            {/* Delivery Channel Selector */}
            <div className="flex flex-col">
              <label htmlFor="deliveryChannel" className="text-sm font-semibold text-gray-700 mb-2">
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
                className="block w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800 bg-white cursor-pointer transition"
              >
                <option value={DigestChannel.EMAIL}>📧 Email</option>
                <option value={DigestChannel.TELEGRAM}>✈️ Telegram</option>
              </select>
            </div>

            {/* Email Channel Info */}
            {settings.deliveryChannel === DigestChannel.EMAIL && (
              <div className="space-y-2 p-4 bg-emerald-50/30 rounded-xl border border-emerald-100/50 animate-slide-down">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 block">Email Delivery</span>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Your daily digest will be sent to your registered email address:
                </p>
                <p className="text-sm font-semibold text-gray-800 bg-white px-3 py-2 rounded-lg border border-gray-200 inline-block">
                  {userEmail}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  To change your email address, update it from your account settings.
                </p>
              </div>
            )}

            {/* Telegram Chat Link and ID Verification Flow */}
            {settings.deliveryChannel === DigestChannel.TELEGRAM && (
              <div className="space-y-4 p-4 bg-blue-50/30 rounded-xl border border-blue-100/50 animate-slide-down">
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-600 block">Telegram Connection Flow</span>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    1. Direct message our bot <a href={`https://t.me/${botUsername}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">@{botUsername}</a> and type <code className="bg-blue-50 px-1.5 py-0.5 rounded text-blue-700 font-mono text-xs">/start</code>.
                  </p>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    2. Query your unique Chat ID by chatting with <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">@userinfobot</a>.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="telegramChatId" className="text-sm font-semibold text-gray-700 block">
                    Telegram Chat ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="telegramChatId"
                      type="text"
                      value={settings.telegramChatId || ""}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, telegramChatId: e.target.value }))
                      }
                      placeholder="e.g. 123456789"
                      required={settings.digestEnabled && settings.deliveryChannel === DigestChannel.TELEGRAM}
                      className="block flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-800 transition"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyTelegram}
                      disabled={verifying}
                      className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 font-semibold rounded-xl text-sm transition disabled:opacity-50 flex items-center justify-center min-w-[90px]"
                    >
                      {verifying ? "Verifying..." : "Verify"}
                    </button>
                  </div>
                </div>

                {verifyStatus && (
                  <div
                    className={`p-3 rounded-lg text-sm transition ${
                      verifyStatus.type === "success"
                        ? "bg-green-50 text-green-800 border border-green-200"
                        : "bg-red-50 text-red-800 border border-red-200"
                    }`}
                  >
                    {verifyStatus.text}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Global Save Status Message */}
        {message && (
          <div
            className={`p-4 rounded-xl border transition ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border-green-100"
                : "bg-red-50 text-red-800 border-red-100"
            }`}
          >
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        )}

        {/* Submit Action Button */}
        <div className="flex justify-end pt-4 border-t border-gray-100">
          <button
            type="submit"
            disabled={isPending}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition duration-200 shadow-sm focus:ring-4 focus:ring-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Saving..." : "Save Settings"}
          </button>
        </div>

      </form>
    </div>
  );
}
