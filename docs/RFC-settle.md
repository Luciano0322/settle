# RFC: `@signal-kernel/settle`

* Status: Proposed
* Date: 2026-07-20
* Last revised: 2026-09-15
* Target release: experimental `0.1.0`
* Repository: `settle`
* npm package: `@signal-kernel/settle`
* Primary validation repository: `reactive-correction-graph`
* Interoperability targets: Plain Async, LangGraph, Inngest, Temporal
* Readiness audit: Not ready
* Extraction decision: Repository creation accepted; package publication remains gated

---

## Summary

Create a framework-neutral and domain-neutral package named:

```txt
@signal-kernel/settle
```

The source repository is named:

```txt
settle
```

Settle provides execution-validity and settlement semantics for systems where
causal inputs may change while asynchronous work is still executing.

Its central rule is:

> **Completion does not imply settlement.**

An execution may complete successfully after the causal state that produced it
has already changed.

Such an execution is completed, but its result may no longer be authorized to
affect current observable state.

Settle is responsible for determining:

* which executions are current
* which executions have been superseded
* which results may commit
* which settled results remain reusable
* which validity obligations require new application work
* when current observable state is settled

Settle is explicitly **not** a workflow engine.

It does not own:

* workflow topology
* task scheduling
* step execution
* routing
* retry policy
* worker allocation
* queueing
* orchestration persistence
* distributed execution

Existing workflow systems remain responsible for deciding:

> **What should execute, when should it execute, and how should execution be orchestrated?**

Settle answers a different question:

> **Given that execution happened while the world may have changed, does this result still count?**

A major design goal is therefore interoperability with existing execution hosts
rather than replacement of them.

Initial interoperability targets are:

```txt
Plain async application code
LangGraph
Inngest
Temporal
```

These systems intentionally have different execution and durability models.

Settle succeeds as an abstraction only if its core validity semantics can remain
stable across those differences.

---

# Core Principle

Settle distinguishes:

```txt
execution completion
```

from:

```txt
execution validity
```

and from:

```txt
system settlement
```

These are not equivalent.

```txt
completed != committed
completed != settled
running   != unsettled
cancelled != superseded
```

Example:

```txt
revision 1
    |
    v
execution A#1 starts
    |
revision 2 arrives
    |
    v
A#1 becomes superseded
    |
    v
A#1 eventually completes
```

Completion alone does not allow the result to become observable.

The result must still pass the current validity boundary.

```txt
A#1 completed
    |
    v
still current?
    |
  no
    |
    v
commit rejected
```

A new execution may instead represent the current state:

```txt
revision 2
    |
    v
execution A#2
    |
    v
completed
    |
    v
still current
    |
    v
commit accepted
```

---

# Normative Validity Contracts

The following contracts define Settle independently of any particular public
API shape or execution host.

## 1. Settlement is revision-scoped

`settle(revision)` evaluates the causal revision supplied by the caller. When
the returned Promise fulfills, it terminates with exactly one semantic outcome:

```txt
settled
or
superseded
```

A settlement operation does not silently retarget itself to a newer revision.
If the host wants to settle the newer revision, it starts a separate settlement
operation for that revision.

Execution failures, disposal, invalid arguments, and other operational errors
may reject the Promise according to the error contract. They do not create a
third successful settlement outcome.

## 2. Required obligations block settlement

A causal revision cannot settle while any required validity obligation for that
revision remains unsatisfied.

A required obligation describes a condition that must hold before observable
state is valid for the revision. It is not a task, queue entry, workflow node,
or instruction for Settle to execute application work.

Settle may identify or invalidate obligations through its internal reactive
model. The application or host performs any application work needed to satisfy
them.

## 3. Candidate results have execution and causal identity

Every candidate result is associated with:

* one identified execution
* the causal revision that authorized that execution

Anonymous results, or results whose causal origin cannot be established, cannot
commit as current observable state.

## 4. Validation and commit are atomic

Candidate validation and observable commit form one atomic validity transition
with respect to causal revision changes.

A candidate must not be validated under revision N and then become observable
after revision N+1 has revoked its commit authority. If a causal revision change
wins the ordering boundary, the obsolete candidate is rejected. If the commit
wins, the committed result belongs to the revision that was current for that
atomic transition.

---

# Settlement Definition

Settle uses a stronger meaning of **settled** than JavaScript Promise
settlement.

A Promise being fulfilled or rejected means that the Promise completed.

It does not mean its result is still valid.

For a causal revision N, Settle defines settlement approximately as:

> **All observable accepted results are valid for revision N, and no required
> validity obligation for revision N remains unsatisfied or capable of changing
> that observable state.**

`settle(N)` may report `settled` only while N remains the authoritative causal
revision for that settlement operation. If N is superseded before settlement,
`settle(N)` reports `superseded`; it does not begin waiting for the replacement
revision.

This definition intentionally does not require all physical execution to stop.

For example:

