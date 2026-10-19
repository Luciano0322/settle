import type { ResourceContext } from "@signal-kernel/async-runtime";
import type { SnapshotDocument } from "@signal-kernel/snapshot";

declare const settlementRevisionBrand: unique symbol;
declare const executionIdentityBrand: unique symbol;

export type SettlementRevision = Readonly<{
  readonly [settlementRevisionBrand]: "SettlementRevision";
}>;

export type ExecutionIdentity = Readonly<{
  readonly [executionIdentityBrand]: "ExecutionIdentity";
}>;

export type SettlementTraceEvent = Readonly<{
  version: 1;
  id: string;
  sequence: number;
  timestamp: number;
  type:
    | "started" | "completed" | "committed" | "rejected" | "superseded"
    | "settled" | "cancelled" | "invalidated" | "reused" | "recomputed"
    | "failed" | "restored" | "changed";
  subject: "execution" | "settlement" | "resource" | "revision";
  revision: SettlementRevision;
  revisionId: string;
  execution?: ExecutionIdentity;
  executionId?: string;
  settlementId?: string;
  resourceId?: string;
  reason?:
    | "stale-revision" | "disposed" | "revoked-authority" | "uninitialized"
    | "unchanged-input" | "input-changed" | "dependency-changed"
    | "execution-failed" | "restored-state" | "provenance-mismatch";
  supersededBy?: SettlementRevision;
  supersededByRevisionId?: string;
  supersededByExecution?: ExecutionIdentity;
  supersededByExecutionId?: string;
}>;

export type SettlementResourceInspection = Readonly<{
  id: string;
  required: boolean;
  status: "uninitialized" | "required" | "pending" | "valid" | "failed" | "disposed";
  execution?: ExecutionIdentity;
  executionId?: string;
  revision?: SettlementRevision;
  revisionId?: string;
}>;

export type SettlementInspection = Readonly<{
  disposed: boolean;
  revision?: SettlementRevision;
  revisionId?: string;
  obligations: Readonly<{
    required: number;
    manual: number;
    executions: number;
    resources: number;
  }>;
  resources: readonly SettlementResourceInspection[];
  committed?: Readonly<{
    revision: SettlementRevision;
    revisionId: string;
    execution?: ExecutionIdentity;
    executionId?: string;
  }>;
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
    }>
  | Readonly<{
      status: "rejected";
      reason: "disposed";
      revision: Revision;
      execution: ExecutionIdentity;
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

export type SettlerOptions = Readonly<{
  definition?: Readonly<{ id: string; version: string }>;
  now?: () => number;
}>;

export type SettlementSnapshot = SnapshotDocument;

export type RestoredExecutionObligation<Candidate> = Readonly<{
  associateExecution(): SettlementExecution<Candidate>;
}>;

export type RestoredSettlement<Candidate> = Readonly<{
  revision: SettlementRevision;
  manualObligations: readonly RequiredObligation[];
  executionObligations: readonly RestoredExecutionObligation<Candidate>[];
}>;

export type SettlementResourceDescriptor<Input, ResourceInput, Candidate> =
  Readonly<{
    id?: string;
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

export type Settler<Input, Candidate = never> = {
  trace(): readonly SettlementTraceEvent[];
  subscribe(listener: (event: SettlementTraceEvent) => void): () => void;
  inspect(): SettlementInspection;
  snapshot(): SettlementSnapshot;
  restore(snapshot: unknown): RestoredSettlement<Candidate>;
  dispose(): void;
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
