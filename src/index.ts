declare const settlementRevisionBrand: unique symbol;

export type SettlementRevision = Readonly<{
  readonly [settlementRevisionBrand]: "SettlementRevision";
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

export type Settler<Input> = {
  receive(input: Input): SettlementRevision;
  require(revision: SettlementRevision): RequiredObligation;
  settle<Revision extends SettlementRevision>(
    revision: Revision,
  ): Promise<SettlementOutcome<Revision>>;
};

export function createSettler<Input>(): Settler<Input> {
  const revisionStates = new WeakMap<
    SettlementRevision,
    {
      unsatisfiedRequiredObligations: number;
      settlementWaiters: Set<() => void>;
    }
  >();

  return {
    receive(input) {
      void input;
      const revision = Object.freeze({}) as SettlementRevision;
      revisionStates.set(revision, {
        unsatisfiedRequiredObligations: 0,
        settlementWaiters: new Set(),
      });
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
          state.unsatisfiedRequiredObligations -= 1;

          if (state.unsatisfiedRequiredObligations === 0) {
            for (const settle of state.settlementWaiters) {
              settle();
            }
            state.settlementWaiters.clear();
          }
        },
      });
    },
    settle(revision) {
      const state = revisionStates.get(revision)!;
      if (state.unsatisfiedRequiredObligations > 0) {
        return new Promise<SettlementOutcome<typeof revision>>((resolve) => {
          state.settlementWaiters.add(() => {
            resolve({ status: "settled", revision });
          });
        });
      }

      return Promise.resolve({ status: "settled", revision });
    },
  };
}