```txt
old execution A#1 ---------------------------->
                       superseded

new execution A#2 ----------> committed
```

A#1 may still be running because:

* the underlying operation cannot be cancelled
* cancellation is best-effort
* cancellation would be more expensive than allowing completion

If A#1 has permanently lost commit authority, it no longer prevents the current
system from being settled.

Therefore:

> **Settlement is an observable-validity property, not an absence-of-running-work property.**

---

# Motivation

`@signal-kernel/core`, `@signal-kernel/async-runtime`, and
`@signal-kernel/snapshot` already provide lower-level mechanisms used by the
`reactive-correction-graph` proof of concept.

That application currently contains reusable execution semantics alongside
application-specific correction logic.

Generic mechanics include:

* causal input revisions
* execution identity
* batched state changes
* dependency invalidation
* selective recomputation
* supersession
* stale-result containment
* commit validity
* stable-result reuse
* async cancellation
* settlement detection
* trace collection
* snapshot
* restore
* post-restore recomputation

Application-specific concepts include:

* drafts
* claims
* fact checks
* style reviews
* correction plans
* rewrites
* FactCheck Agent
* Writer Agent

The purpose of Settle is not to move the correction runtime into another
package.

The purpose is to identify and extract only those semantics that remain useful
after removing:

```txt
Correction
Agent
LLM
LangGraph
UI
```

from the model.

---

# Why Settle Is Not a Workflow Engine

Workflow engines answer questions such as:

```txt
What runs next?

Which branch should execute?

Should these jobs run in parallel?

When should this step retry?

Where should this task execute?

How should this workflow resume after a crash?
```

Settle should not answer those questions.

Settle instead answers:

```txt
Which causal state created this execution?

Is this execution still current?

Has it been superseded?

May this candidate result commit?

Can this previous settled value still be reused?

Does current observable state represent current causal state?

Has the system settled?
```

This boundary is intentional.

The project should avoid introducing concepts such as:

```txt
workflow node
workflow edge
branch
join
fan-out
fan-in
worker
job queue
cron
step scheduler
routing
```

unless they are strictly application-level terminology outside the Settle core.

A dependency used to determine result validity is not the same thing as a
workflow edge used to determine execution order.

Settle owns the former.

It does not own the latter.

---

# Host Interoperability Principle

Settle is designed to be embedded inside execution hosts.

The intended relationship is:

```txt
┌────────────────────────────┐
│ Existing execution host    │
│                            │
│ LangGraph                  │
│ Inngest                    │
│ Temporal                   │
│ custom worker              │
│ plain async code           │
└─────────────┬──────────────┘
              │
              │ executes work
              ▼
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
              │
              ▼
     signal-kernel primitives
```

The host determines:

```txt
WHEN
WHERE
WHAT
WHAT NEXT
HOW TO RETRY
HOW TO RESUME
```

The host or application also performs the actual work of every execution.

Settle drives only:

```txt
validity propagation
invalidation
internal reactive recomputation
commit evaluation
settlement evaluation
```

It may identify that application work is required, but it does not run that
work. The host decides whether and when to execute it and whether to begin a new
settlement operation after supersession.

Settle must not require a host to replace its existing workflow model with a
Settle-specific DSL.

---

# Host Independence Requirements

To remain interoperable across different workflow engines, Settle must satisfy
the following architectural requirements.

## 1. No process-continuity assumption

Settle must not require one live JavaScript object to survive for the entire
logical lifetime of an execution.

A valid lifecycle may include:

```txt
create runtime
    |
execute
    |
snapshot
    |
process disappears
    |
restore
    |
continue
```

Correctness semantics must survive this boundary where sufficient serialized
state exists.

---

## 2. No retry ownership

Settle does not automatically retry failed execution.

The host may already own retry semantics.

Adding a second hidden retry layer could create:

```txt
host retry
    x
Settle retry
```

with difficult-to-reason-about multiplicative behavior.

Retry, fallback, backoff, compensation, provider switching, and idempotency
remain outside Settle v1.

---

## 3. Cancellation is separate from validity

Cancellation is not the correctness mechanism.

A host may:

* support cancellation
* partially support cancellation
* ignore cancellation
* be unable to cancel already-running work

Settle must still guarantee:

> A superseded execution cannot commit merely because it could not be cancelled.

Therefore:

```txt
cancel()
```

is resource management.

```txt
commit validation
```

is correctness.

---

## 4. Deterministic operation must be possible

Settle core must be capable of operating without hidden nondeterministic inputs.

Values such as:

```txt
clock
execution IDs
revision IDs
randomness
```

must either be derived deterministically or injectable where necessary.

Settle must not require internal unconditional use of:

```ts
Date.now()
crypto.randomUUID()
Math.random()
```

for correctness.

This requirement is particularly important for compatibility with replay-based
durable execution hosts.

---

## 5. Serialized continuity must not include live execution objects

Snapshots may contain:

* causal revisions
* execution metadata
* reusable settled values
* application-defined serializable state
* validity metadata

