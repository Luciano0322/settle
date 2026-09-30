import { createSettler } from "@signal-kernel/settle";

const settler = createSettler<string, string>();
const revision = settler.receive("input");
const execution = settler.associateExecution(revision);

execution.submit("candidate");

// Candidate submission requires the revision-bound execution handle.
// @ts-expect-error Settler intentionally has no direct submission operation.
settler.submit("candidate");
