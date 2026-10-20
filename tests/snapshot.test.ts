import { describe, expect, it } from "vitest";
import { signal } from "@signal-kernel/core";
import { decodeJsonSnapshot, encodeJsonSnapshot, isJsonValue } from "@signal-kernel/snapshot";

import { createSettler, SettlementSnapshotError, type SettlementResource, type SettlementSnapshot } from "@signal-kernel/settle";
import { deferred } from "./helpers/deferred.js";

const definition = { id: "snapshot-tests", version: "1" };

describe("snapshot and restore", () => {
  it("rejects an invalid injected timestamp instead of returning a non-JSON snapshot", () => {
    const source = createSettler<string>({ definition, now: () => Number.NaN });
    source.receive("input");

    expect(() => source.snapshot()).toThrow(SettlementSnapshotError);
  });

  it("requires an explicit definition and stable IDs to opt into snapshot continuity", () => {
    const withoutDefinition = createSettler<string>();
    withoutDefinition.receive("input");
    expect(() => withoutDefinition.snapshot()).toThrow(SettlementSnapshotError);
    const unnamedResource = createSettler<string>({ definition });
    unnamedResource.resource({ input: (input) => input, run: async (input) => input });
    unnamedResource.receive("input");
    expect(() => unnamedResource.snapshot()).toThrow(SettlementSnapshotError);
  });

  it("preserves a satisfied resource whose input and accepted result are undefined", async () => {
    const source = createSettler<undefined>({ definition });
    const original = source.resource({ id: "optional-value", input: () => undefined, run: async () => undefined });
    await original.run(source.receive(undefined));
    const target = createSettler<undefined>({ definition });
    const result = target.resource({ id: "optional-value", input: () => undefined, run: async () => undefined });

    const restored = target.restore(source.snapshot());

    expect(result.required(restored.revision)).toBe(false);
    await expect(target.settle(restored.revision)).resolves.toMatchObject({ status: "settled" });
  });

  it("restores a failed resource as an unsatisfied condition without carrying its live error", async () => {
    const source = createSettler<string>({ definition });
    const original = source.resource({
      id: "result", input: (input) => input,
      run: async () => { throw new Error("source execution failed"); },
    });
    const revision = source.receive("input");
    await expect(original.run(revision)).rejects.toThrow();
    const snapshot = source.snapshot();
    expect(isJsonValue(snapshot)).toBe(true);
    const target = createSettler<string>({ definition });
    const result = target.resource({ id: "result", input: (input) => input, run: async () => "recovered" });

    const restored = target.restore(snapshot);
    const settlement = target.settle(restored.revision);

    expect(result.required(restored.revision)).toBe(true);
    await result.run(restored.revision);
    await expect(settlement).resolves.toMatchObject({ status: "settled" });
    expect(result.emit()).toBe("recovered");
  });

  it("requires a fresh target and leaves an active instance's authority unchanged", () => {
    const source = createSettler<string, string>({ definition });
    source.receive("snapshot input");
    const snapshot = source.snapshot();
    const target = createSettler<string, string>({ definition });
    const revision = target.receive("active input");
    const execution = target.associateExecution(revision);

    expect(() => target.restore(snapshot)).toThrow(SettlementSnapshotError);

    expect(execution.submit("active candidate").status).toBe("committed");
    expect(target.emit()).toBe("active candidate");
  });

  it.each([
    ["Promise", Promise.resolve("live")],
    ["AbortController", new AbortController()],
    ["callback", () => "live"],
  ])("rejects a live %s payload instead of silently dropping it", (_label, value) => {
    const source = createSettler<unknown>({ definition });
    source.receive(value);

    expect(() => source.snapshot()).toThrow(SettlementSnapshotError);
  });

  it("respects an explicitly configured input comparator when deciding restored reuse", async () => {
    type Input = { key: { value: string } };
    const source = createSettler<Input>({ definition });
    const original = source.resource({
      id: "result", input: (input) => input.key, equals: Object.is,
      run: async (input) => input.value,
    });
    await original.run(source.receive({ key: { value: "result" } }));
    const target = createSettler<Input>({ definition });
    const resource = target.resource({
      id: "result", input: (input) => input.key, equals: Object.is,
      run: async (input) => input.value,
    });

    const restored = target.restore(source.snapshot());

    expect(resource.required(restored.revision)).toBe(true);
    await resource.run(restored.revision);
    await expect(target.settle(restored.revision)).resolves.toMatchObject({ status: "settled" });
  });

  it("stabilizes restored downstream invalidation independently of resource registration order", async () => {
    const dependency = signal("first");
    const source = createSettler<string>({ definition });
    const parent = source.resource({ id: "parent", input: () => dependency.get(), run: async (input) => input });
    const child = source.resource({ id: "child", input: () => parent.emit(), run: async (input) => `child:${input}` });
    const grandchild = source.resource({ id: "grandchild", input: () => child.emit(), run: async (input) => `grandchild:${input}` });
    const revision = source.receive("input");
    await parent.run(revision);
    await child.run(revision);
    await grandchild.run(revision);
    const snapshot = source.snapshot();
    dependency.set("second");
    const target = createSettler<string>({ definition });
    const restoredGrandchild = target.resource({ id: "grandchild", input: () => restoredChild.emit(), run: async (input) => `grandchild:${input}` });
    const restoredChild: SettlementResource<string> = target.resource({ id: "child", input: () => restoredParent.emit(), run: async (input) => `child:${input}` });
    const restoredParent: SettlementResource<string> = target.resource({ id: "parent", input: () => dependency.get(), run: async (input) => input });

    const restored = target.restore(snapshot);

    expect(restoredParent.required(restored.revision)).toBe(true);
    expect(restoredChild.required(restored.revision)).toBe(true);
    expect(restoredGrandchild.required(restored.revision)).toBe(true);
    expect(restoredGrandchild.emit()).toBeUndefined();
    await restoredParent.run(restored.revision);
    await restoredChild.run(restored.revision);
    await restoredGrandchild.run(restored.revision);
    await expect(target.settle(restored.revision)).resolves.toMatchObject({ status: "settled" });
    expect(restoredGrandchild.emit()).toBe("grandchild:child:second");
  });

  it("does not reuse a resource when a dependency outside restored input has changed", async () => {
    const dependency = signal("first");
    const source = createSettler<string>({ definition });
    const original = source.resource({ id: "result", input: () => dependency.get(), run: async (input) => input });
    await original.run(source.receive("unchanged input"));
    const snapshot = source.snapshot();
    dependency.set("second");
    const target = createSettler<string>({ definition });
    const result = target.resource({ id: "result", input: () => dependency.get(), run: async (input) => input });

    const restored = target.restore(snapshot);

    expect(result.required(restored.revision)).toBe(true);
    expect(result.emit()).toBeUndefined();
    await result.run(restored.revision);
    await expect(target.settle(restored.revision)).resolves.toMatchObject({ status: "settled" });
    expect(result.emit()).toBe("second");
  });

  it("continues selective invalidation after restoring resources by stable ID", async () => {
    type Input = { a: string; c: string };
    const source = createSettler<Input>({ definition });
    const originalB = source.resource({ id: "b", input: (input) => input.a, run: async (input) => `b:${input}` });
    const originalC = source.resource({ id: "c", input: (input) => input.c, run: async (input) => `c:${input}` });
    const revision = source.receive({ a: "first", c: "unchanged" });
    await Promise.all([originalB.run(revision), originalC.run(revision)]);
    const target = createSettler<Input>({ definition });
    const c = target.resource({ id: "c", input: (input) => input.c, run: async (input) => `c:${input}` });
    const b = target.resource({ id: "b", input: (input) => input.a, run: async (input) => `b:${input}` });
    target.restore(source.snapshot());

    const current = target.receive({ a: "second", c: "unchanged" });

    expect(b.required(current)).toBe(true);
    expect(c.required(current)).toBe(false);
    expect(c.emit()).toBe("c:unchanged");
    await b.run(current);
    await expect(target.settle(current)).resolves.toMatchObject({ status: "settled" });
    expect(b.emit()).toBe("b:second");
  });

  it("preserves stable snapshot identities and an injected clock across restores", async () => {
    const options = { definition, now: () => 1234 };
    const source = createSettler<string>({ ...options });
    const original = source.resource({ id: "stable-resource", input: (input) => input, run: async (input) => input });
    await original.run(source.receive("input"));
    const snapshot = source.snapshot();
    const first = createSettler<string>(options);
    const second = createSettler<string>(options);
    first.resource({ id: "stable-resource", input: (input) => input, run: async (input) => input });
    second.resource({ id: "stable-resource", input: (input) => input, run: async (input) => input });

    const firstRestore = first.restore(snapshot);
    const secondRestore = second.restore(snapshot);

    expect(snapshot.createdAt).toBe(1234);
    expect(firstRestore.revision).not.toBe(secondRestore.revision);
    expect(first.snapshot()).toEqual(snapshot);
    expect(second.snapshot()).toEqual(snapshot);
  });

  it("does not restore a manually committed result from a superseded causal revision", () => {
    const source = createSettler<string, string>({ definition });
    const oldRevision = source.receive("old");
    source.associateExecution(oldRevision).submit("obsolete result");
    source.receive("current");
    const target = createSettler<string, string>({ definition });

    target.restore(source.snapshot());

    expect(target.emit()).toBeUndefined();
  });

  it("rejects duplicate resource identities when defining a restorable instance", () => {
    const settler = createSettler<string>({ definition });
    const descriptor = { id: "result", input: (input: string) => input, run: async (input: string) => input };
    settler.resource(descriptor);

    expect(() => settler.resource(descriptor)).toThrow(SettlementSnapshotError);
  });

  it.each([
    ["schema", (snapshot: SettlementSnapshot) => ({ ...snapshot, schema: "unsupported" })],
    ["definition", (snapshot: SettlementSnapshot) => ({ ...snapshot, graph: { ...snapshot.graph, id: "different" } })],
    ["version", (snapshot: SettlementSnapshot) => ({ ...snapshot, graph: { ...snapshot.graph, version: "2" } })],
  ] as const)("rejects incompatible %s before changing the target", (_label, corrupt) => {
    const source = createSettler<string>({ definition });
    source.receive("input");
    const snapshot = source.snapshot();
    const target = createSettler<string>({ definition });

    expect(() => target.restore(corrupt(snapshot))).toThrow(SettlementSnapshotError);
    expect(() => target.restore(snapshot)).not.toThrow();
  });

  it("rejects invalid obligation counts before they can disappear during restore", () => {
    const source = createSettler<string>({ definition });
    source.require(source.receive("input"));
    const snapshot = source.snapshot();
    const node = snapshot.nodes[0]!;
    if (node.kind !== "signal" || node.value === null || typeof node.value !== "object" || Array.isArray(node.value)) {
      throw new Error("Expected the captured settlement signal");
    }
    const corrupted = {
      ...snapshot,
      nodes: [{ ...node, value: { ...node.value, manualObligations: -1 } }],
    };
    const target = createSettler<string>({ definition });

    expect(() => target.restore(corrupted)).toThrow(SettlementSnapshotError);
    expect(target.restore(snapshot).manualObligations).toHaveLength(1);
  });

  it("rejects a mismatched resource set before initializing the target", () => {
    const source = createSettler<string>({ definition });
    source.resource({ id: "required", input: (input) => input, run: async (input) => input });
    source.receive("input");
    const snapshot = source.snapshot();
    const target = createSettler<string>({ definition });

    expect(() => target.restore(snapshot)).toThrow(SettlementSnapshotError);

    const resource = target.resource({ id: "required", input: (input) => input, run: async (input) => input });
    const restored = target.restore(snapshot);
    expect(resource.required(restored.revision)).toBe(true);
  });

  it("rejects a missing settlement state instead of restoring an empty settled revision", () => {
    const source = createSettler<string>({ definition });
    source.receive("input");
    const snapshot = source.snapshot();
    const target = createSettler<string>({ definition });

    expect(() => target.restore({ ...snapshot, nodes: [] })).toThrow(/snapshot state/i);
    expect(() => target.restore(snapshot)).not.toThrow();
  });

  it("rebuilds required executions with fresh provenance and commit-only satisfaction", async () => {
    const source = createSettler<string, string>({ definition });
    const revision = source.receive("input");
    const oldExecution = source.associateExecution(revision, { requiredForSettlement: true });
    const target = createSettler<string, string>({ definition });

    const restored = target.restore(source.snapshot());

    expect(restored.executionObligations).toHaveLength(1);
    const settlement = target.settle(restored.revision);
    let settled = false;
    void settlement.then(() => { settled = true; });
    oldExecution.submit("original candidate");
    const obligation = restored.executionObligations[0]!;
    const execution = obligation.associateExecution();
    expect(execution.identity).not.toBe(oldExecution.identity);
    expect(execution.revision).toBe(restored.revision);
    expect(obligation.associateExecution()).toBe(execution);
    await Promise.resolve();
    expect(settled).toBe(false);
    execution.submit("restored candidate");
    await expect(settlement).resolves.toMatchObject({ status: "settled" });
    expect(target.emit()).toBe("restored candidate");
  });

  it("reconstructs manual obligations as new idempotent host handles", async () => {
    const source = createSettler<string>({ definition });
    const revision = source.receive("input");
    const oldObligation = source.require(revision);
    const target = createSettler<string>({ definition });

    const restored = target.restore(source.snapshot());

    expect(restored.manualObligations).toHaveLength(1);
    const settlement = target.settle(restored.revision);
    let settled = false;
    void settlement.then(() => { settled = true; });
    oldObligation.satisfy();
    await Promise.resolve();
    expect(settled).toBe(false);
    restored.manualObligations[0]!.satisfy();
    restored.manualObligations[0]!.satisfy();
    await expect(settlement).resolves.toMatchObject({ status: "settled" });
  });

  it("restores pending resources as obligations without live work or automatic execution", async () => {
    const oldWork = deferred<string>();
    const source = createSettler<string>({ definition });
    const original = source.resource({
      id: "result",
      input: (input) => input,
      run: () => oldWork.promise,
    });
    const originalRevision = source.receive("input");
    const oldRun = original.run(originalRevision);
    const snapshot = source.snapshot();
    expect(isJsonValue(snapshot)).toBe(true);
    let hostRuns = 0;
    const target = createSettler<string>({ definition });
    const result = target.resource({
      id: "result",
      input: (input) => input,
      run: async () => { hostRuns += 1; return "restored candidate"; },
    });

    const restored = target.restore(snapshot);
    const settlement = target.settle(restored.revision);
    let settled = false;
    void settlement.then(() => { settled = true; });
    await Promise.resolve();

    expect(hostRuns).toBe(0);
    expect(result.required(restored.revision)).toBe(true);
    expect(settled).toBe(false);
    oldWork.resolve("pre-restore candidate");
    await oldRun;
    expect(result.emit()).toBeUndefined();

    await result.run(restored.revision);
    await expect(settlement).resolves.toMatchObject({ status: "settled" });
    expect(result.emit()).toBe("restored candidate");
  });

  it("reuses a restored resource with object-valued input without executing host work", async () => {
    type Input = { dependency: { value: string } };
    const source = createSettler<Input>({ definition });
    const original = source.resource({
      id: "result",
      input: (input) => input.dependency,
      run: async (input) => `result:${input.value}`,
    });
    const revision = source.receive({ dependency: { value: "first" } });
    await original.run(revision);
    await source.settle(revision);
    const snapshot = source.snapshot();
    let hostRuns = 0;
    const target = createSettler<Input>({ definition });
    const restoredResource = target.resource({
      id: "result",
      input: (input) => input.dependency,
      run: async (input) => {
        hostRuns += 1;
        return `result:${input.value}`;
      },
    });

    const restored = target.restore(snapshot);

    expect(restoredResource.emit()).toBe("result:first");
    expect(restoredResource.required(restored.revision)).toBe(false);
    await expect(target.settle(restored.revision)).resolves.toMatchObject({ status: "settled" });
    expect(hostRuns).toBe(0);
  });

  it("isolates mutable values in the source, snapshot, and two restored instances", () => {
    const source = createSettler<string, { values: string[] }>({ definition });
    const revision = source.receive("input");
    source.associateExecution(revision).submit({ values: ["original"] });
    const snapshot = source.snapshot();
    const first = createSettler<string, { values: string[] }>({ definition });
    const second = createSettler<string, { values: string[] }>({ definition });
    first.restore(snapshot);
    second.restore(snapshot);

    first.emit()!.values.push("first instance only");

    expect(second.emit()).toEqual({ values: ["original"] });
    expect(source.emit()).toEqual({ values: ["original"] });
    const third = createSettler<string, { values: string[] }>({ definition });
    third.restore(snapshot);
    expect(third.emit()).toEqual({ values: ["original"] });
  });

  it("restores settled observable state across JSON transfer into a new instance", async () => {
    const source = createSettler<string, { result: string }>({ definition });
    const revision = source.receive("input");
    source.associateExecution(revision).submit({ result: "committed" });
    await source.settle(revision);

    const snapshot = decodeJsonSnapshot(encodeJsonSnapshot(source.snapshot()));
    const target = createSettler<string, { result: string }>({ definition });
    const restored = target.restore(snapshot);

    expect(restored.revision).not.toBe(revision);
    expect(target.emit()).toEqual({ result: "committed" });
    await expect(target.settle(restored.revision)).resolves.toEqual({
      status: "settled",
      revision: restored.revision,
    });
  });
});