Snapshots must not contain:

* Promises
* AbortController instances
* subscriptions
* callbacks
* sockets
* timers
* runtime object references
* live framework objects

---

# Proposed Layering

```txt
@signal-kernel/core
        |
@signal-kernel/async-runtime
        |
@signal-kernel/snapshot
        |
@signal-kernel/settle
        |
application-specific semantics
        |
execution hosts
```

Possible execution hosts include:

```txt
plain async application
LangGraph
Inngest
Temporal
custom workflow runtime
agent framework
background worker
HTTP server
CLI
```

The important architecture rule is:

```txt
signal-kernel primitives
        ↓
      Settle
        ↓
applications / integrations
```

Dependencies must not reverse.

In particular:

```txt
@signal-kernel/core
```

must never acquire:

* workflow semantics
* agent semantics
* Settle-specific commit concepts
* host-specific execution concepts

solely to support Settle.

---

# Repository And Package Boundaries

Repository:

```txt
settle/
```

Published package:

```txt
@signal-kernel/settle
```

Initial repository shape:

```txt
settle/
  src/
  tests/
  examples/
    plain-async/
    langgraph/
    inngest/
    temporal/
  docs/
  package.json
```

Integration examples do not imply host dependencies belong to the Settle core
package.

Examples may use development dependencies.

The core package must remain host-neutral.

---

# Reference Application Boundary

`reactive-correction-graph` remains an external reference consumer.

Its responsibilities remain application-specific:

```txt
reactive-correction-graph/
  correction semantics
  FactCheck Agent
  Writer Agent
  coordinator
  LangGraph example
  deterministic fixtures
  evidence reports
```

Its future architecture should move toward:

```txt
reactive-correction-graph
        |
        v
@signal-kernel/settle
        |
        v
signal-kernel primitives
```

The application should eventually stop implementing generic validity mechanics
such as:

```txt
receiveEpoch
inputVersion
input-key freshness
superseded commit guards
generic settlement tracking
```

when equivalent behavior exists safely inside Settle.

Correction-specific invalidation policy remains application-owned.

---

# Dependency Policy

Initial candidate dependencies:

```json
{
  "peerDependencies": {
    "@signal-kernel/core": "<compatible-range>",
    "@signal-kernel/async-runtime": "<compatible-range>",
    "@signal-kernel/snapshot": "<compatible-range>"
  }
}
```

The exact dependency arrangement remains open until duplicate-package behavior
is tested.

Settle development and validation target the latest compatible public contract
of `@signal-kernel/async-runtime`. The older `0.3.0` dependency used by the
initial `reactive-correction-graph` POC is evidence for behavior, not the
implementation baseline for Settle.

In particular, Settle interoperability must align with the current
async-runtime semantics for:

* object-form resource descriptors
* active execution identity
* stale callback and stale result containment
* best-effort cancellation
* explicit disposal and cleanup ownership
* the distinction between visible stream value and stable stream value

Alignment does not transfer application execution ownership to Settle and does
not make an async-runtime stable value equivalent to a Settle-committed result.

The Settle core package must not depend on:

```txt
@langchain/langgraph
@langchain/core
inngest
@temporalio/*
React
Vue
Node-only persistence packages
LLM provider SDKs
reactive-correction-graph
```

Host integrations belong in examples initially.

Reusable adapters may be considered only after repeated integration evidence
shows that an adapter provides meaningful value beyond a small amount of host
glue code.

---

# Proposed Public Surface

The following names express intended semantics and are not frozen APIs.

```ts
export {
  defineSettlement,
  createSettler,
} from "@signal-kernel/settle";

export type {
  SettlementRevision,
  SettlementOutcome,
  SettlementDefinition,
  SettlementContext,
  Settler,
  SettlementInspection,
  SettlementSnapshot,
  SettlementTraceEvent,
  SettlementError,
} from "@signal-kernel/settle";
```

Conceptual usage:

```ts
const definition = defineSettlement<Input, Output, SnapshotState>((context) => {
  return {
    receive(input) {
      // Application owns input interpretation.
    },

    readOutput() {
      // Return output valid for current causal state.
    },

    snapshotState() {
      // Application-owned serializable state.
    },
  };
});

const settler = createSettler(definition);

const revision = settler.receive(input);

const outcome = await settler.settle(revision);

if (outcome.status === "settled") {
  const output = settler.emit();
}
```

Conceptually, the settlement result distinguishes the two successful lifecycle
outcomes:

```ts
type SettlementOutcome<Revision> =
  | {
      status: "settled";
      revision: Revision;
    }
  | {
      status: "superseded";
      revision: Revision;
      supersededBy: Revision;
    };
```

The concrete revision representation and exact result type remain exploratory.
The semantic requirements do not: the caller selects one revision, and a
fulfilled settlement operation reports either `settled` or `superseded` for
that revision.

Conceptual lifecycle interface:

