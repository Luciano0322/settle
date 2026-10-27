import {
  createResource,
  type ResourceContext,
} from "@signal-kernel/async-runtime";
import { batch, computed, signal } from "@signal-kernel/core";
import { isJsonValue } from "@signal-kernel/snapshot";

import { SettlementExecutionError } from "./errors.js";
import type { createObservability } from "./observability.js";
import {
  wakeSettlementWaiters,
  type ReactiveResourceRegistration,
  type RevisionState,
} from "./settlement-state.js";
import type {
  ExecutionIdentity,
  ResourceValue,
  SettlementResource,
  SettlementResourceDescriptor,
  SettlementRevision,
} from "./types.js";

type SettlementResourceContext<Input> = {
  observation: ReturnType<typeof createObservability>;
  resourceId: string;
  getInput(): Input | undefined;
  getRevisionState(revision: SettlementRevision): RevisionState;
  assertActive(): void;
  isDisposed(): boolean;
  propagate(revision: SettlementRevision): void;
};

type ResourceExecution<ResourceInput> = {
  input: ResourceInput;
  revision: SettlementRevision;
  identity: ExecutionIdentity;
  failure?: SettlementExecutionError;
  completed?: boolean;
  revoked?: boolean;
};

export function createSettlementResource<Input, ResourceInput, Candidate>(
  descriptor: SettlementResourceDescriptor<Input, ResourceInput, Candidate>,
  context: SettlementResourceContext<Input>,
): {
  resource: SettlementResource<Candidate>;
  registration: ReactiveResourceRegistration;
} {
  context.assertActive();
  const selectedInput = computed(() =>
    descriptor.input(context.getInput() as Input),
  );
  const equality = descriptor.equals ?? defaultInputEquals;
  const requirements = new WeakMap<
    SettlementRevision,
    { required: boolean; selectedInput: ResourceInput; reason: "uninitialized" | "input-changed" | "dependency-changed" }
  >();
  const committedCandidate = signal<Candidate | undefined>(undefined);
  const currentRequirement = signal(false);
  const [, asyncResource] = createResource({
    trigger: "manual",
    async run(
      execution: ResourceExecution<ResourceInput>,
      resourceContext: ResourceContext,
    ) {
      resourceContext.signal.addEventListener("abort", () => {
        context.observation.record({ type: "cancelled", subject: "execution", revision: execution.revision, execution: execution.identity, resourceId: context.resourceId, reason: context.isDisposed() ? "disposed" : execution.revoked ? "revoked-authority" : "stale-revision" });
      }, { once: true });
      try {
        const candidate = await descriptor.run(execution.input, resourceContext);
        execution.completed = true;
        return { candidate };
      } catch (cause) {
        execution.failure = new SettlementExecutionError(
          execution.revision,
          execution.identity,
          cause,
        );
        throw execution.failure;
      }
    },
  });
  let hasCommittedCandidate = false;
  let committedInput: ResourceInput | undefined;
  let runningRevision: SettlementRevision | undefined;
  let runningExecution: ResourceExecution<ResourceInput> | undefined;
  let committedExecution: ExecutionIdentity | undefined;
  let committedRevision: SettlementRevision | undefined;
  let latestExecution: ExecutionIdentity | undefined;
  let latestExecutionRevision: SettlementRevision | undefined;

  const registration: ReactiveResourceRegistration = {
    id: descriptor.id,
    traceId: context.resourceId,
    inspect(revision) {
      const required = currentRequirement.peek();
      const pending = runningExecution?.revision === revision && !runningExecution?.revoked && runningExecution !== undefined;
      const failed = revision !== undefined && context.getRevisionState(revision).resourceFailures.has(registration);
      const execution = pending ? runningExecution?.identity : failed ? latestExecution : committedExecution;
      const producingRevision = pending ? runningExecution?.revision : failed ? latestExecutionRevision : committedRevision;
      return Object.freeze({
        id: context.resourceId,
        required,
        status: context.isDisposed() ? "disposed" : failed ? "failed" : pending ? "pending" : required ? "required" : hasCommittedCandidate ? "valid" : "uninitialized",
        ...(execution !== undefined ? { execution, executionId: context.observation.executionId(execution) } : {}),
        ...(producingRevision !== undefined ? { revision: producingRevision, revisionId: context.observation.revisionId(producingRevision) } : {}),
      });
    },
    snapshot() {
      const valid = hasCommittedCandidate && !currentRequirement.peek();
      const candidate = committedCandidate.peek();
      return {
        id: descriptor.id!,
        valid,
        ...(valid && committedInput !== undefined ? { input: committedInput } : {}),
        ...(valid && candidate !== undefined ? { candidate } : {}),
      };
    },
    restore(state, revision) {
      hasCommittedCandidate = state.valid;
      committedRevision = state.valid ? revision : undefined;
      committedInput = state.input as ResourceInput | undefined;
      committedCandidate.set(() => state.candidate as Candidate | undefined);
      currentRequirement.set(!state.valid);
    },
    rebind() {
      if (hasCommittedCandidate) {
        const nextInput = selectedInput.get();
        const isSameInput = equality(nextInput, committedInput as ResourceInput);
        if (isSameInput) {
          committedInput = nextInput;
        } else {
          hasCommittedCandidate = false;
          currentRequirement.set(true);
        }
      }
    },
    cancel(revision) {
      if (runningRevision === revision) {
        asyncResource.cancel("superseded");
      }
    },
    dispose() {
      asyncResource.cancel("disposed");
      selectedInput.dispose();
    },
    evaluate(revision) {
      const nextInput = selectedInput.get();
      const existingRequirement = requirements.get(revision);
      const required =
        !hasCommittedCandidate ||
        !equality(nextInput, committedInput as ResourceInput);
      const inputChanged = existingRequirement !== undefined && !equality(existingRequirement.selectedInput, nextInput);
      const reason = existingRequirement === undefined
        ? hasCommittedCandidate ? "input-changed" : "uninitialized"
        : inputChanged ? "dependency-changed" : existingRequirement.reason;
      requirements.set(revision, { required, selectedInput: nextInput, reason });
      currentRequirement.set(required);

      if (existingRequirement === undefined || inputChanged || existingRequirement.required !== required) {
        if (required) {
          context.observation.record({ type: "invalidated", subject: "resource", revision, resourceId: context.resourceId, reason });
        } else if (existingRequirement === undefined || inputChanged) {
          context.observation.record({ type: "reused", subject: "resource", revision, resourceId: context.resourceId, reason: "unchanged-input" });
        }
      }

      if (
        !required ||
        (existingRequirement !== undefined &&
          !equality(existingRequirement.selectedInput, nextInput))
      ) {
        context.getRevisionState(revision).resourceFailures.delete(registration);
      }

      if (existingRequirement === undefined) {
        return required ? 1 : 0;
      }

      if (required === existingRequirement?.required) {
        return 0;
      }

      return required ? 1 : -1;
    },
  };

  const resource: SettlementResource<Candidate> = Object.freeze({
    required(revision: SettlementRevision) {
      return requirements.get(revision)?.required === true;
    },
    valueFor<Revision extends SettlementRevision>(
      revision: Revision,
    ): ResourceValue<Candidate, Revision> {
      if (context.isDisposed()) {
        return Object.freeze({ status: "disposed" as const, revision });
      }
      const state = context.getRevisionState(revision);
      if (state.supersededBy !== undefined) {
        return Object.freeze({
          status: "superseded" as const,
          revision,
          supersededBy: state.supersededBy,
        });
      }
      // Valid only when every check passes; anything undetermined stays required.
      if (!hasCommittedCandidate || requirements.get(revision)?.required !== false) {
        return Object.freeze({ status: "required" as const, revision });
      }
      // peek(): reading at action time must not register a reactive dependency.
      return Object.freeze({
        status: "valid" as const,
        revision,
        value: committedCandidate.peek() as Candidate,
      });
    },
    async run(revision: SettlementRevision) {
      return context.observation.transition(async () => {
        context.assertActive();
        const initialState = context.getRevisionState(revision);
        const requirement = requirements.get(revision);
        if (requirement?.required !== true) {
          return undefined;
        }

        const identity = Object.freeze({}) as ExecutionIdentity;
        context.observation.trackExecution(revision, identity, context.resourceId);
        const trace = (type: "started" | "completed" | "committed" | "rejected", reason?: "disposed" | "stale-revision" | "revoked-authority", supersededBy?: SettlementRevision) => {
          context.observation.record({ type, subject: "execution", revision, execution: identity, resourceId: context.resourceId, reason, supersededBy });
        };
        if (initialState.supersededBy !== undefined) {
          trace("rejected", "stale-revision", initialState.supersededBy);
          return Object.freeze({
            status: "rejected" as const,
            reason: "superseded" as const,
            revision,
            execution: identity,
            supersededBy: initialState.supersededBy,
          });
        }
        initialState.resourceFailures.delete(registration);
        latestExecution = identity;
        latestExecutionRevision = revision;
        runningRevision = revision;
        const execution: ResourceExecution<ResourceInput> = {
          input: requirement.selectedInput,
          revision,
          identity,
        };
        if (runningExecution !== undefined && runningExecution.revision === revision) {
          runningExecution.revoked = true;
          context.observation.replaceExecution(revision, runningExecution.identity, identity, context.resourceId);
        }
        runningExecution = execution;
        trace("started");
        const completed = await asyncResource.run(execution);
        return context.observation.transition(() => {
          if (runningExecution === execution) runningExecution = undefined;
          if (execution.completed) trace("completed");
          if (execution.failure !== undefined) {
            context.observation.record({ type: "failed", subject: "execution", revision, execution: identity, resourceId: context.resourceId, reason: "execution-failed" });
          }

          const state = context.getRevisionState(revision);
          if (context.isDisposed()) {
            trace("rejected", "disposed");
            return Object.freeze({
              status: "rejected" as const,
              reason: "disposed" as const,
              revision,
              execution: identity,
            });
          }

          if (state.supersededBy !== undefined) {
            trace("rejected", "stale-revision", state.supersededBy);
            return Object.freeze({
              status: "rejected" as const,
              reason: "superseded" as const,
              revision,
              execution: identity,
              supersededBy: state.supersededBy,
            });
          }

          const current = requirements.get(revision)!;
          if (
            execution.revoked ||
            !current.required ||
            !equality(current.selectedInput, requirement.selectedInput)
          ) {
            trace("rejected", "revoked-authority");
            return undefined;
          }

          if (completed === undefined) {
            // Async-runtime suppresses errors from cancelled or replaced attempts.
            if (
              execution.failure !== undefined &&
              asyncResource.error() === execution.failure
            ) {
              state.resourceFailures.set(registration, execution.failure);
              wakeSettlementWaiters(state);
              throw execution.failure;
            }
            return undefined;
          }
          const { candidate } = completed;

          batch(() => {
            committedCandidate.set(() => candidate);
            committedInput = requirement.selectedInput;
            committedExecution = identity;
            committedRevision = revision;
            hasCommittedCandidate = true;
            context.observation.record({ type: "recomputed", subject: "resource", revision, execution: identity, resourceId: context.resourceId, reason: requirement.reason });
            trace("committed");
            context.propagate(revision);
          });

          return Object.freeze({
            status: "committed" as const,
            revision,
            execution: identity,
          });
        });
      });
    },
    emit() {
      if (currentRequirement.get()) {
        return undefined;
      }

      return committedCandidate.get();
    },
  });

  return { resource, registration };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length
      && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && jsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function defaultInputEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return isJsonValue(left) && isJsonValue(right) && jsonEqual(left, right);
}
