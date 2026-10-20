import { describe, expect, it } from "vitest";

import {
  createSettler,
  SettlerDisposedError,
  SettlementExecutionError,
} from "@signal-kernel/settle";
import { deferred } from "./helpers/deferred.js";

describe("disposal", () => {
  it("keeps an observed execution failure stable across later disposal", async () => {
    const cause = new Error("host failure");
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: async () => { throw cause; },
    });
    const revision = settler.receive("input");
    const settlement = settler.settle(revision);
    void settlement.catch(() => {});
    const failure: unknown = await resource.run(revision).catch((error: unknown) => error);

    settler.dispose();

    await expect(settlement).rejects.toBe(failure);
    await expect(settler.settle(revision)).rejects.toBeInstanceOf(SettlerDisposedError);
  });

  it("revokes authority before host cancellation callbacks can submit", async () => {
    const work = deferred<string>();
    const settler = createSettler<string, string>();
    let reentrantSubmission: unknown;
    const resource = settler.resource({
      input: (input) => input,
      run: (_input, context) => {
        context.signal.addEventListener("abort", () => submitDuringCancellation?.());
        return work.promise;
      },
    });
    const revision = settler.receive("input");
    const execution = settler.associateExecution(revision);
    const submitDuringCancellation = () => {
      reentrantSubmission = execution.submit("reentrant candidate");
    };
    const run = resource.run(revision);

    settler.dispose();

    expect(reentrantSubmission).toMatchObject({ status: "rejected", reason: "disposed" });
    expect(settler.emit()).toBeUndefined();
    work.resolve("late candidate");
    await expect(run).resolves.toMatchObject({ status: "rejected", reason: "disposed" });
  });

  it("is idempotent and preserves outcomes of already completed settlement operations", async () => {
    const settler = createSettler<string>();
    const oldRevision = settler.receive("old");
    settler.require(oldRevision);
    const oldSettlement = settler.settle(oldRevision);
    const revision = settler.receive("current");
    const settled = settler.settle(revision);

    settler.dispose();
    expect(() => settler.dispose()).not.toThrow();

    await expect(oldSettlement).resolves.toEqual({
      status: "superseded", revision: oldRevision, supersededBy: revision,
    });
    await expect(settled).resolves.toEqual({ status: "settled", revision });
    await expect(settler.settle(oldRevision)).resolves.toMatchObject({ status: "superseded" });
    await expect(settler.settle(revision)).rejects.toBeInstanceOf(SettlerDisposedError);
    const unusedSettler = createSettler<string>();
    unusedSettler.dispose();
    expect(() => unusedSettler.dispose()).not.toThrow();
  });

  it("requests cancellation but rejects late results even when host work ignores it", async () => {
    const work = deferred<string>();
    const settler = createSettler<string>();
    let executionSignal: AbortSignal | undefined;
    const resource = settler.resource({
      input: (input) => input,
      run: (_input, context) => {
        executionSignal = context.signal;
        return work.promise;
      },
    });
    const revision = settler.receive("input");
    const execution = resource.run(revision);

    settler.dispose();

    expect(executionSignal?.aborted).toBe(true);
    work.resolve("ignored cancellation");
    await expect(execution).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
    expect(resource.emit()).toBeUndefined();
  });

  it("prevents new input, obligations, execution, and resources after disposal", async () => {
    let applicationRuns = 0;
    const settler = createSettler<string>();
    const descriptor = {
      input: (input: string) => input,
      run: async () => {
        applicationRuns += 1;
        return "candidate";
      },
    };
    const resource = settler.resource(descriptor);
    const revision = settler.receive("input");
    settler.dispose();

    expect(() => settler.receive("new input")).toThrow(SettlerDisposedError);
    expect(() => settler.require(revision)).toThrow(SettlerDisposedError);
    expect(() => settler.associateExecution(revision)).toThrow(SettlerDisposedError);
    expect(() => settler.resource(descriptor)).toThrow(SettlerDisposedError);
    await expect(resource.run(revision)).rejects.toBeInstanceOf(SettlerDisposedError);
    expect(applicationRuns).toBe(0);
  });

  it("rejects waiting settlement operations when their settler is disposed", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");
    settler.require(revision);
    const settlement = settler.settle(revision);
    let observedError: unknown;
    void settlement.catch((error: unknown) => {
      observedError = error;
    });

    settler.dispose();
    await Promise.resolve();

    expect(observedError).toMatchObject({ name: "SettlerDisposedError" });
    await expect(settler.settle(revision)).rejects.toMatchObject({
      name: "SettlerDisposedError",
    });
  });

  it("rejects a resource result that completes after disposal", async () => {
    const work = deferred<string>();
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: () => work.promise,
    });
    const revision = settler.receive("input");
    const execution = resource.run(revision);

    settler.dispose();
    work.resolve("late candidate");

    await expect(execution).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
      revision,
    });
    expect(resource.emit()).toBeUndefined();
  });

  it("revokes commit authority without replacing the last committed result", () => {
    const settler = createSettler<string, string>();
    const revision = settler.receive("input");
    settler.associateExecution(revision).submit("committed");
    const execution = settler.associateExecution(revision, {
      requiredForSettlement: true,
    });

    settler.dispose();
    const submission = execution.submit("late candidate");

    expect(submission).toEqual({
      status: "rejected",
      reason: "disposed",
      revision,
      execution: execution.identity,
    });
    expect(settler.emit()).toBe("committed");
  });
});

