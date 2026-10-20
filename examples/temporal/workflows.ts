import { proxyActivities } from "@temporalio/workflow";
import type { createTemporalActivityExample } from "./activities.js";

type Activities = { evaluate: ReturnType<typeof createTemporalActivityExample> };

/** Register evaluate on a host-owned Worker. Settle is never imported into Workflow code. */
export async function settleReferenceWorkflow(request: Parameters<Activities["evaluate"]>[0]) {
  const { evaluate } = proxyActivities<Activities>({
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 3 },
  });
  return evaluate(request);
}