```ts
type Settler<Input, Output, SnapshotState, Revision> = {
  receive(input: Input): Revision;

  settle(revision: Revision): Promise<SettlementOutcome<Revision>>;

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

This API remains exploratory.

The public interface will also need a minimal host-facing way to associate an
execution with a revision and submit its candidate result. That interface is
intentionally not named here yet. It must expose validity semantics without
asking Settle to schedule or perform the application execution.

Whatever concrete names are chosen, the interaction must preserve this
ownership:

```txt
host starts application execution
        |
        v
Settle associates execution identity with causal revision
        |
        v
host performs application work
        |
        v
host submits identified candidate result
        |
        v
Settle atomically validates and commits, or rejects
```

In particular, Settle must avoid growing into:

```ts
defineWorkflow(...)
addNode(...)
addEdge(...)
branch(...)
schedule(...)
```

Those would indicate that orchestration ownership is leaking into the package.

---

# Execution Identity

Settle must be able to distinguish logically separate executions.

Conceptually:

```txt
execution A#12
execution A#13
```

An execution identity allows Settle to reason about:

* origin
* causal revision
* supersession
* result ownership
* trace history
* commit authority

Every execution known to Settle must be associated with exactly one causal
revision. Every candidate result must identify both that execution and its
causal revision before commit evaluation can occur.

The host owns execution. Settle owns the identity and validity association
needed to evaluate whether the execution's candidate still has commit
authority.

Execution identity is not necessarily a globally unique distributed workflow
identifier.

Its exact scope remains part of API design.

---

# Causal State

Settle requires enough information to determine whether an execution still
belongs to the current state.

This may be represented using concepts such as:

```txt
revision
generation
epoch
dependency identity
input fingerprint
causal token
```

The public API should not freeze a specific representation until the reference
implementations establish the minimum useful contract.

The essential invariant is:

> An execution result must be validated against the causal state that made that
> execution relevant.

A settlement operation captures one causal revision as its immutable scope.
Creation and representation of revision values remain API-design questions,
but a running settlement operation never changes its revision to follow newer
causal state.

Conceptually, `receive(input)` establishes a new causal revision and makes that
revision available to the caller for later execution association and
`settle(revision)`. Whether callers may provide externally assigned revision
identities remains part of the representation decision.

---

# Commit Authority

Producing a result does not imply permission to expose it.

Conceptually:

```txt
execution starts
      |
captures causal state
      |
performs work
      |
produces candidate result
      |
      v
validate commit authority
      |
  ┌───┴─────────┐
  │             │
current     superseded
  │             │
  v             v
commit        reject
```

An execution may lose commit authority because of:

* newer causal state
* dependency invalidation
* explicit invalidation
* runtime disposal
* restore boundaries
* application-defined validity rules

Whether commit authority appears directly in the public API remains unresolved.

It may remain an internal invariant if that produces a safer API.

Regardless of API shape, validation and observable commit must occur as one
atomic transition with respect to causal revision changes. Settle must not
return a reusable authorization that can be validated under one revision and
applied after that revision has been superseded.

---

# Selective Reuse

A change in input does not automatically invalidate all existing work.

Example:

```txt
A changes

B depends on A
  -> invalidated
  -> recomputation obligation recorded
  -> host recomputes

C independent of A
  -> remains valid
  -> reuse
```

Settle should preserve fine-grained dependency behavior from signal-kernel
instead of degrading all state changes into full workflow restart.

Reuse is valid only when the runtime can establish that the previous result
still represents current causal state.

When invalidation makes new application work necessary, Settle records the
corresponding required validity obligation. The host performs the work and
submits an identified candidate result; Settle does not execute the work.

---

# Settlement Process

The implementation may internally use repeated propagation:

```txt
causal state changes
        |
        v
invalidate affected work
        |
        v
supersede obsolete execution
        |
        v
reuse unaffected settled values
        |
        v
identify / track required current validity obligations
        |
        v
validate candidate results
        |
        v
commit valid results
        |
        v
propagate downstream changes
        |
        v
repeat until stable
```

This resembles a fixed-point process.

However:

> Fixed-point execution is an implementation mechanism, not the public
> definition of Settle.

The semantic definition remains based on validity of current observable state.

This propagation loop contains no application executor. "Required" means that
an obligation blocks settlement until the host satisfies it or the scoped
revision is superseded. It does not mean Settle schedules, invokes, retries, or
resumes application work.

---

# Receive During Settlement

A new `receive()` may happen while `settle(revision)` is still waiting.

Example:

```txt
receive revision 10
        |
settle begins
        |
execution A#10 running
        |
