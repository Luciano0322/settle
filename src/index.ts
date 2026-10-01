import {
  createResource,
  type ResourceContext,
} from "@signal-kernel/async-runtime";
import { batch, computed, signal } from "@signal-kernel/core";

declare const settlementRevisionBrand: unique symbol;
declare const executionIdentityBrand: unique symbol;

export type SettlementRevision = Readonly<{
  readonly [settlementRevisionBrand]: "SettlementRevision";
}>;

export type ExecutionIdentity = Readonly<{
  readonly [executionIdentityBrand]: "ExecutionIdentity";
}>;

export type CandidateSubmissionOutcome<
  Revision extends SettlementRevision = SettlementRevision,
> =
  | Readonly<{
      status: "committed";
      revision: Revision;
      execution: ExecutionIdentity;
    }>
  | Readonly<{
      status: "rejected";
      reason: "superseded";
      revision: Revision;
      execution: ExecutionIdentity;
      supersededBy: SettlementRevision;
    }>;

export type SettlementExecution<
  Candidate = never,
  Revision extends SettlementRevision = SettlementRevision,
> = Readonly<{
  identity: ExecutionIdentity;
  revision: Revision;
  submit(candidate: Candidate): CandidateSubmissionOutcome<Revision>;
}>;

export type SettlementOutcome<
  Revision extends SettlementRevision = SettlementRevision,
> =
  | Readonly<{
      status: "settled";
      revision: Revision;
    }>
  | Readonly<{
      status: "superseded";
      revision: Revision;
      supersededBy: SettlementRevision;
    }>;

export type RequiredObligation = Readonly<{
  satisfy(): void;
}>;

export type ExecutionAssociationOptions = Readonly<{
  requiredForSettlement?: boolean;
}>;

export type SettlementResourceDescriptor<Input, ResourceInput, Candidate> =
  Readonly<{
    input(state: Input): ResourceInput;
    run(input: ResourceInput, context: ResourceContext): Promise<Candidate>;
    equals?: (left: ResourceInput, right: ResourceInput) => boolean;
  }>;

export type SettlementResource<Candidate> = Readonly<{
  required(revision: SettlementRevision): boolean;
  run(
    revision: SettlementRevision,
  ): Promise<CandidateSubmissionOutcome | undefined>;
  emit(): Candidate | undefined;
}>;

type RevisionState = {
  supersededBy?: SettlementRevision;
  unsatisfiedRequiredObligations: number;
  settlementWaiters: Set<() => void>;
};

type ReactiveResourceRegistration = {
  evaluate(revision: SettlementRevision): number;
};

function wakeSettlementWaiters(state: RevisionState): void {
  for (const settle of state.settlementWaiters) {
    settle();
  }
  state.settlementWaiters.clear();
}

function satisfyRequiredObligation(state: RevisionState): void {
  state.unsatisfiedRequiredObligations -= 1;

  if (state.unsatisfiedRequiredObligations === 0) {
    wakeSettlementWaiters(state);
  }
}

export type Settler<Input, Candidate = never> = {
  receive(input: Input): SettlementRevision;
  resource<ResourceInput, ResourceCandidate>(
    descriptor: SettlementResourceDescriptor<
      Input,
      ResourceInput,
      ResourceCandidate
    >,
  ): SettlementResource<ResourceCandidate>;
  require(revision: SettlementRevision): RequiredObligation;
  associateExecution<Revision extends SettlementRevision>(
    revision: Revision,
    options?: ExecutionAssociationOptions,
  ): SettlementExecution<Candidate, Revision>;
  emit(): Candidate | undefined;
  settle<Revision extends SettlementRevision>(
    revision: Revision,
  ): Promise<SettlementOutcome<Revision>>;
};

export function createSettler<Input, Candidate = never>(): Settler<
  Input,
  Candidate
> {
  let committedCandidate: Candidate | undefined;
  let currentRevision: SettlementRevision | undefined;
  const currentInput = signal<Input | undefined>(undefined);
  const revisionStates = new WeakMap<SettlementRevision, RevisionState>();
  const reactiveResources: ReactiveResourceRegistration[] = [];

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
    receive(input) {
      const revision = Object.freeze({}) as SettlementRevision;
      revisionStates.set(revision, {
        unsatisfiedRequiredObligations: 0,
        settlementWaiters: new Set(),
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
      const selectedInput = computed(() =>
        descriptor.input(currentInput.get() as Input),
      );
      const equality = descriptor.equals ?? Object.is;
      const requirements = new WeakMap<
        SettlementRevision,
        { required: boolean; selectedInput: ResourceInput }
      >();
      const committedCandidate = signal<ResourceCandidate | undefined>(
        undefined,
      );
      const currentRequirement = signal(false);
      const [, asyncResource] = createResource({
        trigger: "manual",
        async run(input: ResourceInput, context: ResourceContext) {
          return { candidate: await descriptor.run(input, context) };
        },
      });
      let hasCommittedCandidate = false;
      let committedInput: ResourceInput | undefined;

      const registration: ReactiveResourceRegistration = {
        evaluate(revision) {
          const nextInput = selectedInput.get();
          const existingRequirement = requirements.get(revision);
          const required =
            !hasCommittedCandidate ||
            !equality(nextInput, committedInput as ResourceInput);
          requirements.set(revision, { required, selectedInput: nextInput });
          currentRequirement.set(required);

          if (existingRequirement === undefined) {
            return required ? 1 : 0;
          }

          if (required === existingRequirement?.required) {
            return 0;
          }

          return required ? 1 : -1;
        },
      };
      reactiveResources.push(registration);

      return Object.freeze({
        required(revision: SettlementRevision) {
          return requirements.get(revision)?.required === true;
        },
        async run(revision: SettlementRevision) {
          const requirement = requirements.get(revision);
          if (requirement?.required !== true) {
            return undefined;
          }

          const identity = Object.freeze({}) as ExecutionIdentity;
          const completed = await asyncResource.run(requirement.selectedInput);
          if (completed === undefined) {
            return undefined;
          }
          const { candidate } = completed;

          const state = revisionStates.get(revision)!;
          if (state.supersededBy !== undefined) {
            return Object.freeze({
              status: "rejected" as const,
              reason: "superseded" as const,
              revision,
              execution: identity,
              supersededBy: state.supersededBy,
            });
          }

          batch(() => {
            committedCandidate.set(() => candidate);
            committedInput = requirement.selectedInput;
            hasCommittedCandidate = true;
            evaluateReactiveResources(revision);
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
    },
    require(revision) {
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

      if (state.unsatisfiedRequiredObligations > 0) {
        return new Promise<SettlementOutcome<typeof revision>>((resolve) => {
          state.settlementWaiters.add(() => {
            if (state.supersededBy !== undefined) {
              resolve({
                status: "superseded",
                revision,
                supersededBy: state.supersededBy,
              });
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
