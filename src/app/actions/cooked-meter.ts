"use server";

import { auth } from "@/auth";
import { CookedMeterService, type CookedMeterState } from "@/lib/services/cooked-meter.service";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import type { ActionResult } from "@/lib/validation/schemas";

/**
 * Retrieve the current "Am I Cooked?" meter state for the logged-in user.
 *
 * Requirements: 6.1, 6.10
 */
export async function getCookedMeterStateAction(): Promise<ActionResult<CookedMeterState>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }

  try {
    const state = await CookedMeterService.getMeterState(session.user.id);
    return { success: true, data: state };
  } catch (err) {
    return { success: false, error: t("error.generic") };
  }
}
