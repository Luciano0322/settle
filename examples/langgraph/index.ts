import { Annotation, END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { createSettler, type SettlementSnapshot } from "@signal-kernel/settle";

const State = Annotation.Root({
  input: Annotation<string>(),
  output: Annotation<string>(),
  snapshot: Annotation<SettlementSnapshot>(),
  visited: Annotation<string[]>(),
});

export function createLangGraphExample(options: {
  execute(input: string): Promise<string>;
  checkpointer?: BaseCheckpointSaver;
}) {
  // The host defines topology, node execution, thread identity, and checkpoint policy.
  return new StateGraph(State)
    .addNode("prepare", () => ({ visited: ["prepare"] }))
    .addNode("evaluate", async (state) => {
      const settler = createSettler<string>({ definition: { id: "langgraph-reference", version: "1" }, now: () => 0 });
      const result = settler.resource({ id: "result", input: (input) => input, run: options.execute });
      try {
        if (state.snapshot) settler.restore(state.snapshot);
        const revision = settler.receive(state.input);
        if (result.required(revision)) await result.run(revision);
        const outcome = await settler.settle(revision);
        if (outcome.status !== "settled") throw new Error("Host invocation was superseded");
        return { output: result.emit()!, snapshot: settler.snapshot(), visited: [...state.visited, "evaluate"] };
      } finally {
        settler.dispose();
      }
    })
    .addNode("finalize", (state) => ({ visited: [...state.visited, "finalize"] }))
    .addEdge(START, "prepare")
    .addEdge("prepare", "evaluate")
    .addEdge("evaluate", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: options.checkpointer });
}
