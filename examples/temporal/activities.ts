import { activityInfo, CancelledFailure, Context } from "@temporalio/activity";
import { createSettler } from "@signal-kernel/settle";

export function createTemporalActivityExample(options: {
  execute(input: string, signal: AbortSignal): Promise<string>;
}) {
  return async function evaluate(request: { input: string; snapshot?: unknown }) {
    const settler = createSettler<string>({ definition: { id: "temporal-activity-reference", version: "1" }, now: () => 0 });
    const result = settler.resource({
      id: "result", input: (input) => input,
      run: (input, context) => options.execute(input, context.signal),
    });
    const context = Context.current();
    const cancel = () => settler.dispose();
    context.cancellationSignal.addEventListener("abort", cancel, { once: true });
    try {
      if (context.cancellationSignal.aborted) throw new CancelledFailure("Activity already cancelled");
      const perform = async () => {
        if (request.snapshot !== undefined) settler.restore(request.snapshot);
        const revision = settler.receive(request.input);
        if (result.required(revision)) await result.run(revision);
        await settler.settle(revision);
        return { output: result.emit()!, snapshot: settler.snapshot(), attempt: activityInfo().attempt };
      };
      return await Promise.race([perform(), context.cancelled]);
    } finally {
      context.cancellationSignal.removeEventListener("abort", cancel);
      settler.dispose();
    }
  };
}
