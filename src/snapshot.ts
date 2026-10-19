import { signal } from "@signal-kernel/core";
import {
  assertSnapshotDocument,
  captureSnapshot,
  createSnapshotScope,
  decodeJsonSnapshot,
  encodeJsonSnapshot,
  restoreSnapshot,
} from "@signal-kernel/snapshot";

import { SettlementSnapshotError } from "./errors.js";
import type { SettlementSnapshot, SettlerOptions } from "./types.js";

export type SettlementSnapshotState<Input, Candidate> = {
  version: 1;
  input?: Input;
  candidate?: Candidate;
  manualObligations: number;
  executionObligations: number;
  resources: ResourceSnapshotState[];
};

function withSnapshotErrors<Value>(operation: () => Value): Value {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof SettlementSnapshotError) throw cause;
    throw new SettlementSnapshotError(
      cause instanceof Error ? cause.message : "Invalid settlement snapshot",
      cause,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isObligationCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function assertState(
  value: unknown,
): asserts value is SettlementSnapshotState<unknown, unknown> {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isObligationCount(value.manualObligations) ||
    !isObligationCount(value.executionObligations) ||
    !Array.isArray(value.resources)
  ) {
    throw new SettlementSnapshotError(
      "Invalid settlement snapshot state or obligation counts",
    );
  }
  const ids = new Set<string>();
  for (const resource of value.resources) {
    if (
      !isRecord(resource) ||
      typeof resource.id !== "string" ||
      resource.id.length === 0 ||
      typeof resource.valid !== "boolean" ||
      ids.has(resource.id)
    ) {
      throw new SettlementSnapshotError("Invalid or duplicate snapshot resource identity");
    }
    ids.add(resource.id);
  }
}

export type ResourceSnapshotState = {
  id: string;
  valid: boolean;
  input?: unknown;
  candidate?: unknown;
};

function createScope(options: SettlerOptions) {
  if (options.definition === undefined) {
    throw new SettlementSnapshotError(
      "Snapshot operations require a settlement definition",
    );
  }
  return createSnapshotScope({
    graphId: options.definition.id,
    graphVersion: options.definition.version,
    now: options.now,
  });
}

export function captureSettlementSnapshot<Input, Candidate>(
  options: SettlerOptions,
  state: Omit<SettlementSnapshotState<Input, Candidate>, "version">,
): SettlementSnapshot {
  return withSnapshotErrors(() => {
    const scope = createScope(options);
    const captured = { ...state, version: 1 as const };
    assertState(captured);
    scope.signal("settle.state.v1", signal(captured));
    const snapshot = captureSnapshot(scope);
    assertSnapshotDocument(snapshot);
    return snapshot;
  });
}

export function readSettlementSnapshot<Input, Candidate>(
  options: SettlerOptions,
  snapshot: unknown,
  expectedResourceIds: readonly (string | undefined)[],
): SettlementSnapshotState<Input, Candidate> {
  return withSnapshotErrors(() => {
    const scope = createScope(options);
    const state = signal<unknown>(null);
    scope.signal("settle.state.v1", state);
    assertSnapshotDocument(snapshot);
    if (
      snapshot.nodes.length !== 1 ||
      snapshot.nodes[0]!.id !== "settle.state.v1" ||
      snapshot.nodes[0]!.kind !== "signal"
    ) {
      throw new SettlementSnapshotError(
        "Missing or incompatible settlement snapshot state",
      );
    }
    restoreSnapshot(scope, decodeJsonSnapshot(encodeJsonSnapshot(snapshot)));
    const restored = state.peek();
    assertState(restored);
    const resourceIds = new Set(restored.resources.map((resource) => resource.id));
    if (
      resourceIds.size !== expectedResourceIds.length ||
      expectedResourceIds.some((id) => id === undefined || !resourceIds.has(id))
    ) {
      throw new SettlementSnapshotError("Incompatible snapshot resource definitions");
    }
    return restored as SettlementSnapshotState<Input, Candidate>;
  });
}
