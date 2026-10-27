import { describe, expect, it, vi } from "vitest";

import { createSettler } from "@signal-kernel/settle";
import { deferred } from "./helpers/deferred.js";

describe("reactive resources", () => {
  it("reports invalid resources without executing application work", () => {
    const runB = vi.fn(async (input: string) => `B:${input}`);
    const runC = vi.fn(async (input: string) => `C:${input}`);
    const settler = createSettler<{ a: string; c: string }>();
    const b = settler.resource({
      input: (state) => state.a,
      run: runB,
    });
    const c = settler.resource({
      input: (state) => state.c,
      run: runC,
    });

    const revision = settler.receive({ a: "a1", c: "c1" });

    expect(b.required(revision)).toBe(true);
    expect(c.required(revision)).toBe(true);
    expect(runB).not.toHaveBeenCalled();
    expect(runC).not.toHaveBeenCalled();
  });

  it("commits a host-run resource and satisfies its validity obligation", async () => {
    const runB = vi.fn(async (input: string) => `B:${input}`);
    const settler = createSettler<{ a: string }>();
    const b = settler.resource({
      input: (state) => state.a,
      run: runB,
    });
    const revision = settler.receive({ a: "a1" });
    const settlement = settler.settle(revision);
    let settlementObserved = false;
    void settlement.then(() => {
      settlementObserved = true;
    });

    await Promise.resolve();
    expect(settlementObserved).toBe(false);
    expect(b.emit()).toBeUndefined();

    const submission = await b.run(revision);

    expect(runB).toHaveBeenCalledOnce();
    expect(runB).toHaveBeenCalledWith("a1", expect.any(Object));
    expect(submission?.status).toBe("committed");
    expect(b.emit()).toBe("B:a1");
    await expect(settlement).resolves.toEqual({
      status: "settled",
      revision,
    });
  });

  it("keeps function-valued candidates opaque during reactive commit", async () => {
    const candidate = vi.fn(() => "application behavior");
    const settler = createSettler<{ a: string }>();
    const resource = settler.resource({
      input: (state) => state.a,
      run: async () => candidate,
    });
    const revision = settler.receive({ a: "a1" });

    await resource.run(revision);

    expect(candidate).not.toHaveBeenCalled();
    expect(resource.emit()).toBe(candidate);
  });

  it("invalidates only changed dependencies and reuses other committed results", async () => {
    const runB = vi.fn(async (input: string) => `B:${input}`);
    const runC = vi.fn(async (input: string) => `C:${input}`);
    const settler = createSettler<{ a: string; c: string }>();
    const b = settler.resource({
      input: (state) => state.a,
      run: runB,
    });
    const c = settler.resource({
      input: (state) => state.c,
      run: runC,
    });
    const initialRevision = settler.receive({ a: "a1", c: "c1" });

    await Promise.all([b.run(initialRevision), c.run(initialRevision)]);
    await settler.settle(initialRevision);

    const revision = settler.receive({ a: "a2", c: "c1" });
    const settlement = settler.settle(revision);
    let settlementObserved = false;
    void settlement.then(() => {
      settlementObserved = true;
    });
    await Promise.resolve();

    expect(b.required(revision)).toBe(true);
    expect(c.required(revision)).toBe(false);
    expect(c.emit()).toBe("C:c1");
    expect(runB).toHaveBeenCalledTimes(1);
    expect(runC).toHaveBeenCalledTimes(1);
    expect(settlementObserved).toBe(false);

    await b.run(revision);

    expect(b.emit()).toBe("B:a2");
    expect(c.emit()).toBe("C:c1");
    expect(runB).toHaveBeenCalledTimes(2);
    expect(runC).toHaveBeenCalledTimes(1);
    await expect(settlement).resolves.toEqual({
      status: "settled",
      revision,
    });
  });

  it("rejects a late result from a superseded resource execution", async () => {
    const firstWork = deferred<string>();
    const secondWork = deferred<string>();
    const settler = createSettler<{ a: string }>();
    const b = settler.resource({
      input: (state) => state.a,
      run: (input) => (input === "a1" ? firstWork.promise : secondWork.promise),
    });
    const firstRevision = settler.receive({ a: "a1" });
    const firstRun = b.run(firstRevision);

    const secondRevision = settler.receive({ a: "a2" });
    const secondSettlement = settler.settle(secondRevision);
    firstWork.resolve("B:a1");

    await expect(firstRun).resolves.toMatchObject({
      status: "rejected",
      reason: "superseded",
      revision: firstRevision,
      supersededBy: secondRevision,
    });
    expect(b.emit()).toBeUndefined();

    const secondRun = b.run(secondRevision);
    secondWork.resolve("B:a2");

    await expect(secondRun).resolves.toMatchObject({ status: "committed" });
    expect(b.emit()).toBe("B:a2");
    await expect(secondSettlement).resolves.toEqual({
      status: "settled",
      revision: secondRevision,
    });
  });

  it("propagates downstream invalidation before releasing settlement", async () => {
    const runB = vi.fn(async (input: string) => `B:${input}`);
    const runDownstream = vi.fn(async (input: string | undefined) =>
      input === undefined ? "downstream:missing" : `downstream:${input}`,
    );
    const settler = createSettler<{ a: string }>();
    const b = settler.resource({
      input: (state) => state.a,
      run: runB,
    });
    const downstream = settler.resource({
      input: () => b.emit(),
      run: runDownstream,
    });
    const initialRevision = settler.receive({ a: "a1" });

    await b.run(initialRevision);
    await downstream.run(initialRevision);
    await settler.settle(initialRevision);

    const revision = settler.receive({ a: "a2" });
    const settlement = settler.settle(revision);
    let settlementObserved = false;
    void settlement.then(() => {
      settlementObserved = true;
    });

    expect(b.required(revision)).toBe(true);
    expect(downstream.required(revision)).toBe(true);
    expect(b.emit()).toBeUndefined();
    expect(downstream.emit()).toBeUndefined();

    await b.run(revision);
    await Promise.resolve();

    expect(b.emit()).toBe("B:a2");
    expect(downstream.required(revision)).toBe(true);
    expect(runDownstream).toHaveBeenCalledTimes(1);
    expect(settlementObserved).toBe(false);

    await downstream.run(revision);

    expect(downstream.emit()).toBe("downstream:B:a2");
    await expect(settlement).resolves.toEqual({
      status: "settled",
      revision,
    });
  });

  it("keeps exactly one resource obligation through repeated invalidation", async () => {
    const runB = vi.fn(async (input: string) => `B:${input}`);
    const settler = createSettler<{ a: string }>();
    const b = settler.resource({
      input: (state) => state.a,
      run: runB,
    });
    const firstRevision = settler.receive({ a: "a1" });
    const firstSettlement = settler.settle(firstRevision);
    const secondRevision = settler.receive({ a: "a2" });
    const secondSettlement = settler.settle(secondRevision);
    const revision = settler.receive({ a: "a3" });
    const settlement = settler.settle(revision);
    let settlementObserved = false;
    void settlement.then(() => {
      settlementObserved = true;
    });

    await expect(firstSettlement).resolves.toMatchObject({
      status: "superseded",
      supersededBy: secondRevision,
    });
    await expect(secondSettlement).resolves.toMatchObject({
      status: "superseded",
      supersededBy: revision,
    });
    await Promise.resolve();
    expect(settlementObserved).toBe(false);

    await b.run(revision);

    expect(runB).toHaveBeenCalledOnce();
    expect(runB).toHaveBeenCalledWith("a3", expect.any(Object));
    await expect(settlement).resolves.toEqual({
      status: "settled",
      revision,
    });
  });

  it("reuses a committed result when a JSON object input has equal content", async () => {
    const run = vi.fn(async (input: { query: string }) => `result:${input.query}`);
    const settler = createSettler<{ query: string; tone: string }>();
    const resource = settler.resource({
      input: (state) => ({ query: state.query }),
      run,
    });

    const first = settler.receive({ query: "q1", tone: "formal" });
    await resource.run(first);
    const second = settler.receive({ query: "q1", tone: "casual" });

    expect(resource.required(second)).toBe(false);
    expect(resource.emit()).toBe("result:q1");
    expect(run).toHaveBeenCalledOnce();
    await expect(settler.settle(second)).resolves.toMatchObject({ status: "settled" });
  });

  it("treats JSON object inputs with different key order as the same input", async () => {
    // 輸入加一個 flag，selector 依 flag 回傳 { a: 1, b: 2 } 或 { b: 2, a: 1 }
    // 第一次 run 之後，換 flag 再 receive，驗證 required 是 false、run 只被呼叫一次
    const run = vi.fn(async (input: {a: number; b: number}) => input.a + input.b);
    const settler = createSettler<{ reversed: boolean}>();
    const resource = settler.resource({
      input: (state) => (state.reversed ? { b: 2, a: 1 } : { a: 1, b: 2 }),
      run,
    });

    await resource.run(settler.receive({ reversed: false }));
    const reordered = settler.receive({ reversed: true });

    expect(resource.required(reordered)).toBe(false);
    expect(resource.emit()).toBe(3);
    expect(run).toHaveBeenCalledOnce();
  });

  it("recomputes a Map input whose contents changed even though both serialize to the same JSON", async () => {
    const run = vi.fn(async (input: Map<string, string>) => `result:${input.get("query")}`);
    const settler = createSettler<{ query: string }>();
    const resource = settler.resource({
      input: (state) => new Map([["query", state.query]]),
      run,
    });

    await resource.run(settler.receive({ query: "q1" }));
    const changed = settler.receive({ query: "q2" });

    expect(resource.required(changed)).toBe(true);
    expect(resource.emit()).toBeUndefined();

    await resource.run(changed);

    expect(resource.emit()).toBe("result:q2");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not traverse a cyclic input when its reference is unchanged", async () => {
    const cyclic: { value: string; self?: unknown } = { value: "a" };
    cyclic.self = cyclic;
    const run = vi.fn(async (input: typeof cyclic) => `result:${input.value}`);
    const settler = createSettler<{ tone: string }>();
    const resource = settler.resource({
      input: () => cyclic,
      run,
    });

    await resource.run(settler.receive({ tone: "formal" }));
    const second = settler.receive({ tone: "casual" });

    expect(resource.required(second)).toBe(false);
    expect(resource.emit()).toBe("result:a");
    expect(run).toHaveBeenCalledOnce();
    await expect(settler.settle(second)).resolves.toMatchObject({ status: "settled" });
  });

  it("compares inputs containing undefined properties by reference", async () => {
    const run = vi.fn(async (input: { q: string; filter: string | undefined }) => `result:${input.q}`);
    const settler = createSettler<{ q: string; tone: string }>();
    const resource = settler.resource({
      input: (state) => ({ q: state.q, filter: undefined }),
      run,
    });

    await resource.run(settler.receive({ q: "q1", tone: "formal" }));
    const second = settler.receive({ q: "q1", tone: "casual" });

    expect(resource.required(second)).toBe(true);

    await resource.run(second);

    expect(resource.emit()).toBe("result:q1");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
