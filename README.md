# Settle

Execution validity for changing systems.

Settle keeps asynchronous results valid as their causal inputs change.

> **Completion does not imply settlement.**

An execution may finish successfully after the state that created it has already
changed.

When that happens, the execution is complete — but its result may no longer be
valid.

Settle tracks causal state, execution identity, supersession, commit validity,
reuse, and settlement so obsolete results cannot become current observable
state.

Published as:

```bash
npm install @signal-kernel/settle
```

> `@signal-kernel/settle` is currently experimental and not yet published as a
> stable package.

---

## Why Settle?

Consider a long-running operation:

```text
revision 1
    |
    v
execution A#1 starts
```

Before it finishes, the input changes:

```text
revision 1
    |
    v
execution A#1 ------------------------>
             |
             |
        revision 2
             |
             v
        execution A#2
```

Now A#1 finishes first.

The Promise resolved successfully.

But that does not answer the important question:

> **Does the result still belong to the current state?**

If A#1 was created from revision 1 while the system is already on revision 2,
its result may no longer be allowed to affect observable state.

```text
A#1 completes
    |
    v
superseded
    |
    v
commit rejected
```

A#2 may later finish:

```text
A#2 completes
    |
    v
still current
    |
    v
commit accepted
```

Settle exists to make that distinction explicit.

---

## Core idea

Settle treats these as different states:

```text
completed != committed
completed != settled
cancelled != superseded
resolved  != accepted
```

Execution completion answers:

> Did the operation finish?

Commit validity answers:

> Is its result still allowed to affect current state?

Settlement answers:

> Does the currently observable state represent the current causal state?

These are different questions.

---

## What Settle owns

Settle is concerned with execution validity.

It answers questions such as:

* Which causal state created this execution?
* Is this execution still current?
* Has it been superseded?
* May this result commit?
* Can an existing settled result still be reused?
* Which work must be recomputed?
* Has the current observable state settled?

Its core semantic vocabulary includes:

```text
causal state
revision
execution identity
invalidation
supersession
commit validity
selective reuse
recomputation
settlement
snapshot continuity
```

---

## What Settle does not own

Settle is **not a workflow engine**.

It does not decide:

* what task runs next
* how workflow nodes connect
* when a task should retry
* where a task executes
* how workers are allocated
* how jobs are queued
* how branches join
* how workflow durability is implemented

Settle is not:

* a scheduler
* a task queue
* an agent framework
* a workflow DSL
* a retry system
* a worker runtime
* a durable execution platform
* a database
* a distributed coordination system

Your existing execution host still decides what runs and when.

> **Your workflow engine decides what runs.
> Settle decides whether the result still counts.**

---

## Designed to sit below existing execution hosts

Settle is intended to work underneath existing orchestration systems rather
than replace them.

```text
┌───────────────────────────────────────┐
│ Existing execution host               │
│                                       │
│ LangGraph                             │
│ Inngest                               │
│ Temporal                              │
│ custom agent runtime                  │
│ background worker                     │
│ plain async application               │
└───────────────────┬───────────────────┘
                    |
                    | executes work
                    v
             ┌──────────────┐
             │    Settle    │
             │              │
             │ causal state │
             │ execution ID │
             │ validity     │
             │ supersession │
             │ commit       │
             │ settlement   │
             └──────┬───────┘
                    |
                    v
          signal-kernel primitives
```

The host owns:

```text
WHEN
WHERE
WHAT
WHAT NEXT
HOW TO RETRY
HOW TO RESUME
```

Settle owns:

```text
STILL VALID?
```

---

## Settlement is not Promise settlement

JavaScript already uses the word `settled` for Promises.

For a Promise:

```text
fulfilled
or
rejected
```

means the Promise has settled.

Settle uses a stronger meaning.

A system is settled when:

> **All accepted observable results are valid for the current causal state, and
> no required current work remains capable of changing that observable state.**

That does not require every physical operation to stop.

For example:

```text
old execution A#1 ---------------------------->
                       superseded

new execution A#2 ----------> committed
```

A#1 may still be running.

If A#1 has permanently lost commit authority, its eventual result cannot change
current observable state.

The system may therefore already be settled.

> **Settlement is an observable-validity property, not an
> absence-of-running-work property.**

---

## Cancellation is not correctness

Settle separates cancellation from result validity.

Some operations can be cancelled.

Some cannot.

Some only support best-effort cancellation.

For correctness, Settle must not depend on cancellation succeeding.

```text
execution A#1 starts

revision changes

A#1 becomes superseded

cancel(A#1)
    |
    +-- succeeds
    |
    `-- fails / unsupported
```

In either case:

```text
A#1 loses commit authority
```

If A#1 later resolves, its result is rejected.

Therefore:

```text
cancellation
    =
resource management
```

while:

```text
commit validation
    =
correctness
```

---

## Selective reuse

A changing input does not imply that all previous work becomes invalid.

Consider:

```text
A changes

B depends on A
C does not depend on A
```

Then:

```text
B
-> invalidated
-> recomputed

C
-> remains valid
-> reused
```

Settle preserves fine-grained reuse rather than treating every update as a full
workflow restart.

This is one reason Settle is built on signal-kernel primitives.

---

## Execution identity

Settle distinguishes logically separate executions.

Conceptually:

```text
A#12
A#13
A#14
```

Each execution may carry enough causal information to determine:

* what state created it
* whether it remains current
* whether another execution superseded it
* whether its result may commit
* how it appears in traces

Execution identity is a correctness concept.

It is not necessarily a globally unique workflow or distributed-job ID.

---

## Commit authority

Producing a value does not imply permission to expose it.

Conceptually:

```text
execution starts
      |
captures causal state
      |
performs work
      |
produces candidate result
      |
      v
validate current authority
      |
  ┌───┴─────────┐
  │             │
current     superseded
  │             │
  v             v
commit        reject
```

An execution may lose commit authority because of:

* a newer causal revision
* dependency invalidation
* explicit invalidation
* runtime disposal
* restore boundaries
* application-defined validity policy

The public API for commit authority is still experimental.

The invariant is not.

---

## Conceptual API

The final API is not frozen.

The intended direction is intentionally small:

```ts
import {
  defineSettlement,
  createSettler,
} from "@signal-kernel/settle";

const definition = defineSettlement<Input, Output>((context) => {
  return {
    receive(input) {
      // Application owns how input is interpreted.
    },

    readOutput() {
      // Return the current valid output.
    },
  };
});

const settler = createSettler(definition);

settler.receive(input);

await settler.settle();

const output = settler.emit();
```

The important part is what is **not** here.

Settle should not evolve toward APIs such as:

```ts
defineWorkflow(...)
addNode(...)
addEdge(...)
branch(...)
join(...)
schedule(...)
retry(...)
```

Those are orchestration concerns.

---

## Conceptual lifecycle

A Settle instance may eventually expose a lifecycle similar to:

```ts
type Settler<Input, Output, SnapshotState> = {
  receive(input: Input): void;

  settle(): Promise<void>;

  emit(): Output;

  inspect(): SettlementInspection<Output>;

  snapshot(): SettlementSnapshot<SnapshotState>;

  trace(): readonly SettlementTraceEvent[];

  subscribe(
    listener: (event: SettlementTraceEvent) => void,
  ): () => void;

  dispose(): void;
};
```

This interface remains experimental.

The implementation will be driven by demonstrated behavior rather than API
surface growth.

---

## Snapshot and restore

Settle is designed so correctness does not require one JavaScript object to stay
alive forever.

A lifecycle may cross process boundaries:

```text
create
  |
execute
  |
snapshot
  |
process ends
  |
restore
  |
