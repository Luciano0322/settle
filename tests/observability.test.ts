import { describe, expect, it } from "vitest";

import { createSettler, SettlementRevisionError, type SettlementRevision, type SettlementTraceEvent } from "@signal-kernel/settle";
import { deferred } from "./helpers/deferred.js";

describe("trace and inspection", () => {
  it("gives repeated subscriptions independent notification and unsubscribe lifetimes", () => {
    const settler = createSettler<string>();
    const delivered: SettlementTraceEvent[] = [];
    const listener = (event: SettlementTraceEvent) => { delivered.push(event); };
    const first = settler.subscribe(listener);
    const second = settler.subscribe(listener);

    settler.receive("both subscriptions");
    expect(delivered).toHaveLength(2);
    first();
    first();
    settler.receive("second subscription only");
    expect(delivered).toHaveLength(3);
    second();
    settler.receive("no subscriptions");
    expect(delivered).toHaveLength(3);
  });

  it("never commits a replaced resource attempt across host-completion microtask interleavings", async () => {
    for (let yields = 0; yields < 10; yields += 1) {
      const oldWork = deferred<string>();
      const newWork = deferred<string>();
      let attempts = 0;
      const settler = createSettler<string>();
      const resource = settler.resource({
        input: (input) => input,
        run: () => ++attempts === 1 ? oldWork.promise : newWork.promise,
      });
      const revision = settler.receive("input");
      const oldRun = resource.run(revision);
      oldWork.resolve("old");
      for (let index = 0; index < yields; index += 1) await Promise.resolve();
      // Only replace attempts that have not yet made a result observable.
      if (resource.emit() !== undefined) { await oldRun; continue; }
      const newRun = resource.run(revision);
      newWork.resolve("new");
      await expect(oldRun).resolves.toBeUndefined();
      await expect(newRun).resolves.toMatchObject({ status: "committed" });
      expect(resource.emit()).toBe("new");
      expect(settler.trace().filter((event) => event.type === "committed")).toHaveLength(1);
    }
  });

  it("returns immutable trace snapshots and uses deterministic logical time by default", () => {
    const settler = createSettler<string, string>();
    const revision = settler.receive("input");
    settler.associateExecution(revision).submit("private payload");
    const history = settler.trace();
    expect(history.map((event) => event.timestamp)).toEqual([1, 2, 3]);
    expect(Reflect.set(history, "0", {})).toBe(false);
    expect(Reflect.set(history[0]!, "sequence", 999)).toBe(false);
    settler.receive("next");
    expect(history).toHaveLength(3);
    expect(settler.trace().length).toBeGreaterThan(history.length);
    expect(JSON.stringify(history)).not.toContain("private payload");
  });

  it("traces downstream invalidation caused by a committed dependency without executing it", async () => {
    const settler = createSettler<string>();
    const upstream = settler.resource({ id: "upstream", input: (input) => input, run: async (input) => input });
    let downstreamRuns = 0;
    const downstream = settler.resource({
      id: "downstream", input: () => upstream.emit(),
      run: async (input) => { downstreamRuns += 1; return input; },
    });
    const initial = settler.receive("a");
    await upstream.run(initial);
    await downstream.run(initial);
    const revision = settler.receive("b");
    await upstream.run(revision);

    expect(settler.trace()).toContainEqual(expect.objectContaining({
      type: "invalidated", subject: "resource", resourceId: "downstream", revision, reason: "dependency-changed",
    }));
    expect(downstreamRuns).toBe(1);
    expect(downstream.required(revision)).toBe(true);
  });

  it("traces disposal as an operational settlement error, not revision supersession", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");
    settler.require(revision);
    const waiting = settler.settle(revision);
    void waiting.catch(() => { });
    settler.dispose();
    await expect(waiting).rejects.toMatchObject({ name: "SettlerDisposedError" });
    await expect(settler.settle(revision)).rejects.toMatchObject({ name: "SettlerDisposedError" });
    const failed = settler.trace().filter((event) => event.type === "failed" && event.subject === "settlement");
    expect(failed).toHaveLength(2);
    expect(failed.every((event) => event.reason === "disposed")).toBe(true);
    expect(settler.trace().some((event) => event.type === "superseded")).toBe(false);
  });

  it("reproduces ordered trace identities and timestamps with an injected clock", async () => {
    async function scenario() {
      let time = 100;
      const settler = createSettler<string, string>({ now: () => time++ });
      const revision = settler.receive("old");
      const execution = settler.associateExecution(revision, { requiredForSettlement: true });
      const settlement = settler.settle(revision);
      settler.receive("new");
      execution.submit("late");
      await settlement;
      return { trace: settler.trace(), currentId: settler.inspect().revisionId };
    }
    const first = await scenario();
    const second = await scenario();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.trace.slice(0, 3).map(({ id, sequence, timestamp, version }) => ({ id, sequence, timestamp, version }))).toEqual([
      { id: "event:1", sequence: 1, timestamp: 100, version: 1 },
      { id: "event:2", sequence: 2, timestamp: 101, version: 1 },
      { id: "event:3", sequence: 3, timestamp: 102, version: 1 },
    ]);
    expect(first.trace.filter((event) => event.supersededBy !== undefined)
      .every((event) => event.supersededByRevisionId === first.currentId)).toBe(true);
  });

  it("keeps generated resource trace identities distinct from host-supplied IDs", () => {
    const settler = createSettler<string>();
    const descriptor = { input: (input: string) => input, run: async () => "candidate" };
    settler.resource({ ...descriptor, id: "resource:2" });
    settler.resource(descriptor);
    settler.receive("input");

    expect(new Set(settler.inspect().resources.map((resource) => resource.id)).size).toBe(2);
    expect(new Set(settler.trace().filter((event) => event.type === "invalidated").map((event) => event.resourceId)).size).toBe(2);
    const generated = settler.inspect().resources[1]!.id;
    expect(() => settler.resource({ ...descriptor, id: generated })).toThrow("Resource IDs must be non-empty and unique");
  });

  it("keeps reusable resource provenance tied to its producing revision", async () => {
    const settler = createSettler<string>();
    const resource = settler.resource({ id: "answer", input: (input) => input, run: async () => "candidate" });
    const original = settler.receive("same input");
    const outcome = await resource.run(original);
    const current = settler.receive("same input");

    const inspection = settler.inspect();
    expect(inspection.revision).toBe(current);
    expect(inspection.resources[0]?.revision).toBe(original);
    expect(inspection.resources[0]?.execution).toBe(outcome?.execution);
    expect(inspection.resources[0]?.revisionId).not.toBe(inspection.revisionId);
    expect(inspection.resources[0]?.status).toBe("valid");
  });

  it("notifies revision changes without replaying history or letting observer exceptions affect state", () => {
    const settler = createSettler<string>();
    settler.receive("before subscription");
    const delivered: SettlementTraceEvent[] = [];
    settler.subscribe(() => { throw new Error("observer failure"); });
    const unsubscribe = settler.subscribe((event) => delivered.push(event));
    expect(delivered).toHaveLength(0);

    const revision = settler.receive("after subscription");

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ type: "changed", subject: "revision" });
    expect(delivered[0]?.revision).toBe(revision);
    expect(settler.inspect().revision).toBe(revision);
    unsubscribe();
    settler.receive("unsubscribed");
    expect(delivered).toHaveLength(1);
  });

  it("rejects foreign revision provenance at entry without manufacturing candidate authority", async () => {
    const source = createSettler<string>();
    const foreign = source.receive("source");
    const target = createSettler<string, string>();
    const resource = target.resource({ input: (input) => input, run: async () => "unexpected work" });
    const revision = target.receive("target");

    expect(() => target.associateExecution(foreign)).toThrow(SettlementRevisionError);
    expect(() => target.require(foreign)).toThrow(SettlementRevisionError);
    await expect(target.settle(foreign)).rejects.toBeInstanceOf(SettlementRevisionError);
    await expect(resource.run(foreign)).rejects.toBeInstanceOf(SettlementRevisionError);
    const rejections = target.trace().filter((event) => event.reason === "provenance-mismatch");
    expect(rejections).toHaveLength(4);
    expect(rejections.every((event) => event.subject === "revision" && event.revision === foreign && event.execution === undefined)).toBe(true);
    expect(target.inspect().revision).toBe(revision);
    expect(target.inspect().obligations.required).toBe(1);
    expect(target.emit()).toBeUndefined();
  });

  it("observes restore only after obligations and resource validity have been reconstructed", async () => {
    const options = { definition: { id: "trace-restore", version: "1" }, now: () => 10 };
    const source = createSettler<string>(options);
    const descriptor = { id: "answer", input: (input: string) => input, run: async (input: string) => input };
    const resource = source.resource(descriptor);
    const original = source.receive("input");
    source.require(original);
    source.associateExecution(original, { requiredForSettlement: true });
    await resource.run(original);
    const target = createSettler<string>(options);
    target.resource(descriptor);
    const observed: unknown[] = [];
    target.subscribe(() => {
      observed.push({ required: target.inspect().obligations.required, status: target.inspect().resources[0]?.status });
    });

    const restored = target.restore(source.snapshot());

    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((state) => JSON.stringify(state) === JSON.stringify({ required: 2, status: "valid" }))).toBe(true);
    expect(target.trace()).toContainEqual(expect.objectContaining({
      type: "restored", subject: "revision", revision: restored.revision,
    }));
    expect(target.trace()).toContainEqual(expect.objectContaining({
      type: "reused", subject: "resource", resourceId: "answer", reason: "restored-state",
    }));
    expect(target.inspect().committed).toBeUndefined();
  });

  it("traces operational failure and explicit recovery without logging opaque error payloads", async () => {
    const cause = { secret: "host-only failure details" };
    let fail = true;
    const settler = createSettler<string>();
    const resource = settler.resource({
      id: "answer", input: (input) => input,
      run: async () => { if (fail) throw cause; return "recovered"; },
    });
    const revision = settler.receive("input");
    const settlement = settler.settle(revision);
    void settlement.catch(() => { });
    const failure: unknown = await resource.run(revision).catch((error: unknown) => error);
    await expect(settlement).rejects.toBe(failure);

    const failed = settler.trace().filter((event) => event.type === "failed");
    expect(failed.map((event) => event.subject)).toEqual(["execution", "settlement"]);
    expect(failed.every((event) => event.reason === "execution-failed")).toBe(true);
    expect(settler.inspect().resources[0]).toMatchObject({ status: "failed", execution: failed[0]?.execution });
    expect(JSON.stringify(settler.trace())).not.toContain(cause.secret);
    fail = false;
    await resource.run(revision);
    await expect(settler.settle(revision)).resolves.toMatchObject({ status: "settled" });
    expect(settler.inspect().resources[0]?.status).toBe("valid");
  });

  it("finishes resource commit and validity propagation before notifying a reentrant listener", async () => {
    const work = deferred<string>();
    const settler = createSettler<string>();
    const resource = settler.resource({ id: "answer", input: (input) => input, run: () => work.promise });
    const revision = settler.receive("old");
    const settlement = settler.settle(revision);
    let observed: unknown;
    const delivered: SettlementTraceEvent[] = [];
    settler.subscribe((event) => {
      delivered.push(event);
      if (event.type === "completed") {
        observed = { value: resource.emit(), required: settler.inspect().obligations.required };
        settler.receive("new");
      }
    });
    const run = resource.run(revision);
    expect(delivered.some((event) => event.type === "started" && event.subject === "execution")).toBe(true);
    work.resolve("committed resource");
    await expect(run).resolves.toMatchObject({ status: "committed" });

    expect(observed).toEqual({ value: "committed resource", required: 0 });
    await expect(settlement).resolves.toMatchObject({ status: "settled" });
    const committedIndex = delivered.findIndex((event) => event.type === "committed");
    expect(delivered.findIndex((event) => event.type === "settled")).toBeGreaterThan(committedIndex);
    expect(resource.emit()).toBeUndefined();
    expect(resource.required(settler.inspect().revision!)).toBe(true);
  });

  it("delivers trace notifications after atomic manual commit, even when a listener receives new input", async () => {
    const settler = createSettler<string, string>();
    const revision = settler.receive("old");
    const execution = settler.associateExecution(revision, { requiredForSettlement: true });
    const settlement = settler.settle(revision);
    let observed: unknown;
    let next: SettlementRevision | undefined;
    const delivered: SettlementTraceEvent[] = [];
    settler.subscribe((event) => {
      if (event.type === "completed") {
        observed = { candidate: settler.emit(), required: settler.inspect().obligations.required };
        next = settler.receive("new");
      }
    });
    const unsubscribe = settler.subscribe((event) => delivered.push(event));

    const result = execution.submit("committed before notification");

    expect(observed).toEqual({ candidate: "committed before notification", required: 0 });
    expect(result.status).toBe("committed");
    await expect(settlement).resolves.toMatchObject({ status: "settled" });
    expect(settler.inspect().revision).toBe(next);
    expect(delivered.map((event) => event.sequence)).toEqual([...delivered.map((event) => event.sequence)].sort((a, b) => a - b));
    const committedIndex = delivered.findIndex((event) => event.type === "committed");
    const settledIndex = delivered.findIndex((event) => event.type === "settled");
    expect(committedIndex).toBeGreaterThanOrEqual(0);
    expect(settledIndex).toBeGreaterThan(committedIndex);
    unsubscribe();
    unsubscribe();
    const count = delivered.length;
    settler.settle(next!);
    expect(delivered).toHaveLength(count);
  });

  it("offers detached, read-only obligation and resource inspection with no commit authority", async () => {
    const work = deferred<string>();
    const settler = createSettler<string, { value: string }>();
    const resource = settler.resource({ id: "answer", input: (input) => input, run: () => work.promise });
    const revision = settler.receive("input");
    const manual = settler.require(revision);
    const execution = settler.associateExecution(revision, { requiredForSettlement: true });
    const before = settler.inspect();
    expect(before.revision).toBe(revision);
    expect(before.obligations).toEqual({ required: 3, manual: 1, executions: 1, resources: 1 });
    expect(before.resources[0]).toMatchObject({ id: "answer", required: true, status: "required" });
    expect(Reflect.set(before.obligations, "required", 0)).toBe(false);
    expect(Reflect.set(before.resources[0]!, "required", false)).toBe(false);
    expect("submit" in before).toBe(false);
    expect("satisfy" in before.resources[0]!).toBe(false);
    const run = resource.run(revision);
    expect(settler.inspect().resources[0]?.status).toBe("pending");
    manual.satisfy();
    const candidate = { value: "opaque host payload" };
    execution.submit(candidate);
    work.resolve("resource result");
    await run;

    const after = settler.inspect();
    expect(after.obligations.required).toBe(0);
    expect(after.resources[0]?.status).toBe("valid");
    expect(after.committed?.execution).toBe(execution.identity);
    expect("candidate" in after).toBe(false);
    expect(Object.isFrozen(candidate)).toBe(false);
    expect(before.obligations.required).toBe(3);
    expect(before.resources[0]?.status).toBe("required");
    settler.dispose();
    expect(settler.inspect()).toMatchObject({ disposed: true, resources: [{ id: "answer", status: "disposed" }] });
  });

  it("explains resource invalidation, reuse, and host-driven recomputation without starting work", async () => {
    let runs = 0;
    const settler = createSettler<{ key: string; unrelated: number }>();
    const resource = settler.resource({
      id: "answer", input: (input) => input.key,
      run: async (key) => { runs += 1; return `answer:${key}`; },
    });
    const first = settler.receive({ key: "a", unrelated: 0 });
    await resource.run(first);
    const reused = settler.receive({ key: "a", unrelated: 1 });
    await settler.settle(reused);
    const changed = settler.receive({ key: "b", unrelated: 1 });
    expect(runs).toBe(1);
    await resource.run(changed);

    const events = settler.trace().filter((event) => event.subject === "resource");
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "invalidated", revision: first, resourceId: "answer", reason: "uninitialized" }),
      expect.objectContaining({ type: "reused", revision: reused, resourceId: "answer", reason: "unchanged-input" }),
      expect.objectContaining({ type: "invalidated", revision: changed, resourceId: "answer", reason: "input-changed" }),
      expect.objectContaining({ type: "recomputed", revision: changed, resourceId: "answer", reason: "input-changed" }),
    ]));
    expect(runs).toBe(2);
  });

  it("explains same-revision replacement as revoked execution authority, not stale input", async () => {
    const oldWork = deferred<string>();
    const newWork = deferred<string>();
    let attempts = 0;
    const settler = createSettler<string>();
    const resource = settler.resource({
      id: "answer", input: (input) => input,
      run: () => ++attempts === 1 ? oldWork.promise : newWork.promise,
    });
    const revision = settler.receive("input");
    const oldRun = resource.run(revision);
    const newRun = resource.run(revision);
    newWork.resolve("current");
    const current = await newRun;
    oldWork.resolve("replaced");
    await expect(oldRun).resolves.toBeUndefined();

    const supersession = settler.trace().find((event) => event.type === "superseded" && event.subject === "execution");
    expect(supersession).toMatchObject({ reason: "revoked-authority", revision });
    expect(supersession?.supersededByExecution).toBe(current?.execution);
    const oldEvents = settler.trace().filter((event) => event.execution === supersession?.execution);
    expect(oldEvents[oldEvents.length - 1]).toMatchObject({ type: "rejected", reason: "revoked-authority" });
    expect(oldEvents.some((event) => event.type === "committed")).toBe(false);
    expect(settler.trace().filter((event) => event.subject === "execution" && event.execution === current?.execution).map((event) => event.type))
      .toEqual(["started", "completed", "committed"]);
    expect(resource.emit()).toBe("current");
  });

  it("distinguishes cancellation requests, supersession, and late resource completion", async () => {
    const work = deferred<string>();
    const settler = createSettler<string>();
    const resource = settler.resource({ id: "answer", input: (input) => input, run: () => work.promise });
    const revision = settler.receive("old");
    const run = resource.run(revision);
    const next = settler.receive("new");
    work.resolve("late result despite cancellation");
    const outcome = await run;
    const events = settler.trace().filter((event) => event.execution === outcome?.execution);

    expect(events.map((event) => event.type)).toEqual([
      "started", "superseded", "cancelled", "completed", "rejected",
    ]);
    expect(events.every((event) => event.revision === revision && event.resourceId === "answer")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ reason: "stale-revision", supersededBy: next });
    expect(resource.emit()).toBeUndefined();
  });

  it("distinguishes execution authority loss from each revision-scoped settlement outcome", async () => {
    const settler = createSettler<string, string>();
    const revision = settler.receive("old");
    const execution = settler.associateExecution(revision, { requiredForSettlement: true });
    const first = settler.settle(revision);
    const second = settler.settle(revision);
    const next = settler.receive("new");
    await Promise.all([first, second, settler.settle(next)]);

    const supersessions = settler.trace().filter((event) => event.type === "superseded");
    expect(supersessions.filter((event) => event.subject === "execution"))
      .toEqual([expect.objectContaining({ execution: execution.identity, revision, supersededBy: next })]);
    const operations = supersessions.filter((event) => event.subject === "settlement");
    expect(operations).toHaveLength(2);
    expect(new Set(operations.map((event) => event.settlementId)).size).toBe(2);
    expect(operations.every((event) => event.revision === revision && event.supersededBy === next)).toBe(true);
    expect(settler.trace()).toContainEqual(expect.objectContaining({
      type: "settled", subject: "settlement", revision: next,
    }));
  });

  it("records causal rejection reasons without treating completion as commit", () => {
    const settler = createSettler<string, string>();
    const oldRevision = settler.receive("old");
    const stale = settler.associateExecution(oldRevision);
    const currentRevision = settler.receive("current");
    stale.submit("late");
    const disposed = settler.associateExecution(currentRevision);
    settler.dispose();
    disposed.submit("after disposal");

    const staleEvents = settler.trace().filter((event) => event.execution === stale.identity);
    expect(staleEvents.slice(-2).map(({ type, reason }) => ({ type, reason }))).toEqual([
      { type: "completed", reason: undefined },
      { type: "rejected", reason: "stale-revision" },
    ]);
    expect(staleEvents[staleEvents.length - 1]?.supersededBy).toBe(currentRevision);
    expect(settler.trace().filter((event) => event.execution === disposed.identity).slice(-1)[0])
      .toMatchObject({ type: "rejected", reason: "disposed" });
    expect(settler.trace().some((event) => event.type === "committed")).toBe(false);
    expect(settler.emit()).toBeUndefined();
  });

  it("identifies the execution and causal revision of a completed, committed candidate", () => {
    const settler = createSettler<string, string>();
    const revision = settler.receive("input");
    const execution = settler.associateExecution(revision);

    execution.submit("domain-selected candidate");

    expect(settler.trace()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "completed", subject: "execution", revision, execution: execution.identity,
      }),
      expect.objectContaining({
        type: "committed", subject: "execution", revision, execution: execution.identity,
      }),
    ]));
    const events = settler.trace().filter((event) => event.execution === execution.identity);
    expect(events.map((event) => event.type)).toEqual(["completed", "committed"]);
    expect(events[0]?.executionId).toBe(events[1]?.executionId);
    expect(events[0]?.revisionId).toBe(events[1]?.revisionId);
  });
});