describe("superseded execution cleanup", () => {
  it("gives supersession precedence over a rejected Promise not yet observed by Settle", async () => {
    const work = deferred<string>();
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: () => work.promise,
    });
    const oldRevision = settler.receive("old");
    const run = resource.run(oldRevision);
    const settlement = settler.settle(oldRevision);

    work.reject(new Error("failure queued before receive"));
    const revision = settler.receive("current");

    await expect(run).resolves.toMatchObject({ status: "rejected", reason: "superseded" });
    await expect(settlement).resolves.toEqual({
      status: "superseded", revision: oldRevision, supersededBy: revision,
    });
  });

  it("does not restart superseded work or cancel the current host execution", async () => {
    const work = deferred<string>();
    const settler = createSettler<string>();
    const started: string[] = [];
    let currentSignal: AbortSignal | undefined;
    const resource = settler.resource({
      input: (input) => input,
      run: (input, context) => {
        started.push(input);
        currentSignal = context.signal;
        return work.promise;
      },
    });
    const oldRevision = settler.receive("old");
    const revision = settler.receive("current");
    const currentRun = resource.run(revision);

    const staleRun = resource.run(oldRevision);

    expect(started).toEqual(["current"]);
    expect(currentSignal?.aborted).toBe(false);
    await expect(staleRun).resolves.toMatchObject({ status: "rejected", reason: "superseded" });
    work.resolve("current result");
    await expect(currentRun).resolves.toMatchObject({ status: "committed" });
    expect(resource.emit()).toBe("current result");
  });

  it("settles the new revision without waiting for ignored cancellation or a late failure", async () => {
    const oldWork = deferred<string>();
    const settler = createSettler<string>();
    let oldSignal: AbortSignal | undefined;
    const resource = settler.resource({
      input: (input) => input,
      run: (input, context) => {
        if (input === "old") {
          oldSignal = context.signal;
          return oldWork.promise;
        }
        return Promise.resolve("current candidate");
      },
    });
    const oldRevision = settler.receive("old");
    const oldRun = resource.run(oldRevision);
    const oldSettlement = settler.settle(oldRevision);

    const revision = settler.receive("current");

    expect(oldSignal?.aborted).toBe(true);
    await resource.run(revision);
    await expect(settler.settle(revision)).resolves.toEqual({ status: "settled", revision });

    oldWork.reject(new Error("late failure"));
    await expect(oldRun).resolves.toMatchObject({ status: "rejected", reason: "superseded" });
    await expect(oldSettlement).resolves.toEqual({
      status: "superseded",
      revision: oldRevision,
      supersededBy: revision,
    });
    expect(resource.emit()).toBe("current candidate");
  });
});

