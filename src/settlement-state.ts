import type { SettlementExecutionError } from "./errors.js";
import type { SettlementRevision } from "./types.js";

export type RevisionState = {
  supersededBy?: SettlementRevision;
  unsatisfiedRequiredObligations: number;
  settlementWaiters: Set<() => void>;
  resourceFailures: Map<ReactiveResourceRegistration, SettlementExecutionError>;
};

export type ReactiveResourceRegistration = {
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
