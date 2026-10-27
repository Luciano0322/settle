import { describe, expect, it, vi } from "vitest";
import { decodeJsonSnapshot, encodeJsonSnapshot } from "@signal-kernel/snapshot";

import { createSettler, SettlementRevisionError } from "@signal-kernel/settle";
import { deferred } from "./helpers/deferred.js";

type Trip = { date: string; budget: number };

function createTripSettler() {
  const settler = createSettler<Trip>();
  const run = vi.fn(async (date: string) => `flight@${date}`);
  const flight = settler.resource({ input: (trip) => trip.date, run });
  return { settler, flight, run };
}

describe("resource valueFor", () => {
  it("returns the committed value for the latest revision", async () => {
    const { settler, flight } = createTripSettler();
    const revision = settler.receive({ date: "10/01", budget: 3000 });
    await flight.run(revision);

    expect(flight.valueFor(revision)).toEqual({ status: "valid", revision, value: "flight@10/01" });
  });

  it("reports required before the first run and after the input changes", async () => {
    const { settler, flight } = createTripSettler();
    const first = settler.receive({ date: "10/01", budget: 3000 });

    expect(flight.valueFor(first)).toEqual({ status: "required", revision: first });

    await flight.run(first);
    const changed = settler.receive({ date: "10/05", budget: 3000 });

    expect(flight.valueFor(changed)).toEqual({ status: "required", revision: changed });
  });

  it("reports required while a run for the revision is still pending", async () => {
    const settler = createSettler<string>();
    const pending = deferred<string>();
    const resource = settler.resource({ input: (input) => input, run: () => pending.promise });
    const revision = settler.receive("input");

    const running = resource.run(revision);

    expect(resource.valueFor(revision)).toEqual({ status: "required", revision });

    pending.resolve("result");
    await running;

    expect(resource.valueFor(revision)).toEqual({ status: "valid", revision, value: "result" });
  });

  it("reports an older revision as superseded even when its value is still valid", async () => {
    const { settler, flight } = createTripSettler();
    const first = settler.receive({ date: "10/01", budget: 3000 });
    await flight.run(first);
    const second = settler.receive({ date: "10/01", budget: 2000 });
    const value = flight.valueFor(first);

    expect(value).toEqual({ status: "superseded", revision: first, supersededBy: second });
    // toEqual compares revisions structurally; their identity is what matters here.
    expect(value.revision).toBe(first);
    expect(value.status === "superseded" ? value.supersededBy : undefined).toBe(second);
  });

  it("reads a reused value through the newer revision without running again", async () => {
    const { settler, flight, run } = createTripSettler();
    await flight.run(settler.receive({ date: "10/01", budget: 3000 }));
    const second = settler.receive({ date: "10/01", budget: 2000 });
    const value = flight.valueFor(second);

    expect(value).toEqual({ status: "valid", revision: second, value: "flight@10/01" });
    expect(value.revision).toBe(second);
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not hand a newer revision's value to a caller holding a settled revision", async () => {
    const { settler, flight } = createTripSettler();
    const first = settler.receive({ date: "10/01", budget: 3000 });
    await flight.run(first);
    const settlement = settler.settle(first);
    const second = settler.receive({ date: "10/05", budget: 3000 });

    await expect(settlement).resolves.toMatchObject({ status: "settled" });

    await flight.run(second);

    expect(flight.emit()).toBe("flight@10/05");
    const value = flight.valueFor(first);
    expect(value.status).toBe("superseded");
    expect(value.status === "superseded" ? value.supersededBy : undefined).toBe(second);
  });

  it("reports disposed after the settler is disposed instead of throwing", async () => {
    const { settler, flight } = createTripSettler();
    const revision = settler.receive({ date: "10/01", budget: 3000 });
    await flight.run(revision);

    settler.dispose();

    expect(flight.valueFor(revision)).toEqual({ status: "disposed", revision });
  });

  it("rejects a revision from another settler", () => {
    const { flight } = createTripSettler();
    const foreign = createSettler<Trip>().receive({ date: "10/01", budget: 3000 });

    expect(() => flight.valueFor(foreign)).toThrow(SettlementRevisionError);
  });

  it("returns a reused value for the restored revision", async () => {
    const definition = { id: "value-for-tests", version: "1" };
    const source = createSettler<Trip>({ definition });
    const original = source.resource({ id: "flight", input: (trip) => trip.date, run: async (date) => `flight@${date}` });
    await original.run(source.receive({ date: "10/01", budget: 3000 }));
    const target = createSettler<Trip>({ definition });
    const restoredFlight = target.resource({ id: "flight", input: (trip) => trip.date, run: async () => "recomputed" });

    const restored = target.restore(decodeJsonSnapshot(encodeJsonSnapshot(source.snapshot())));

    expect(restoredFlight.valueFor(restored.revision)).toEqual({
      status: "valid",
      revision: restored.revision,
      value: "flight@10/01",
    });
  });
});
