import type { ExecutionIdentity, SettlementRevision } from "./types.js";

export class SettlerDisposedError extends Error {
  constructor() {
    super("The settler has been disposed");
    this.name = "SettlerDisposedError";
  }
}

export class SettlementExecutionError extends Error {
  readonly revision: SettlementRevision;
  readonly execution: ExecutionIdentity;
  readonly cause: unknown;

  constructor(
    revision: SettlementRevision,
    execution: ExecutionIdentity,
    cause: unknown,
  ) {
    super("A required resource execution failed");
    this.name = "SettlementExecutionError";
    this.revision = revision;
    this.execution = execution;
    this.cause = cause;
  }
}
