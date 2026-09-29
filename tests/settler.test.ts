import { describe, expect, it } from "vitest";

import { createSettler } from "@signal-kernel/settle";
import { deferred } from "./helpers/deferred.js";

describe("causal revisions", () => {
  it("creates a distinct causal revision for each received input", () => {
    const settler = createSettler<string>();

    const firstRevision = settler.receive("first input");
    const secondRevision = settler.receive("second input");

    expect(secondRevision).not.toBe(firstRevision);
  });
});

describe("revision-scoped settlement", () => {
  it("settles the caller-selected revision when no obligations are required", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");

    await expect(settler.settle(revision)).resolves.toEqual({
      status: "settled",
      revision,
    });
  });
});

describe("required obligations", () => {
  it("keeps a revision pending while a required obligation is unsatisfied", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");

    settler.require(revision);
    const outcome = settler.settle(revision);
    let outcomeObserved = false;
    void outcome.then(() => {
      outcomeObserved = true;
    });

    await Promise.resolve();

    expect(outcomeObserved).toBe(false);
  });

  it("settles an existing operation when its obligation is satisfied", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");
    const obligation = settler.require(revision);
    const outcome = settler.settle(revision);

    obligation.satisfy();

    await expect(outcome).resolves.toEqual({
      status: "settled",
      revision,
    });
  });

  it("remains pending until every required obligation is satisfied", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");
    const firstObligation = settler.require(revision);
    const secondObligation = settler.require(revision);
    const outcome = settler.settle(revision);

    firstObligation.satisfy();
    firstObligation.satisfy();
    let outcomeObserved = false;
    void outcome.then(() => {
      outcomeObserved = true;
    });

    await Promise.resolve();

    expect(outcomeObserved).toBe(false);

    secondObligation.satisfy();
    await expect(outcome).resolves.toEqual({
      status: "settled",
      revision,
    });
  });

  it("does not wait for host activity that is not a required obligation", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");
    const optionalHostActivity = deferred<void>();
    let hostActivityCompleted = false;
    void optionalHostActivity.promise.then(() => {
      hostActivityCompleted = true;
    });

    await expect(settler.settle(revision)).resolves.toEqual({
      status: "settled",
      revision,
    });
    expect(hostActivityCompleted).toBe(false);
  });

  it("never executes application work while evaluating settlement", async () => {
    let applicationExecutionCount = 0;
    const applicationExecution = () => {
      applicationExecutionCount += 1;
    };
    const settler = createSettler<typeof applicationExecution>();
    const revision = settler.receive(applicationExecution);
    const obligation = settler.require(revision);
    const outcome = settler.settle(revision);

    obligation.satisfy();
    await outcome;

    expect(applicationExecutionCount).toBe(0);
  });
});
