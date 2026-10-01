import { createSettler } from "@signal-kernel/settle";

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

// Candidate submission requires the revision-bound execution handle.
// @ts-expect-error Settler intentionally has no direct submission operation.
settler.submit("candidate");