receive revision 11
```

A#10 may then become superseded.

A settlement operation is scoped to the causal revision supplied when
settlement begins. If revision 11 supersedes revision 10 before settlement,
`settle(10)` terminates as `superseded` by revision 11. It does not wait for
revision 11.

The host may choose to call `settle(11)`. Automatically following newer
revisions is host policy and is not a Settle core guarantee.

Settle does not guarantee that revision 10 will independently finish producing
a committed output.

Applications requiring:

```txt
revision 10 result
then
revision 11 result
then
revision 12 result
```

must provide FIFO serialization above Settle.

Settle optimizes for current-state correctness rather than command-history
completion.

---

# Error Semantics

V1 propagates failures but does not automatically retry.

A fulfilled settlement Promise has only the `settled` and `superseded`
outcomes. A relevant operational failure may reject the Promise; it is not a
third successful settlement outcome.

Failure relevance depends on causal validity.

Example:

```txt
execution A#1 fails
```

If A#1 was already superseded, that failure does not necessarily invalidate
current settlement. Once the scoped revision is superseded, a late failure from
its obsolete execution cannot replace the settlement operation's
`superseded` outcome.

The runtime should distinguish:

```txt
current failure
obsolete failure
```

where necessary.

Typed error semantics remain subject to black-box validation.

---

# Snapshot And Restore

Snapshots provide continuity, not persistence policy.

Requirements:

* versioned
* JSON-compatible
* associated with a compatible settlement definition
* preserve required causal validity information
* restore reusable settled values where safe
* omit live pending execution objects
* restore omitted work as unsatisfied required obligations
* isolate restored runtimes
* reject incompatible schema or definition identities
* prevent pre-restore work from mutating restored state

Conceptual flow:

```txt
Settle instance A
      |
      v
snapshot
      |
      v
serialize
      |
process boundary
      |
      v
restore
      |
      v
Settle instance B
```

A and B never share live state.

Restore does not execute omitted application work. It reconstructs enough
validity state for Settle to report which obligations remain unsatisfied. The
host decides whether and when to perform the work needed to satisfy them.

Persistence location remains host-owned:

```txt
memory
database
file
object storage
LangGraph checkpoint
Inngest step result
Temporal workflow state
other host-specific storage
```

Settle does not implement those persistence systems.

---

# Trace Contract

Trace is a versioned public semantic contract.

Candidate event concepts include:

```txt
started
completed
changed
invalidated
pending
resolved
rejected
cancelled
reused
restored
recomputed
superseded
committed
settled
```

The trace must distinguish the subject of supersession. At minimum, consumers
must be able to tell whether an event describes an execution losing commit
authority or a revision-scoped settlement operation terminating because a
newer revision superseded it.

Important distinctions include:

```txt
completed != committed
cancelled != superseded
resolved  != accepted
```

A trace event should contain enough information to answer:

```txt
Which execution produced this result?

Which causal revision created it?

Why was it rejected?

Why was previous work reused?

What caused recomputation?

Which execution superseded which?

Which revision did a settlement operation evaluate?

Did that operation settle or terminate as superseded?
```

Candidate envelope fields include:

* event identity
* order
* causal revision
* execution identity
* scope
* event type
* label
* JSON-compatible metadata

Settle does not own:

* trace persistence
* dashboard UI
* LangSmith
* OpenTelemetry exporters

These may consume the trace contract externally.

---

# Interoperability Validation Strategy

Host interoperability is a first-class architectural validation strategy.

The goal is not to provide four production adapters in `0.1.0`.

The goal is to prove that the same Settle semantics survive four increasingly
different execution environments.

Recommended order:

```txt
1. Plain async
2. LangGraph
3. Inngest
4. Temporal
```

Each stage validates a different property of the abstraction.

---

# Plain Async Validation

The first reference example must not use any workflow framework.

Example:

```txt
revision 1
  -> host starts execution A#1
  -> settle(revision 1) begins

revision 2
  -> A#1 superseded
  -> settle(revision 1) terminates as superseded
  -> host starts execution A#2
  -> settle(revision 2) begins

A#1 completes
  -> rejected

A#2 completes
  -> committed

settle(revision 2)
  -> settled
```

This establishes the minimum semantics without host-specific behavior.

It proves that Settle is not merely an adapter layer around another runtime.

---

# LangGraph Integration

LangGraph is the first workflow-engine integration because
`reactive-correction-graph` already provides substantial evidence for this
boundary.

Conceptual ownership:

```txt
LangGraph
  |
  |- graph topology
  |- node scheduling
  |- thread lifecycle
  |- checkpoint policy
  |
  v
LangGraph node
  |
  v
Settle
  |
  |- execution validity
  |- invalidation
  |- supersession
  |- commit validity
  `- settlement
```

LangGraph state may contain serialized Settle state.

It must not contain live Settle runtime objects.

Conceptually:

```ts
{
  graphState,
  settleSnapshot
}
```

is valid.

Storing:

```ts
{
  settler
}
```

inside durable graph state is not.

Settle does not own LangGraph node routing or graph topology.

The existing `reactive-correction-graph` repository remains the primary
LangGraph reference integration.

---

# Inngest Integration

Inngest provides a different validation model because execution may cross
checkpointed step boundaries and previously successful step results may be
reused by the host.

Settle must therefore avoid assuming continuous process-local lifetime.

A conceptual pattern is:

