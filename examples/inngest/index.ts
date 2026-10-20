import { Inngest } from "inngest";
import { createSettler, type SettlementSnapshot } from "@signal-kernel/settle";

export function createInngestExample(options: { execute(input: string): Promise<string> }) {
  const client = new Inngest({ id: "settle-reference" });

  async function evaluate(input: string, snapshot?: SettlementSnapshot) {
    const settler = createSettler<string>({ definition: { id: "inngest-reference", version: "1" }, now: () => 0 });
    const result = settler.resource({ id: "result", input: (value) => value, run: options.execute });
    try {
      if (snapshot) settler.restore(snapshot);
      const revision = settler.receive(input);
      if (result.required(revision)) await result.run(revision);
      await settler.settle(revision);
      return { output: result.emit()!, snapshot: settler.snapshot() };
    } finally {
      settler.dispose();
    }
  }

  // Inngest owns retries, memoization and step execution. No live settler crosses a step.
  return client.createFunction({
    id: "changing-input",
    triggers: { event: "settle/reference.requested" },
    retries: 2,
  }, async ({ event, step }) => {
    const data = event.data as { initialInput: string; nextInput: string };
    const initial = await step.run("initial", () => evaluate(data.initialInput));
    return step.run("next", () => evaluate(data.nextInput, initial.snapshot));
  });
}
