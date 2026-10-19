import {
  createSettler,
  type CandidateSubmissionOutcome,
  type SettlementExecutionError,
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

// Candidate submission requires the revision-bound execution handle.
// @ts-expect-error Settler intentionally has no direct submission operation.
settler.submit("candidate");
