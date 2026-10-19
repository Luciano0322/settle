import { batch, signal } from "@signal-kernel/core";

import { SettlerDisposedError, SettlementRevisionError, SettlementSnapshotError } from "./errors.js";
import { createObservability } from "./observability.js";
import { createSettlementResource } from "./resource.js";
import { captureSettlementSnapshot, readSettlementSnapshot } from "./snapshot.js";
import {
  satisfyRequiredObligation,
  wakeSettlementWaiters,
  type ReactiveResourceRegistration,
  type RevisionState,
} from "./settlement-state.js";
import type {
  ExecutionIdentity,
  RequiredObligation,
  RestoredExecutionObligation,
  SettlementExecution,
  SettlementOutcome,
  SettlementResource,
  SettlementResourceDescriptor,
  SettlementResourceInspection,
  SettlementRevision,
  Settler,
  SettlerOptions,
} from "./types.js";

export function createSettler<Input, Candidate = never>(
  options: SettlerOptions = {},
): Settler<Input, Candidate> {
  let isDisposed = false;
  let committedCandidate: Candidate | undefined;
  let committedRevision: SettlementRevision | undefined;
  let committedExecution: ExecutionIdentity | undefined;
  let currentRevision: SettlementRevision | undefined;
  const currentInput = signal<Input | undefined>(undefined);
  const revisionStates = new WeakMap<SettlementRevision, RevisionState>();
  const reactiveResources: ReactiveResourceRegistration[] = [];
  const observation = createObservability(options.now);
  let disposedResources: readonly SettlementResourceInspection[] = [];

  function assertActive(): void {
    if (isDisposed) {
      throw new SettlerDisposedError();
    }
  }

  function getRevisionState(revision: SettlementRevision): RevisionState {
    const state = revisionStates.get(revision);
    if (state === undefined) {
      observation.record({ type: "rejected", subject: "revision", revision, reason: "provenance-mismatch" });
      throw new SettlementRevisionError(revision);
    }
    return state;
  }

  function evaluateReactiveResources(revision: SettlementRevision): void {
    const state = revisionStates.get(revision)!;
    let obligationChange = 0;
    let changed = true;
    let passes = 0;
    while (changed) {
      if (++passes > 10000) {
        throw new Error("Reactive validity did not stabilize");
      }
      changed = false;
      for (const resource of reactiveResources) {
        const change = resource.evaluate(revision);
        obligationChange += change;
        if (change !== 0) changed = true;
      }
    }

    state.unsatisfiedRequiredObligations += obligationChange;
    if (state.unsatisfiedRequiredObligations === 0) {
      wakeSettlementWaiters(state);
    }
  }

  const settler: Settler<Input, Candidate> = {
    trace: observation.trace,
    subscribe: observation.subscribe,
    inspect() {
      const state = currentRevision === undefined ? undefined : revisionStates.get(currentRevision)!;
      const manual = state?.unsatisfiedManualObligations ?? 0;
      const executions = state?.unsatisfiedExecutionObligations ?? 0;
      const required = state?.unsatisfiedRequiredObligations ?? 0;
      return Object.freeze({
        disposed: isDisposed,
        ...(currentRevision !== undefined ? { revision: currentRevision, revisionId: observation.revisionId(currentRevision) } : {}),
        obligations: Object.freeze({ required, manual, executions, resources: required - manual - executions }),
        resources: Object.freeze(isDisposed ? [...disposedResources] : reactiveResources.map((resource) => resource.inspect(currentRevision))),
        ...(committedRevision !== undefined ? {
          committed: Object.freeze({
            revision: committedRevision,
            revisionId: observation.revisionId(committedRevision),
            ...(committedExecution !== undefined ? { execution: committedExecution, executionId: observation.executionId(committedExecution) } : {}),
          })
        } : {}),
      });
    },
    snapshot() {
      assertActive();
      if (currentRevision === undefined) {
        throw new SettlementSnapshotError(
          "Receive input before capturing a snapshot",
        );
      }
      const state = revisionStates.get(currentRevision)!;
      const input = currentInput.peek();
      return captureSettlementSnapshot(options, {
        manualObligations: state.unsatisfiedManualObligations,
        executionObligations: state.unsatisfiedExecutionObligations,
        ...(input !== undefined ? { input } : {}),
        ...(committedRevision === currentRevision && committedCandidate !== undefined
          ? { candidate: committedCandidate }
          : {}),
        resources: reactiveResources.map((resource) => resource.snapshot()),
      });
    },
    restore(snapshot) {
      assertActive();
      if (currentRevision !== undefined) {
        throw new SettlementSnapshotError("Restore requires a fresh settler");
      }
      const state = readSettlementSnapshot<Input, Candidate>(
        options,
        snapshot,
        reactiveResources.map((resource) => resource.id),
      );
      const restoredResources = new Map(
        state.resources.map((resource) => [resource.id, resource]),
      );
      let revision!: SettlementRevision;
      const manualObligations: RequiredObligation[] = [];
      const executionObligations: RestoredExecutionObligation<Candidate>[] = [];
      batch(() => {
        revision = settler.receive(state.input as Input);
        committedCandidate = state.candidate;
        committedRevision = Object.prototype.hasOwnProperty.call(state, "candidate") ? revision : undefined;
        for (const resource of reactiveResources) {
          resource.restore(restoredResources.get(resource.id!)!, revision);
        }
        for (const resource of reactiveResources) {
          resource.rebind();
        }
        for (let index = 0; index < state.manualObligations; index += 1) {
          manualObligations.push(settler.require(revision));
        }
        const restoredState = revisionStates.get(revision)!;
        restoredState.unsatisfiedRequiredObligations += state.executionObligations;
        restoredState.unsatisfiedExecutionObligations += state.executionObligations;
        for (let index = 0; index < state.executionObligations; index += 1) {
          let execution: SettlementExecution<Candidate> | undefined;
          executionObligations.push(
            Object.freeze({
              associateExecution() {
                assertActive();
                if (execution === undefined) {
                  execution = settler.associateExecution(revision, {
                    requiredForSettlement: true,
                  });
                  // Transfer the reservation without waking settlement.
                  restoredState.unsatisfiedRequiredObligations -= 1;
                  restoredState.unsatisfiedExecutionObligations -= 1;
                }
                return execution;
              },
            }),
          );
        }
        evaluateReactiveResources(revision);
        for (const resource of reactiveResources) {
          const inspection = resource.inspect(revision);
          if (inspection.status === "valid") {
            observation.record({ type: "reused", subject: "resource", revision, resourceId: inspection.id, reason: "restored-state" });
          }
        }
        observation.record({ type: "restored", subject: "revision", revision });
      });
      return Object.freeze({
        revision,
        manualObligations: Object.freeze(manualObligations),
        executionObligations: Object.freeze(executionObligations),
      });
    },
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
      disposedResources = reactiveResources.map((resource) => resource.inspect(currentRevision));
      reactiveResources.length = 0;
    },
    receive(input) {
      assertActive();
      const revision = Object.freeze({}) as SettlementRevision;
      observation.revisionId(revision);
      revisionStates.set(revision, {
        unsatisfiedRequiredObligations: 0,
        unsatisfiedManualObligations: 0,
        unsatisfiedExecutionObligations: 0,
        settlementWaiters: new Set(),
        resourceFailures: new Map(),
      });
      const previousRevision = currentRevision;
      batch(() => {
        currentRevision = revision;
        currentInput.set(() => input);
        observation.record({ type: "changed", subject: "revision", revision });

        if (previousRevision !== undefined) {
          const previousState = revisionStates.get(previousRevision)!;
          previousState.supersededBy = revision;
          observation.supersede(previousRevision, revision);
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
      assertActive();
      if (
        descriptor.id !== undefined &&
        (descriptor.id.length === 0 ||
          reactiveResources.some((resource) => resource.traceId === descriptor.id))
      ) {
        throw new SettlementSnapshotError("Resource IDs must be non-empty and unique");
      }
      let resourceId = descriptor.id;
      if (resourceId === undefined) {
        let sequence = reactiveResources.length + 1;
        do {
          resourceId = `resource:${sequence++}`;
        } while (reactiveResources.some((resource) => resource.traceId === resourceId));
      }
      const { resource, registration } = createSettlementResource(descriptor, {
        observation,
        resourceId,
        getInput: currentInput.get,
        getRevisionState,
        assertActive,
        isDisposed: () => isDisposed,
        propagate: evaluateReactiveResources,
      });
      reactiveResources.push(registration);
      return resource;
    },
    require(revision) {
      assertActive();
      const state = getRevisionState(revision);
      state.unsatisfiedRequiredObligations += 1;
      state.unsatisfiedManualObligations += 1;
      let isSatisfied = false;

      return Object.freeze({
        satisfy() {
          return observation.transition(() => {
            if (isSatisfied) {
              return;
            }
            isSatisfied = true;
            state.unsatisfiedManualObligations -= 1;
            satisfyRequiredObligation(state);
          });
        },
      });
    },
    associateExecution(revision, options) {
      assertActive();
      const state = getRevisionState(revision);
      const identity = Object.freeze({}) as ExecutionIdentity;
      observation.trackExecution(revision, identity);
      const isRequiredForSettlement =
        options?.requiredForSettlement === true;
      let isRequiredObligationSatisfied = !isRequiredForSettlement;

      if (isRequiredForSettlement) {
        state.unsatisfiedRequiredObligations += 1;
        state.unsatisfiedExecutionObligations += 1;
      }

      return Object.freeze({
        identity,
        revision,
        submit(candidate) {
          return observation.transition(() => {
            observation.record({ type: "completed", subject: "execution", revision, execution: identity });
            if (isDisposed) {
              observation.record({ type: "rejected", subject: "execution", revision, execution: identity, reason: "disposed" });
              return Object.freeze({
                status: "rejected" as const,
                reason: "disposed" as const,
                revision,
                execution: identity,
              });
            }

            if (state.supersededBy !== undefined) {
              observation.record({ type: "rejected", subject: "execution", revision, execution: identity, reason: "stale-revision", supersededBy: state.supersededBy });
              return Object.freeze({
                status: "rejected" as const,
                reason: "superseded" as const,
                revision,
                execution: identity,
                supersededBy: state.supersededBy,
              });
            }

            committedCandidate = candidate;
            committedRevision = revision;
            committedExecution = identity;
            observation.record({ type: "committed", subject: "execution", revision, execution: identity });

            if (!isRequiredObligationSatisfied) {
              isRequiredObligationSatisfied = true;
              state.unsatisfiedExecutionObligations -= 1;
              satisfyRequiredObligation(state);
            }

            return Object.freeze({
              status: "committed" as const,
              revision,
              execution: identity,
            });
          });
        },
      });
    },
    emit() {
      return committedCandidate;
    },
    settle(revision) {
      let state: RevisionState;
      try {
        state = getRevisionState(revision);
      } catch (error) {
        return Promise.reject(error);
      }
      const settlementId = observation.startSettlement(revision);
      if (state.supersededBy !== undefined) {
        observation.record({ type: "superseded", subject: "settlement", revision, settlementId, supersededBy: state.supersededBy });
        return Promise.resolve({
          status: "superseded",
          revision,
          supersededBy: state.supersededBy,
        });
      }

      if (isDisposed) {
        observation.record({ type: "failed", subject: "settlement", revision, settlementId, reason: "disposed" });
        return Promise.reject(new SettlerDisposedError());
      }

      const failure = state.resourceFailures.values().next().value;
      if (failure !== undefined) {
        observation.record({ type: "failed", subject: "settlement", revision, settlementId, reason: "execution-failed" });
        return Promise.reject(failure);
      }

      if (state.unsatisfiedRequiredObligations > 0) {
        return new Promise<SettlementOutcome<typeof revision>>((resolve, reject) => {
          state.settlementWaiters.add(() => {
            if (state.supersededBy !== undefined) {
              observation.record({ type: "superseded", subject: "settlement", revision, settlementId, supersededBy: state.supersededBy });
              resolve({
                status: "superseded",
                revision,
                supersededBy: state.supersededBy,
              });
              return;
            }

            if (isDisposed) {
              observation.record({ type: "failed", subject: "settlement", revision, settlementId, reason: "disposed" });
              reject(new SettlerDisposedError());
              return;
            }

            const failure = state.resourceFailures.values().next().value;
            if (failure !== undefined) {
              observation.record({ type: "failed", subject: "settlement", revision, settlementId, reason: "execution-failed" });
              reject(failure);
              return;
            }

            observation.record({ type: "settled", subject: "settlement", revision, settlementId });
            resolve({ status: "settled", revision });
          });
        });
      }

      observation.record({ type: "settled", subject: "settlement", revision, settlementId });
      return Promise.resolve({ status: "settled", revision });
    },
  };
  return {
    ...settler,
    receive: (input) => observation.transition(() => settler.receive(input)),
    restore: (snapshot) => observation.transition(() => settler.restore(snapshot)),
    dispose: () => observation.transition(() => settler.dispose()),
    require: (revision) => observation.transition(() => settler.require(revision)),
    associateExecution: (revision, executionOptions) => observation.transition(() => settler.associateExecution(revision, executionOptions)),
    resource: (descriptor) => observation.transition(() => settler.resource(descriptor)),
    settle: (revision) => observation.transition(() => settler.settle(revision)),
  };
}
