import type {
  ExecutionIdentity,
  SettlementRevision,
  SettlementTraceEvent,
} from "./types.js";

type TraceEntry = Omit<
  SettlementTraceEvent,
  | "version" | "id" | "sequence" | "timestamp" | "revisionId" | "executionId"
  | "supersededByRevisionId" | "supersededByExecutionId"
>;

export function createObservability(now?: () => number) {
  const events: SettlementTraceEvent[] = [];
  type Listener = (event: SettlementTraceEvent) => void;
  type Subscription = { listener: Listener };
  const listeners = new Set<Subscription>();
  const notifications: Array<{ event: SettlementTraceEvent; listeners: Subscription[] }> = [];
  let depth = 0;
  let notifying = false;
  const revisionIds = new WeakMap<SettlementRevision, string>();
  const executionIds = new WeakMap<ExecutionIdentity, string>();
  let revisionSequence = 0;
  let executionSequence = 0;
  let settlementSequence = 0;
  const executions = new Map<SettlementRevision, Map<ExecutionIdentity, string | undefined>>();

  function revisionId(revision: SettlementRevision): string {
    let id = revisionIds.get(revision);
    if (id === undefined) {
      id = `revision:${++revisionSequence}`;
      revisionIds.set(revision, id);
    }
    return id;
  }

  function executionId(execution: ExecutionIdentity): string {
    let id = executionIds.get(execution);
    if (id === undefined) {
      id = `execution:${++executionSequence}`;
      executionIds.set(execution, id);
    }
    return id;
  }

  function record(entry: TraceEntry): void {
    const sequence = events.length + 1;
    const event: SettlementTraceEvent = Object.freeze({
      ...entry,
      version: 1,
      id: `event:${sequence}`,
      sequence,
      timestamp: now?.() ?? sequence,
      revisionId: revisionId(entry.revision),
      ...(entry.supersededBy !== undefined ? { supersededByRevisionId: revisionId(entry.supersededBy) } : {}),
      ...(entry.execution !== undefined ? { executionId: executionId(entry.execution) } : {}),
      ...(entry.supersededByExecution !== undefined ? { supersededByExecutionId: executionId(entry.supersededByExecution) } : {}),
    });
    events.push(event);
    if (listeners.size > 0) notifications.push({ event, listeners: [...listeners] });
  }

  // Batch synchronous transitions only; async start and completion enter separately.
  // Returning a Promise never holds depth across an await.
  function transition<Value>(run: () => Value): Value {
    depth += 1;
    try {
      return run();
    } finally {
      depth -= 1;
      if (depth === 0 && !notifying) {
        notifying = true;
        try {
          for (let index = 0; index < notifications.length; index += 1) {
            const notification = notifications[index]!;
            for (const subscription of notification.listeners) {
              if (!listeners.has(subscription)) continue;
              try {
                subscription.listener(notification.event);
              } catch {
                // Observation cannot undo state transitions or block other observers.
              }
            }
          }
          notifications.length = 0;
        } finally {
          notifying = false;
        }
      }
    }
  }

  return {
    revisionId,
    executionId,
    record,
    transition,
    subscribe(listener: Listener): () => void {
      const subscription = { listener };
      listeners.add(subscription);
      return () => { listeners.delete(subscription); };
    },
    trackExecution(revision: SettlementRevision, execution: ExecutionIdentity, resourceId?: string): void {
      executionId(execution);
      const associated = executions.get(revision) ?? new Map<ExecutionIdentity, string | undefined>();
      associated.set(execution, resourceId);
      executions.set(revision, associated);
    },
    supersede(revision: SettlementRevision, supersededBy: SettlementRevision): void {
      for (const [execution, resourceId] of executions.get(revision) ?? []) {
        record({ type: "superseded", subject: "execution", revision, execution, supersededBy, reason: "stale-revision", resourceId });
      }
      executions.delete(revision);
    },
    replaceExecution(revision: SettlementRevision, execution: ExecutionIdentity, supersededByExecution: ExecutionIdentity, resourceId: string): void {
      record({ type: "superseded", subject: "execution", revision, execution, supersededByExecution, resourceId, reason: "revoked-authority" });
      executions.get(revision)?.delete(execution);
    },
    startSettlement(revision: SettlementRevision): string {
      const settlementId = `settlement:${++settlementSequence}`;
      record({ type: "started", subject: "settlement", revision, settlementId });
      return settlementId;
    },
    trace(): readonly SettlementTraceEvent[] {
      return Object.freeze([...events]);
    },
  };
}