continue
```

Snapshots may contain:

* causal revisions
* execution metadata
* reusable settled values
* application-owned serializable state
* validity metadata

Snapshots must not contain live objects such as:

* Promises
* AbortController instances
* subscriptions
* callbacks
* timers
* sockets
* resource handles
* runtime object references

Pending execution itself is not serialized.

Required work is reconstructed after restore.

---

## Restore isolation

Restoring a snapshot creates a new live runtime.

```text
runtime A
   |
snapshot
   |
   +----------> runtime B
   |
   `----------> runtime C
```

B and C may share serialized history.

They must not share:

* signals
* pending executions
* subscriptions
* AbortControllers
* mutable runtime objects

Late work from A must not be able to commit into B or C.

---

## Traceability

Execution validity should be observable.

Candidate trace concepts include:

```text
started
completed
invalidated
pending
resolved
cancelled
reused
recomputed
superseded
rejected
committed
restored
settled
```

Important distinctions include:

```text
completed != committed
resolved  != accepted
cancelled != superseded
```

A trace should eventually be able to answer:

* Which execution produced this result?
* Which causal revision created it?
* Why was the result rejected?
* Why was previous work reused?
* What caused recomputation?
* Which execution superseded another?
* When did current state become settled?

Settle owns the semantic trace contract.

It does not own:

* trace persistence
* dashboards
* LangSmith
* OpenTelemetry exporters

---

## Host interoperability

Interoperability with existing execution hosts is a core validation strategy.

The goal is **not** to turn Settle into an adapter framework.

The goal is to prove that the same validity semantics survive different
execution models.

Current validation order:

```text
1. Plain async
2. LangGraph
3. Inngest
4. Temporal
```

---

## Plain async

The first Settle-native example should require no workflow engine.

```text
revision 1
  -> A#1 starts

revision 2 arrives
  -> A#1 superseded
  -> A#2 starts

A#1 completes
  -> rejected

A#2 completes
  -> committed

current state
  -> settled
```

This establishes the minimum abstraction.

If Settle cannot explain this case independently, it is not ready to integrate
with larger runtimes.

---

## LangGraph

LangGraph is the first real workflow-host validation target.

The intended ownership boundary is:

```text
LangGraph
  |
  |- graph topology
  |- node scheduling
  |- threads
  |- checkpoint policy
  |
  v
LangGraph node
  |
  v
Settle
  |
  |- validity
  |- invalidation
  |- supersession
  |- commit
  `- settlement
```

Settle does not own LangGraph routing.

LangGraph durable state may contain serialized Settle state.

It should never contain a live Settle instance.

Existing validation work lives in:

```text
reactive-correction-graph
```

---

## Inngest

Inngest provides a different execution model with durable step boundaries and
host-owned retry and step-result reuse.

Settle should therefore work through serialized continuity rather than assuming
a continuously alive runtime.

Conceptually:

```text
Inngest step
    |
restore Settle state
    |
receive input
    |
run application work
    |
settle
    |
return output + snapshot
```

Settle must not duplicate:

* Inngest retries
* durable step scheduling
* step memoization

The integration exists to validate compatibility, not to import Inngest
semantics into Settle.

---

## Temporal

Temporal is the strongest initial interoperability stress test.

Temporal introduces additional requirements around durable execution and
deterministic replay.

Settle must therefore avoid hidden nondeterministic correctness dependencies.

Conceptually, one integration may look like:

```text
Temporal Workflow
       |
       v
    Activity
       |
       v
     Settle
```

A stronger future integration may allow deterministic Settle validity state to
participate directly in workflow decisions.

For example:

```text
revision 12
    |
Activity A#12 scheduled
    |
revision 13 arrives
    |
A#12 superseded
    |
A#12 completes
    |
result delivered
    |
Settle rejects obsolete result
```

Temporal still owns durable execution.

Settle owns result validity.

A production Temporal adapter is not a requirement for the first experimental
release.

---

## Integration package policy

Initial host integrations should remain examples:

```text
examples/
  plain-async/
  langgraph/
  inngest/
  temporal/
