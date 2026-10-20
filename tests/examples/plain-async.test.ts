import { expect, it } from "vitest";

import { runChangingInputExample } from "../../examples/plain-async/index.js";
import { deferred } from "../helpers/deferred.js";

it("lets the host finish new work first and rejects a late, domain-selected old candidate", async () => {
  const oldWork = deferred<string>();
  const newWork = deferred<string>();
  const report = runChangingInputExample({
    initialInput: "old", nextInput: "new",
    execute: (input) => input === "old" ? oldWork.promise : newWork.promise,
  });
  newWork.resolve("selected new candidate");
  oldWork.resolve("selected old candidate");

  const result = await report;

  expect(result.previousSettlement.status).toBe("superseded");
  expect(result.currentSettlement.status).toBe("settled");
  expect(result.previousSubmission).toMatchObject({ status: "rejected", reason: "superseded" });
  expect(result.currentSubmission.status).toBe("committed");
  expect(result.output).toBe("selected new candidate");
  expect(result.trace.filter((event) => event.type === "committed")).toHaveLength(1);
});
