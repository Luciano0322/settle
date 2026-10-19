import {
  createResource,
  type ResourceContext,
} from "@signal-kernel/async-runtime";
import { batch, computed, signal } from "@signal-kernel/core";
import { isJsonValue } from "@signal-kernel/snapshot";

import { SettlementExecutionError } from "./errors.js";
import {
  wakeSettlementWaiters,
  type ReactiveResourceRegistration,
  type RevisionState,
} from "./settlement-state.js";
import type {
  ExecutionIdentity,
  SettlementResource,
  SettlementResourceDescriptor,
  SettlementRevision,
} from "./types.js";

type SettlementResourceContext<Input> = {
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
  const equality = descriptor.equals ?? Object.is;
  const requirements = new WeakMap<
    SettlementRevision,
    { required: boolean; selectedInput: ResourceInput }
  >();
  const committedCandidate = signal<Candidate | undefined>(undefined);
  const currentRequirement = signal(false);
  const [, asyncResource] = createResource({
    trigger: "manual",
    async run(
      execution: ResourceExecution<ResourceInput>,
      resourceContext: ResourceContext,
    ) {
      try {
        return {
          candidate: await descriptor.run(execution.input, resourceContext),
        };
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

  const registration: ReactiveResourceRegistration = {
    id: descriptor.id,
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
    restore(state) {
      hasCommittedCandidate = state.valid;
      committedInput = state.input as ResourceInput | undefined;
      committedCandidate.set(() => state.candidate as Candidate | undefined);
      currentRequirement.set(!state.valid);
    },
    rebind() {
      if (hasCommittedCandidate) {
        const nextInput = selectedInput.get();
        const sameTransferredValue =
          descriptor.equals === undefined &&
          isJsonValue(nextInput) &&
          isJsonValue(committedInput) &&
          JSON.stringify(nextInput) === JSON.stringify(committedInput);
        if (
          equality(nextInput, committedInput as ResourceInput) ||
          sameTransferredValue
        ) {
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
      requirements.set(revision, { required, selectedInput: nextInput });
      currentRequirement.set(required);

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
    async run(revision: SettlementRevision) {
      context.assertActive();
      const requirement = requirements.get(revision);
      if (requirement?.required !== true) {
        return undefined;
      }

      const identity = Object.freeze({}) as ExecutionIdentity;
      const initialState = context.getRevisionState(revision);
      if (initialState.supersededBy !== undefined) {
        return Object.freeze({
          status: "rejected" as const,
          reason: "superseded" as const,
          revision,
          execution: identity,
          supersededBy: initialState.supersededBy,
        });
      }
      initialState.resourceFailures.delete(registration);
      runningRevision = revision;
      const execution: ResourceExecution<ResourceInput> = {
        input: requirement.selectedInput,
        revision,
        identity,
      };
      const completed = await asyncResource.run(execution);

      const state = context.getRevisionState(revision);
      if (context.isDisposed()) {
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

      const current = requirements.get(revision)!;
      if (
        !current.required ||
        !equality(current.selectedInput, requirement.selectedInput)
      ) {
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
        hasCommittedCandidate = true;
        context.propagate(revision);
      });

      return Object.freeze({
        status: "committed" as const,
        revision,
        execution: identity,
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