```

Do not assume the project needs packages such as:

```text
@signal-kernel/settle-langgraph
@signal-kernel/settle-inngest
@signal-kernel/settle-temporal
```

Adapters should only become packages if real integration experience reveals
substantial reusable logic.

Thin host glue is preferred.

If every host requires a large adapter, that is evidence the Settle abstraction
may be wrong.

---

## Reference application

[`reactive-correction-graph`](https://github.com/Luciano0322/reactive-correction-graph)
is the primary real-world validation project for Settle.

It demonstrates execution-validity behavior inside an AI workflow, including:

* selective recomputation
* reuse of unaffected work
* stale-result rejection
* superseded asynchronous execution
* snapshot continuity
* restored-session isolation
* multi-agent boundaries
* LangGraph integration

The project remains application-specific.

Settle must not depend on:

```text
Agent
LLM
FactCheck
Writer
Correction
LangGraph
```

concepts.

The reference application exists as evidence for the abstraction, not as its
domain model.

---

## Relationship to signal-kernel

Settle is a higher-level semantic layer built on signal-kernel primitives.

Conceptually:

```text
@signal-kernel/core
        |
@signal-kernel/async-runtime
        |
@signal-kernel/snapshot
        |
@signal-kernel/settle
        |
application
```

The layers have different responsibilities.

### `@signal-kernel/core`

Owns fine-grained reactive dependency tracking.

### `@signal-kernel/async-runtime`

Owns asynchronous reactive execution primitives.

### `@signal-kernel/snapshot`

Owns serializable runtime continuity primitives.

### `@signal-kernel/settle`

Owns higher-level execution-validity and settlement semantics.

Lower-level packages must not depend on Settle.

---

## Design constraints

Settle should remain:

* framework-neutral
* domain-neutral
* ESM-first
* browser-compatible
* Node-compatible
* worker-compatible
* SSR-safe
* serializable where continuity requires it
* deterministic where host execution requires it

Settle core must not depend on:

* LangGraph
* Inngest
* Temporal
* React
* Vue
* DOM APIs
* Node-only infrastructure
* LLM providers
* correction-domain code

---

## Determinism

Settle should be capable of deterministic operation.

Correctness should not depend on hidden calls to:

```ts
Date.now()
Math.random()
crypto.randomUUID()
```

Clock, ID generation, or similar host-sensitive capabilities should be
injectable or deterministically derived when necessary.

This is particularly important for replay-based execution systems.

---

## Experimental status

Settle is currently under active design.

The following areas are intentionally not frozen:

* execution registration API
* causal revision representation
* public commit-authority API
* inspection contract
* trace taxonomy
* snapshot wrapper API
* host integration helpers
* error types

The project will prefer:

```text
small semantics
+
strong invariants
+
multiple external validations
```

over:

```text
large API surface
+
speculative flexibility
```

---

## Initial validation goals

Before an experimental `0.1.0` release, Settle should demonstrate:

* superseded executions cannot commit
* cancellation is not required for stale-result safety
* current executions can commit
* unaffected settled work can be reused
* selective recomputation works
* settlement can occur while obsolete physical work still runs
* snapshots restore compatible validity state
* pending work is reconstructed rather than serialized
* pre-restore work cannot mutate restored state
* restored runtimes remain isolated
* disposal removes commit authority
* trace semantics remain coherent
* plain async usage works
* LangGraph integration works
* Inngest interoperability is validated
* Temporal has a safe integration boundary

---

## Non-goals

Settle does not aim to become:

* Temporal
* Inngest
* LangGraph
* Airflow
* a new agent framework
* a distributed scheduler
* a job queue
* a persistence platform

The project should remain focused on one question:

> **When causal state changes while work is executing, which results still
> count?**

---

## Project direction

The architectural test for Settle is not:

> Can Settle execute every type of workflow?

It is:

> **Can systems with very different execution models use the same validity
> semantics to decide whether asynchronous work still represents the current
> world?**

If that remains true across plain async code, LangGraph, Inngest, Temporal, and
other execution hosts, then Settle is doing its job.
