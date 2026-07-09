import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { processUserWrapped, processDailyDigest } from "@/lib/inngest-functions";

// Export the Next.js API handler for Inngest background queue worker endpoints.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processUserWrapped, processDailyDigest],
});
