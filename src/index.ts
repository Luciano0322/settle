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

export type Settler<Input> = {
  receive(input: Input): SettlementRevision;
  settle<Revision extends SettlementRevision>(
    revision: Revision,
  ): Promise<SettlementOutcome<Revision>>;
};

export function createSettler<Input>(): Settler<Input> {
  return {
    receive(input) {
      void input;
      return Object.freeze({}) as SettlementRevision;
    },
    async settle(revision) {
      return { status: "settled", revision };
    },
  };
}