```txt
Inngest step
    |
    v
restore Settle state
    |
    v
revision = receive current input
    |
    v
host executes local work
    |
    v
settle(revision)
    |
    v
serialize output + snapshot
```

Settle must not duplicate:

* host retry policy
* host step memoization
* durable step scheduling

The integration should test whether Settle's own reuse and validity model can
coexist cleanly with host-managed durable step semantics.

This is an interoperability test, not a reason to make Settle aware of Inngest.

---

# Temporal Integration

Temporal is the strongest initial interoperability stress test.

The main concern is compatibility between Settle's execution semantics and a
host whose workflow model may rely on deterministic replay.

Settle must therefore be able to operate without hidden nondeterminism.

Two conceptual integration patterns should be explored.

## Pattern A: Settle inside an Activity

```txt
Temporal Workflow
      |
      v
Temporal Activity
      |
      v
Settle
```

Temporal owns:

* durable orchestration
* activity scheduling
* activity retries
* workflow history

Settle owns local execution validity inside the Activity boundary.

This is the simpler integration.

---

## Pattern B: deterministic Settle state inside Workflow logic

A stronger integration may allow deterministic Settle state to participate
directly in workflow-level decisions.

Example:

```txt
revision 12
    |
Activity A#12 scheduled
    |
new workflow input / signal
    |
revision 13
    |
A#12 becomes superseded
    |
A#12 eventually completes
    |
Temporal delivers result
    |
Settle validity check
    |
reject obsolete result
```

Temporal remains responsible for delivering the Activity result.

Settle decides whether that result still belongs to current causal state.

This pattern must not require Settle to perform nondeterministic side effects
inside deterministic workflow execution.

Temporal compatibility therefore acts as a stress test for:

* deterministic IDs
* deterministic revision transitions
* serializable validity state
* replay-safe state reconstruction
* separation between execution and commit validity

A production Temporal adapter is not required for `0.1.0`.

---

# Integration Package Policy

Initial host support should remain examples rather than packages:

```txt
examples/
  plain-async/
  langgraph/
  inngest/
  temporal/
```

Do not immediately create:

```txt
@signal-kernel/settle-langgraph
@signal-kernel/settle-inngest
@signal-kernel/settle-temporal
```

Adapters should become publishable packages only if integration experience shows
substantial repeated logic that cannot reasonably remain a small example.

The default expectation is:

> A strong core semantic contract should require only thin host glue.

If every host requires large Settle-specific integration machinery, that is
evidence that the abstraction may be wrong.

---

# Multi-Agent Validation

The existing correction POC uses:

```txt
FactCheck Agent
Writer Agent
Coordinator
```

Each agent owns private runtime state.

The coordinator owns:

* routing
* correlation
* message lifecycle

Settle must not learn these concepts.

Multi-agent validation is useful because it proves:

* runtime isolation
* causal version separation
* stale result rejection
* serialized communication boundaries
* restore isolation

But multi-agent coordination remains application code.

Settle is not an agent framework.

---

# Extraction Gates

The `settle` repository may be created immediately for:

* RFC development
* semantic documentation
* black-box behavior tests
* experiments
* generic examples
* interoperability prototypes

Publishing `@signal-kernel/settle` remains gated.

Before experimental `0.1.0`, evidence should prove:

1. `settle(revision)` fulfills as `settled` or `superseded` and never silently
   follows a newer revision.

2. A revision cannot settle while any required obligation remains unsatisfied.

3. Every candidate result identifies both its execution and causal revision.

4. Candidate validation and observable commit are atomic with respect to
   causal revision changes.

5. A generic plain-async example demonstrates supersession and settlement.

6. Completion does not imply commit.

7. A superseded execution cannot commit.

8. Cancellation is not required for stale-result correctness.

9. Unaffected settled work can be reused.

10. Settle can identify selective recomputation obligations without executing
    application work.

11. Restored settled state can be reused.

12. Pending work is not serialized; restore reconstructs unsatisfied
    obligations and the host performs any required application work.

13. Pre-restore execution cannot commit into restored state.

14. Two restored instances remain isolated.

15. Trace distinguishes completion, execution supersession, settlement
    supersession, commit, reuse, recomputation, restoration, and settlement.

16. Disposal permanently removes commit authority from owned pending work.

17. LangGraph integration works without Settle owning graph topology or node
    execution.

18. Inngest integration works without Settle owning retry or durable step
    execution.

19. A Temporal prototype proves either Activity-local integration or
    deterministic workflow-safe validity state.

20. Core Settle imports no LangGraph, Inngest, Temporal, correction, agent,
    model-provider, DOM, or rendering dependency.

---

# Current Evidence

`reactive-correction-graph` already provides substantial evidence for:

* causal input versions
* selective invalidation
* stale-result containment
* supersession
* settled-result reuse
* current-result guards
* snapshot continuity
* restored-session isolation
* framework-neutral session boundaries
* LangGraph integration boundaries

