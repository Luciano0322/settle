import {
  createSettler,
  type CandidateSubmissionOutcome,
  type SettlementExecutionError,
  type RestoredExecutionObligation,
  type SettlementSnapshot,
  type SettlementTraceEvent,
  type SettlementInspection,
  type SettlementRevision,
  type ExecutionIdentity,
} from "@signal-kernel/settle";

const settler = createSettler<string, string>();
const revision = settler.receive("input");
const execution = settler.associateExecution(revision);

execution.submit("candidate");

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Condition extends true> = Condition;

const executionHandleExposesOnlyAtomicSubmission: Expect<
  Equal<keyof typeof execution, "identity" | "revision" | "submit">
> = true;
void executionHandleExposesOnlyAtomicSubmission;

const reactiveSettler = createSettler<{ dependency: string }>();
const resource = reactiveSettler.resource({
  input: (state) => state.dependency,
  run: async (input) => `result:${input}`,
});

type ResourceSurface = keyof typeof resource;
const resourceHandleExposesOnlyHostDrivenBehavior: Expect<
  Equal<ResourceSurface, "required" | "run" | "emit">
> = true;
void resource;
void resourceHandleExposesOnlyHostDrivenBehavior;

const disposalIsSynchronous: Expect<
  Equal<ReturnType<typeof settler.dispose>, void>
> = true;
const operationalErrorsDoNotAddSuccessfulOutcomes: Expect<
  Equal<Awaited<ReturnType<typeof settler.settle>>["status"], "settled" | "superseded">
> = true;
const candidateRejectionsIncludeDisposal: Expect<
  Equal<Extract<CandidateSubmissionOutcome, { status: "rejected" }>["reason"], "superseded" | "disposed">
> = true;
const executionErrorPreservesOpaqueCause: Expect<
  Equal<SettlementExecutionError["cause"], unknown>
> = true;
void disposalIsSynchronous;
void operationalErrorsDoNotAddSuccessfulOutcomes;
void candidateRejectionsIncludeDisposal;
void executionErrorPreservesOpaqueCause;

const snapshotReturnsTransferableDocument: Expect<
  Equal<ReturnType<typeof settler.snapshot>, SettlementSnapshot>
> = true;
const restoreValidatesUntrustedDocuments: Expect<
  Equal<Parameters<typeof settler.restore>[0], unknown>
> = true;
const restoredExecutionHasNoManualSatisfaction: Expect<
  Equal<keyof RestoredExecutionObligation<string>, "associateExecution">
> = true;
const restoredExecutionRetainsCandidateType: Expect<
  Equal<Parameters<ReturnType<RestoredExecutionObligation<string>["associateExecution"]>["submit"]>[0], string>
> = true;
void snapshotReturnsTransferableDocument;
void restoreValidatesUntrustedDocuments;
void restoredExecutionHasNoManualSatisfaction;
void restoredExecutionRetainsCandidateType;

const inspectionContainsMetadataNotAuthority: Expect<
  Equal<keyof SettlementInspection, "disposed" | "revision" | "revisionId" | "obligations" | "resources" | "committed">
> = true;
const traceIsReadonly: Expect<
  Equal<ReturnType<typeof settler.trace>, readonly SettlementTraceEvent[]>
> = true;
void inspectionContainsMetadataNotAuthority;
void traceIsReadonly;

// Opaque provenance cannot be assembled from public data or reassigned on a handle.
// @ts-expect-error Only receive/restore can produce a causal revision.
const fabricatedRevision: SettlementRevision = {};
// @ts-expect-error Only execution association can produce an execution identity.
const fabricatedExecution: ExecutionIdentity = {};
// @ts-expect-error A candidate cannot replace its execution's causal revision.
execution.revision = revision;
// @ts-expect-error A candidate cannot substitute another execution identity.
execution.identity = fabricatedExecution;
// @ts-expect-error Inspection has no obligation-satisfaction authority.
settler.inspect().obligations.satisfy();
// @ts-expect-error Trace history cannot be appended to by consumers.
settler.trace().push({});
void fabricatedRevision;

// Candidate submission requires the revision-bound execution handle.
// @ts-expect-error Settler intentionally has no direct submission operation.
settler.submit("candidate");
