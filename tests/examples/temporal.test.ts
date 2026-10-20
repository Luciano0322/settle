import { MockActivityEnvironment } from "@temporalio/testing";
import { expect, it } from "vitest";

import { createTemporalActivityExample } from "../../examples/temporal/activities.js";
import { deferred } from "../helpers/deferred.js";

it("runs Settle inside a real Temporal Activity context and transfers only serialized state", async () => {
  const executed: string[] = [];
  const activity = createTemporalActivityExample({
    execute: async (input) => { executed.push(input); return `selected:${input}`; },
  });
  const first = await new MockActivityEnvironment({ attempt: 1 })
    .run<Parameters<typeof activity>, Awaited<ReturnType<typeof activity>>, typeof activity>(activity, { input: "a" });
  const transferred = JSON.parse(JSON.stringify(first));
  const reused = await new MockActivityEnvironment({ attempt: 2 })
    .run<Parameters<typeof activity>, Awaited<ReturnType<typeof activity>>, typeof activity>(activity, { input: "a", snapshot: transferred.snapshot });

  expect(first.output).toBe("selected:a");
  expect(first.attempt).toBe(1);
  expect(reused.output).toBe("selected:a");
  expect(reused.attempt).toBe(2);
  expect(executed).toEqual(["a"]);
  expect(JSON.parse(JSON.stringify(reused))).toEqual(reused);
});

it("lets Temporal cancellation revoke local authority even when host work ignores abort", async () => {
  const started = deferred<AbortSignal>();
  const work = deferred<string>();
  const activity = createTemporalActivityExample({ execute: (_input, signal) => {
    started.resolve(signal);
    return work.promise;
  } });
  const environment = new MockActivityEnvironment();
  const outcome = environment.run(activity, { input: "a" }).catch((error: unknown) => error);
  const signal = await started.promise;

  environment.cancel();
  work.resolve("late candidate");

  expect(signal.aborted).toBe(true);
  expect(await outcome).toMatchObject({ name: "CancelledFailure" });
});
