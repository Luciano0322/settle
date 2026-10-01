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

type RevisionState = {
  supersededBy?: SettlementRevision;
  unsatisfiedRequiredObligations: number;
  settlementWaiters: Set<() => void>;
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
  const revisionStates = new WeakMap<SettlementRevision, RevisionState>();

  return {
    receive(input) {
      void input;
      const revision = Object.freeze({}) as SettlementRevision;
      revisionStates.set(revision, {
        unsatisfiedRequiredObligations: 0,
        settlementWaiters: new Set(),
      });
      const previousRevision = currentRevision;
      currentRevision = revision;

      if (previousRevision !== undefined) {
        const previousState = revisionStates.get(previousRevision)!;
        previousState.supersededBy = revision;
        wakeSettlementWaiters(previousState);
      }

      return revision;
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
