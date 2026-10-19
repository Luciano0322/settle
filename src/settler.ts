import { batch, signal } from "@signal-kernel/core";

import { SettlerDisposedError } from "./errors.js";
import { createSettlementResource } from "./resource.js";
import {
  satisfyRequiredObligation,
  wakeSettlementWaiters,
  type ReactiveResourceRegistration,
  type RevisionState,
} from "./settlement-state.js";
import type {
  ExecutionIdentity,
  SettlementOutcome,
  SettlementResource,
  SettlementResourceDescriptor,
  SettlementRevision,
  Settler,
} from "./types.js";

export function createSettler<Input, Candidate = never>(): Settler<
  Input,
  Candidate
> {
  let isDisposed = false;
  let committedCandidate: Candidate | undefined;
  let currentRevision: SettlementRevision | undefined;
  const currentInput = signal<Input | undefined>(undefined);
  const revisionStates = new WeakMap<SettlementRevision, RevisionState>();
  const reactiveResources: ReactiveResourceRegistration[] = [];

  function assertActive(): void {
    if (isDisposed) {
      throw new SettlerDisposedError();
    }
  }

  function evaluateReactiveResources(revision: SettlementRevision): void {
    const state = revisionStates.get(revision)!;
    let obligationChange = 0;

    for (const resource of reactiveResources) {
      obligationChange += resource.evaluate(revision);
    }

    state.unsatisfiedRequiredObligations += obligationChange;
    if (state.unsatisfiedRequiredObligations === 0) {
      wakeSettlementWaiters(state);
    }
  }

  return {
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      if (currentRevision !== undefined) {
        wakeSettlementWaiters(revisionStates.get(currentRevision)!);
      }
      for (const resource of reactiveResources) {
        resource.dispose();
      }
      reactiveResources.length = 0;
    },
    receive(input) {
      assertActive();
      const revision = Object.freeze({}) as SettlementRevision;
      revisionStates.set(revision, {
        unsatisfiedRequiredObligations: 0,
        settlementWaiters: new Set(),
        resourceFailures: new Map(),
      });
      const previousRevision = currentRevision;
      batch(() => {
        currentRevision = revision;
        currentInput.set(() => input);

        if (previousRevision !== undefined) {
          const previousState = revisionStates.get(previousRevision)!;
          previousState.supersededBy = revision;
          wakeSettlementWaiters(previousState);
        }

        evaluateReactiveResources(revision);
        if (previousRevision !== undefined) {
          for (const resource of reactiveResources) {
            resource.cancel(previousRevision);
          }
        }
      });

      return revision;
    },
    resource<ResourceInput, ResourceCandidate>(
      descriptor: SettlementResourceDescriptor<
        Input,
        ResourceInput,
        ResourceCandidate
      >,
    ): SettlementResource<ResourceCandidate> {
      const { resource, registration } = createSettlementResource(descriptor, {
        getInput: currentInput.get,
        getRevisionState: (revision) => revisionStates.get(revision)!,
        assertActive,
        isDisposed: () => isDisposed,
        propagate: evaluateReactiveResources,
      });
      reactiveResources.push(registration);
      return resource;
    },
    require(revision) {
      assertActive();
      const state = revisionStates.get(revision)!;
      state.unsatisfiedRequiredObligations += 1;
      let isSatisfied = false;

      return Object.freeze({
        satisfy() {
          if (isSatisfied) {
            return;
          }
          isSatisfied = true;
          satisfyRequiredObligation(state);
        },
      });
    },
    associateExecution(revision, options) {
      assertActive();
      const identity = Object.freeze({}) as ExecutionIdentity;
      const state = revisionStates.get(revision)!;
      const isRequiredForSettlement =
        options?.requiredForSettlement === true;
      let isRequiredObligationSatisfied = !isRequiredForSettlement;

      if (isRequiredForSettlement) {
        state.unsatisfiedRequiredObligations += 1;
      }

      return Object.freeze({
        identity,
        revision,
        submit(candidate) {
          if (isDisposed) {
            return Object.freeze({
              status: "rejected" as const,
              reason: "disposed" as const,
              revision,
              execution: identity,
            });
          }

          if (state.supersededBy !== undefined) {
            return Object.freeze({
              status: "rejected" as const,
              reason: "superseded" as const,
              revision,
              execution: identity,
              supersededBy: state.supersededBy,
            });
          }

          committedCandidate = candidate;

          if (!isRequiredObligationSatisfied) {
            isRequiredObligationSatisfied = true;
            satisfyRequiredObligation(state);
          }

          return Object.freeze({
            status: "committed" as const,
            revision,
            execution: identity,
          });
        },
      });
    },
    emit() {
      return committedCandidate;
    },
    settle(revision) {
      const state = revisionStates.get(revision)!;
      if (state.supersededBy !== undefined) {
        return Promise.resolve({
          status: "superseded",
          revision,
          supersededBy: state.supersededBy,
        });
      }

      if (isDisposed) {
        return Promise.reject(new SettlerDisposedError());
      }

      const failure = state.resourceFailures.values().next().value;
      if (failure !== undefined) {
        return Promise.reject(failure);
      }

      if (state.unsatisfiedRequiredObligations > 0) {
        return new Promise<SettlementOutcome<typeof revision>>((resolve, reject) => {
          state.settlementWaiters.add(() => {
            if (state.supersededBy !== undefined) {
              resolve({
                status: "superseded",
                revision,
                supersededBy: state.supersededBy,
              });
              return;
            }

            if (isDisposed) {
              reject(new SettlerDisposedError());
              return;
            }

            const failure = state.resourceFailures.values().next().value;
            if (failure !== undefined) {
              reject(failure);
              return;
            }

            resolve({ status: "settled", revision });
          });
        });
      }

      return Promise.resolve({ status: "settled", revision });
    },
  };
}
