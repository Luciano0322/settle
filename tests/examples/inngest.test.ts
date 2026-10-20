import { InngestTestEngine } from "@inngest/test";
import { expect, it } from "vitest";

import { createInngestExample } from "../../examples/inngest/index.js";

it("reconstructs Settle inside each real Inngest step and reuses unchanged selected input", async () => {
  const executed: string[] = [];
  const fn = createInngestExample({
    execute: async (input) => { executed.push(input); return `selected:${input}`; },
  });
  const engine = new InngestTestEngine({ function: fn });

  const { result, error } = await engine.execute({ events: [{
    name: "settle/reference.requested", data: { initialInput: "a", nextInput: "a" },
  }] });

  expect(error).toBeUndefined();
  expect(result).toMatchObject({ output: "selected:a" });
  expect(executed).toEqual(["a"]);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

it("leaves retry to the host and accepts a host-memoized successful step on the next attempt", async () => {
  const executed: string[] = [];
  let fail = true;
  const fn = createInngestExample({ execute: async (input) => {
    executed.push(input);
    if (input === "b" && fail) throw new Error("transient host failure");
    return `selected:${input}`;
  } });
  const events: [{ name: string; data: { initialInput: string; nextInput: string } }] = [{ name: "settle/reference.requested", data: { initialInput: "a", nextInput: "b" } }];
  const engine = new InngestTestEngine({ function: fn });
  const first = await engine.execute({ events });
  expect(first.error).toBeDefined();
  expect(executed).toEqual(["a", "b"]); // Settle did not retry the failed callback.
  const checkpoint = (await engine.executeStep("initial", { events })).result;
  expect(JSON.parse(JSON.stringify(checkpoint))).toEqual(checkpoint);

  fail = false;
  // The official engine models the platform's stored step output at this external seam.
  const retried = await engine.execute({ events, steps: [{ id: "initial", handler: () => checkpoint }] });

  expect(retried.error).toBeUndefined();
  expect(retried.result).toMatchObject({ output: "selected:b" });
  expect(executed).toEqual(["a", "b", "a", "b"]);
});