Remaining generic extraction work includes:

* explicit generic execution identity
* explicit commit-authority semantics
* generic non-correction usage
* final settlement definition
* final trace taxonomy
* pending-snapshot recomputation
* generic inspection API
* deterministic host compatibility
* Inngest validation
* Temporal validation

---

# Extraction Plan

1. Create the `settle` repository.

2. Store this RFC and related semantic documentation there.

3. Define the minimum vocabulary:

```txt
causal state
revision
execution
execution identity
current
superseded
required obligation
candidate result
commit
reuse
recompute
settled
```

4. Build the plain-async reference example.

5. Build black-box tests for the four normative validity contracts before
   extracting implementation code.

6. Preserve the existing `reactive-correction-graph` regression baseline.

7. Identify generic mechanics currently represented by:

```txt
receiveEpoch
inputVersion
inputKey
current-result guards
superseded-result guards
snapshot validity data
```

8. Extract only mechanics that remain meaningful without correction or Agent
   terminology.

9. Implement the minimum Settle core.

10. Migrate `reactive-correction-graph` to consume the package.

11. Remove duplicated application-level validity mechanics.

12. Validate LangGraph.

13. Validate Inngest.

14. Validate Temporal as the strongest initial host-compatibility test.

15. Publish experimental `0.1.0` only after the core semantics remain coherent
    across those environments.

`createCorrectionRuntime.ts` must not be copied wholesale into Settle.

Extraction is based on invariants, not source-file ownership.

---

# Experimental `0.1.0` Release Gates

* plain-async changing-input tests pass
* revision-scoped settlement outcome tests pass
* a settlement operation does not follow a newer revision
* unsatisfied required obligations prevent settlement
* every candidate is associated with an execution and causal revision
* validation/commit race tests prove atomicity against revision changes
* Settle does not invoke application execution
* stale completed result rejection tests pass
* current-result commit tests pass
* supersession tests pass
* selective reuse tests pass
* settlement-with-obsolete-running-work tests pass
* snapshot restore tests pass
* omitted-pending-work obligation reconstruction tests pass
* restored-instance isolation tests pass
* pre-restore late-result rejection tests pass
* disposal commit-rejection tests pass
* deterministic clock and ID tests pass
* trace semantic tests pass
* browser smoke tests pass
* Node ESM smoke tests pass
* correction regression tests remain valid
* LangGraph reference integration passes
* Inngest interoperability prototype passes
* Temporal interoperability prototype establishes a safe integration boundary
* package import guards reject host/framework/domain dependencies
* examples consume public package exports only
* experimental limitations are documented

---

# Alternatives Rejected

## Keep `@signal-kernel/loop-runtime`

Rejected because `loop` emphasizes an execution mechanism.

It encourages expansion toward:

```txt
run
schedule
branch
retry
coordinate
persist
resume
```

which moves the abstraction toward a general workflow engine.

Settle instead describes the semantic result the package guarantees.

---

## Use `@signal-kernel/settle-runtime`

Rejected for now because `runtime` adds little information to the package
identity.

Repository:

```txt
settle
```

and package:

```txt
@signal-kernel/settle
```

are sufficient.

---

## Build a workflow engine

Rejected because orchestration is intentionally outside Settle's ownership.

Existing hosts already provide different and mature models for:

* scheduling
* routing
* retries
* persistence
* checkpointing
* workers
* workflow history

Settle should interoperate with those models rather than introduce another
incompatible orchestration model.

---

## Define a Settle workflow DSL

Rejected because applications should not need to rewrite their workflow into
Settle syntax.

Settle must be usable beneath existing orchestration systems.

---

## Make LangGraph the primary abstraction

Rejected because LangGraph is one host.

The existing integration is valuable evidence, but Settle semantics must remain
valid without LangGraph.

---

## Make Inngest a required dependency

Rejected because durable step semantics belong to Inngest.

Settle only validates whether results remain current.

---

## Make Temporal a required dependency

Rejected because Temporal durability and deterministic replay are host
semantics.

Temporal is an interoperability stress test, not Settle's execution model.

---

## Define settlement as all asynchronous work completing

Rejected.

Superseded work may remain physically active while no longer having commit
authority.

Such work does not necessarily prevent current state from being settled.

---

## Require cancellation for correctness

Rejected.

Cancellation is best-effort resource management.

Commit validation provides correctness.

---

## Own automatic retries

Rejected because execution hosts frequently already own retries.

Settle must not create hidden double-retry semantics.

---

## Serialize in-flight execution

Rejected because live asynchronous execution is not safely portable.

Snapshots serialize validity and reusable state.

Unsatisfied required obligations are reconstructed after restore. The host
performs any application work needed to satisfy them.

---

# Risks

* The name `settle` may be confused with Promise settlement.

* Documentation must consistently distinguish completion from settlement.

* Host interoperability may reveal that the initial generic API contains hidden
  correction assumptions.

* A generic execution-association interface may accidentally grow execution or
  scheduling semantics and become a workflow DSL.

