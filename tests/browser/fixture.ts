import { createSettler } from "@signal-kernel/settle";
import { runChangingInputExample } from "../../examples/plain-async/index.js";

export async function runBrowserSmoke() {
  const changing = await runChangingInputExample({
    initialInput: "old", nextInput: "new", execute: async (input) => `selected:${input}`,
  });
  const options = { definition: { id: "browser-smoke", version: "1" }, now: () => 0 };
  const source = createSettler<string>(options);
  const result = source.resource({ id: "result", input: (input) => input, run: async (input) => input });
  await result.run(source.receive("browser value"));
  const target = createSettler<string>(options);
  let hostRuns = 0;
  const reused = target.resource({ id: "result", input: (input) => input, run: async () => { hostRuns += 1; return "unexpected work"; } });
  try {
    const restored = target.restore(JSON.parse(JSON.stringify(source.snapshot())));
    return {
      output: changing.output,
      previous: changing.previousSubmission.status,
      current: changing.currentSettlement.status,
      restored: reused.emit(),
      settlement: (await target.settle(restored.revision)).status,
      hostRuns,
    };
  } finally {
    source.dispose();
    target.dispose();
  }
}
