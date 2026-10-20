import {
  createSettler,
  type CandidateSubmissionOutcome,
  type SettlementOutcome,
  type SettlementTraceEvent,
} from "@signal-kernel/settle";

export type ChangingInputReport<Candidate> = {
  previousSettlement: SettlementOutcome;
  currentSettlement: SettlementOutcome;
  previousSubmission: CandidateSubmissionOutcome;
  currentSubmission: CandidateSubmissionOutcome;
  output: Candidate | undefined;
  trace: readonly SettlementTraceEvent[];
};

/** This function is the host: it starts work and chooses which revision to await. */
export async function runChangingInputExample<Input, Candidate>(options: {
  initialInput: Input;
  nextInput: Input;
  execute(input: Input): Promise<Candidate>;
}): Promise<ChangingInputReport<Candidate>> {
  const settler = createSettler<Input, Candidate>();
  try {
    const previous = settler.receive(options.initialInput);
    const previousExecution = settler.associateExecution(previous, { requiredForSettlement: true });
    const previousWork = options.execute(options.initialInput).then(previousExecution.submit);
    const previousSettlement = settler.settle(previous);

    const current = settler.receive(options.nextInput);
    const currentExecution = settler.associateExecution(current, { requiredForSettlement: true });
    const currentWork = options.execute(options.nextInput).then(currentExecution.submit);
    const currentSettlement = settler.settle(current);

    // Wait for old physical work only to report its late rejection, not to settle current.
    const [oldOutcome, newOutcome, oldSubmission, newSubmission] = await Promise.all([
      previousSettlement, currentSettlement, previousWork, currentWork,
    ]);
    return {
      previousSettlement: oldOutcome,
      currentSettlement: newOutcome,
      previousSubmission: oldSubmission,
      currentSubmission: newSubmission,
      output: settler.emit(),
      trace: settler.trace(),
    };
  } finally {
    settler.dispose();
  }
}