describe("required resource failures", () => {
  it("does not clear another required resource's failure when one retry succeeds", async () => {
    const firstWork = deferred<string>();
    const secondWork = deferred<string>();
    let firstAttempt = firstWork.promise;
    let secondAttempt = secondWork.promise;
    const settler = createSettler<string>();
    const first = settler.resource({
      input: (input) => input,
      run: () => firstAttempt,
    });
    const second = settler.resource({
      input: (input) => input,
      run: () => secondAttempt,
    });
    const revision = settler.receive("input");
    const firstRun = first.run(revision);
    const secondRun = second.run(revision);
    firstWork.reject(new Error("first failure"));
    secondWork.reject(new Error("second failure"));
    await expect(firstRun).rejects.toBeInstanceOf(SettlementExecutionError);
    const secondFailure: unknown = await secondRun.catch((error: unknown) => error);

    firstAttempt = Promise.resolve("first recovered");
    await first.run(revision);

    await expect(settler.settle(revision)).rejects.toBe(secondFailure);
    secondAttempt = Promise.resolve("second recovered");
    await second.run(revision);
    await expect(settler.settle(revision)).resolves.toEqual({ status: "settled", revision });
  });

  it("preserves opaque thrown values and leaves retry decisions to the host", async () => {
    let causeInvocations = 0;
    let attempts = 0;
    const cause = () => { causeInvocations += 1; };
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: () => {
        attempts += 1;
        throw cause;
      },
    });
    const revision = settler.receive("input");

    const failure: unknown = await resource.run(revision).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SettlementExecutionError);
    expect((failure as SettlementExecutionError).cause).toBe(cause);
    await expect(settler.settle(revision)).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(causeInvocations).toBe(0);
  });

  it("ignores a late failure whose resource input changed within the same revision", async () => {
    const obsoleteWork = deferred<string>();
    const settler = createSettler<string>();
    const upstream = settler.resource({
      input: (input) => input,
      run: async (input) => input,
    });
    const downstream = settler.resource({
      input: () => upstream.emit(),
      run: (input) => input === undefined ? obsoleteWork.promise : Promise.resolve(`downstream:${input}`),
    });
    const revision = settler.receive("input");
    const obsoleteRun = downstream.run(revision);
    await upstream.run(revision);
    const settlement = settler.settle(revision);
    void settlement.catch(() => {});

    obsoleteWork.reject(new Error("obsolete input failed"));

    await expect(obsoleteRun).resolves.toBeUndefined();
    await downstream.run(revision);
    await expect(settlement).resolves.toEqual({ status: "settled", revision });
    expect(downstream.emit()).toBe("downstream:input");
  });

  it("stops treating a prior failure as current when upstream commit changes its input", async () => {
    const settler = createSettler<string>();
    const upstream = settler.resource({
      input: (input) => input,
      run: async (input) => input,
    });
    const downstream = settler.resource({
      input: () => upstream.emit(),
      run: async (input) => {
        if (input === undefined) {
          throw new Error("upstream unavailable");
        }
        return `downstream:${input}`;
      },
    });
    const initialRevision = settler.receive("first");
    await upstream.run(initialRevision);
    await downstream.run(initialRevision);
    const revision = settler.receive("second");
    await expect(downstream.run(revision)).rejects.toMatchObject({ name: "SettlementExecutionError" });

    await upstream.run(revision);
    const settlement = settler.settle(revision);
    let observed: unknown;
    void settlement.then(
      (outcome) => { observed = outcome; },
      (error: unknown) => { observed = error; },
    );
    await Promise.resolve();

    expect(observed).toBeUndefined();
    await downstream.run(revision);
    await expect(settlement).resolves.toEqual({ status: "settled", revision });
    expect(downstream.emit()).toBe("downstream:second");
  });

  it("does not report a replaced attempt's failure against its current retry", async () => {
    const oldWork = deferred<string>();
    const currentWork = deferred<string>();
    let nextWork = oldWork;
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: () => nextWork.promise,
    });
    const revision = settler.receive("input");
    const oldRun = resource.run(revision);
    nextWork = currentWork;
    const currentRun = resource.run(revision);
    const settlement = settler.settle(revision);
    void settlement.catch(() => {});

    oldWork.reject(new Error("obsolete attempt failed"));

    await expect(oldRun).resolves.toBeUndefined();
    currentWork.resolve("current candidate");
    await currentRun;
    await expect(settlement).resolves.toEqual({ status: "settled", revision });
    expect(resource.emit()).toBe("current candidate");
  });

  it("keeps a reported failure unchanged when a newer revision subsequently arrives", async () => {
    const work = deferred<string>();
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: (input) => input === "old" ? work.promise : Promise.resolve("current candidate"),
    });
    const oldRevision = settler.receive("old");
    const settlement = settler.settle(oldRevision);
    void settlement.catch(() => {});
    const execution = resource.run(oldRevision);
    work.reject(new Error("current failure"));
    const failure: unknown = await execution.catch((error: unknown) => error);

    const revision = settler.receive("current");
    await resource.run(revision);

    await expect(settlement).rejects.toBe(failure);
    await expect(settler.settle(oldRevision)).resolves.toEqual({
      status: "superseded", revision: oldRevision, supersededBy: revision,
    });
    await expect(settler.settle(revision)).resolves.toEqual({ status: "settled", revision });
  });

  it("lets an explicit host retry recover without changing an already rejected settlement", async () => {
    const firstWork = deferred<string>();
    const retryWork = deferred<string>();
    let nextWork = firstWork;
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: () => nextWork.promise,
    });
    const revision = settler.receive("input");
    const originalSettlement = settler.settle(revision);
    void originalSettlement.catch(() => {});
    const execution = resource.run(revision);
    firstWork.reject(new Error("first attempt failed"));
    const originalFailure: unknown = await execution.catch((error: unknown) => error);

    nextWork = retryWork;
    const retry = resource.run(revision);
    const settlement = settler.settle(revision);
    let observed: unknown;
    void settlement.then(
      (outcome) => { observed = outcome; },
      (error: unknown) => { observed = error; },
    );
    await Promise.resolve();

    expect(observed).toBeUndefined();
    expect(resource.required(revision)).toBe(true);
    retryWork.resolve("recovered candidate");
    await expect(retry).resolves.toMatchObject({ status: "committed" });
    await expect(settlement).resolves.toEqual({ status: "settled", revision });
    await expect(settler.settle(revision)).resolves.toEqual({ status: "settled", revision });
    await expect(originalSettlement).rejects.toBe(originalFailure);
    expect(resource.emit()).toBe("recovered candidate");
  });

  it("reports the same identified execution failure to run and waiting settlement", async () => {
    const work = deferred<string>();
    const cause = new Error("host work failed");
    const settler = createSettler<string>();
    const resource = settler.resource({
      input: (input) => input,
      run: () => work.promise,
    });
    const revision = settler.receive("input");
    const settlement = settler.settle(revision);
    void settlement.catch(() => {});
    const execution = resource.run(revision);

    work.reject(cause);
    const failure: unknown = await execution.catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "SettlementExecutionError",
      cause,
      revision,
      execution: expect.any(Object),
    });
    await expect(settlement).rejects.toBe(failure);
    await expect(settler.settle(revision)).rejects.toBe(failure);
    expect(resource.required(revision)).toBe(true);
    expect(resource.emit()).toBeUndefined();
  });
});