* Commit authority may become overly exposed or complicated.

* Snapshot requirements may increase coupling between signal-kernel packages.

* Integration with host-managed retries may create unexpected duplicate side
  effects if boundaries are unclear.

* A host-facing candidate interface may accidentally expose a check-then-commit
  race instead of one atomic validity transition.

* Required obligations may accidentally become scheduler tasks if the
  application-execution ownership rule is not enforced.

* Replay-based hosts may expose hidden nondeterminism in Settle.

* Selective recomputation and host-level checkpoint reuse may overlap in ways
  that require explicit ownership rules.

* Too many published adapters could fragment the project before the core
  semantics stabilize.

These risks are why interoperability is treated as validation rather than
feature accumulation.

---

# Open Question Dispositions

| Question                             | Disposition             | Decision or exit criterion                                                                                                                       |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Minimum execution-association and candidate-submission interface | Deferred | Plain async plus at least two host integrations must validate the minimum host-facing interface without creating workflow DSL or execution semantics. |
| Public commit-authority API          | Deferred                | Prefer one Settle-controlled validation-and-commit transition; do not expose reusable authority that can outlive its causal revision.             |
| Causal revision representation       | Deferred                | Must support deterministic and serialized hosts without forcing one application input model.                                                     |
| Required-obligation declaration      | Deferred                | Must let Settle know what blocks settlement without representing obligations as work Settle executes.                                             |
| Settlement outcome                   | Accepted                | A fulfilled `settle(revision)` reports `settled` or `superseded`; it never silently follows a newer revision.                                     |
| Definition of settled                | Accepted                | The scoped revision remains authoritative, all accepted observable results are valid for it, and none of its required obligations remain unsatisfied. Superseded physical work does not block settlement. |
| Application execution ownership      | Accepted                | The host performs all application work. Settle drives only validity propagation, invalidation, internal reactive recomputation, commit evaluation, and settlement evaluation. |
| Candidate identity                   | Accepted                | Every candidate result is associated with an identified execution and causal revision.                                                           |
| Atomic validation and commit         | Accepted                | Candidate validation and observable commit are atomic with respect to causal revision changes.                                                    |
| Async-runtime alignment              | Accepted                | Develop and validate against the latest compatible async-runtime public contract; the correction POC's `0.3.0` dependency is not the baseline.   |
| `emit()` after supersession           | Deferred                | Decide whether callers must use `inspect()` for the last stable output or whether `emit()` exposes only output settled for the authoritative revision. |
| Operational error precedence         | Deferred                | Define rejection behavior for current failures and disposal while preserving `superseded` as the outcome once the scoped revision has been superseded. |
| Retry ownership                      | Accepted                | Host responsibility. Settle v1 performs no automatic retry.                                                                                      |
| Cancellation requirement             | Rejected                | Supersession and commit validation guarantee correctness independently of physical cancellation.                                                 |
| Process continuity                   | Rejected as requirement | Settle must support serialized continuity through compatible snapshots.                                                                          |
| Deterministic clock and IDs          | Accepted                | Injectable or deterministically derived where required.                                                                                          |
| Snapshot migration registry          | Rejected for `0.1.0`    | Matching settlement definition and schema required.                                                                                              |
| Trace taxonomy                       | Deferred                | Freeze after generic, LangGraph, Inngest, and Temporal validation.                                                                               |
| LangGraph adapter package            | Deferred                | Example first. Package only if meaningful repeated glue emerges.                                                                                 |
| Inngest adapter package              | Deferred                | Example first.                                                                                                                                   |
| Temporal adapter package             | Deferred                | Prototype first.                                                                                                                                 |
| `/testing` public subpath            | Deferred                | Requires demonstrated external demand.                                                                                                           |
| FIFO command semantics               | Rejected                | Hosts requiring FIFO queue above Settle.                                                                                                         |
| Workflow topology ownership          | Rejected                | Always host responsibility.                                                                                                                      |

---

# Outcome If Accepted

The signal-kernel ecosystem gains one higher-level semantic package:

```txt
@signal-kernel/settle
```

implemented in:

```txt
settle
```

Its responsibility is narrow:

> **Maintain execution-result validity as causal state changes.**

Its primary guarantee is:

> **Only results that remain valid for current causal state may become current
> observable state.**

Its defining distinction is:

```txt
completion != settlement
```

The package does not compete with workflow engines.

Instead:

```txt
LangGraph
Inngest
Temporal
custom runtimes
plain async applications
```

remain responsible for execution and orchestration.

Settle provides a common execution-validity layer beneath them.

The long-term architectural test is therefore not:

> Can Settle execute every kind of workflow?

It is:

> **Can systems with very different execution models use the same Settle
> semantics to determine whether asynchronous work still counts?**

If the answer remains yes across Plain Async, LangGraph, Inngest, and Temporal,
the abstraction is sufficiently independent from any single workflow engine to
justify `@signal-kernel/settle`.
