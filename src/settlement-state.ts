import type { SettlementExecutionError } from "./errors.js";
import type { SettlementResourceInspection, SettlementRevision } from "./types.js";
import type { ResourceSnapshotState } from "./snapshot.js";

export type RevisionState = {
  supersededBy?: SettlementRevision;
  unsatisfiedRequiredObligations: number;
  unsatisfiedManualObligations: number;
  unsatisfiedExecutionObligations: number;
  settlementWaiters: Set<() => void>;
  resourceFailures: Map<ReactiveResourceRegistration, SettlementExecutionError>;
};

export type ReactiveResourceRegistration = {
  id?: string;
  traceId: string;
  inspect(revision?: SettlementRevision): SettlementResourceInspection;
  snapshot(): ResourceSnapshotState;
  restore(state: ResourceSnapshotState, revision: SettlementRevision): void;
  rebind(): void;
  evaluate(revision: SettlementRevision): number;
  cancel(revision: SettlementRevision): void;
  dispose(): void;
};

export function wakeSettlementWaiters(state: RevisionState): void {
  for (const settle of state.settlementWaiters) {
    settle();
  }
  state.settlementWaiters.clear();
}

export function satisfyRequiredObligation(state: RevisionState): void {
  state.unsatisfiedRequiredObligations -= 1;

  if (state.unsatisfiedRequiredObligations === 0) {
    wakeSettlementWaiters(state);
  }
}
