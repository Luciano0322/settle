import { MemorySaver } from "@langchain/langgraph";
import { expect, it } from "vitest";

import { createLangGraphExample } from "../../examples/langgraph/index.js";

it("lets LangGraph own node ordering and checkpoint reusable serialized Settle state", async () => {
  const executed: string[] = [];
  const graph = createLangGraphExample({
    checkpointer: new MemorySaver(),
    execute: async (input) => { executed.push(input); return `selected:${input}`; },
  });
  const config = { configurable: { thread_id: "reference" } };

  const first = await graph.invoke({ input: "a" }, config);
  const reused = await graph.invoke({ input: "a" }, config);
  const changed = await graph.invoke({ input: "b" }, config);

  expect(first.output).toBe("selected:a");
  expect(reused.output).toBe("selected:a");
  expect(changed.output).toBe("selected:b");
  expect(changed.visited).toEqual(["prepare", "evaluate", "finalize"]);
  expect(executed).toEqual(["a", "b"]);
  const state = await graph.getState(config);
  expect(JSON.parse(JSON.stringify(state.values))).toEqual(state.values);
  expect(Object.keys(state.values).sort()).toEqual(["input", "output", "snapshot", "visited"]);
});
