# Settle

Settle is the domain of deciding whether asynchronous execution results remain
valid as their causal inputs change.

## Language

**Causal revision**:
An immutable identity for the causal state against which executions, candidates, and settlement are evaluated.
_Avoid_: Moving target, latest state

**Execution**:
A host-owned attempt to perform application work for one causal revision.
_Avoid_: Workflow node, Settle task

**Candidate result**:
A result proposed by an identified execution for a specific causal revision, before commit validity has been established.
_Avoid_: Output, committed result

**Commit authority**:
The revocable authority of an identified execution to make its candidate result part of observable state.
_Avoid_: Cancellation token, completion status

**Commit**:
The atomic acceptance of a valid candidate result into observable state.
_Avoid_: Completion, resolution

**Required obligation**:
A validity condition that must be satisfied before a causal revision can settle; it does not represent work that Settle executes.
_Avoid_: Task, job, workflow node

**Settlement operation**:
An evaluation scoped to one causal revision that fulfills as either settled or superseded.
_Avoid_: Latest-state loop, Promise settlement

**Settled**:
The outcome for a causal revision whose accepted observable results are valid and whose required obligations are all satisfied.
_Avoid_: Completed, idle

**Superseded**:
The outcome or state produced when newer causal state permanently removes an older revision or execution's authority to become current.
_Avoid_: Cancelled, failed

**Observable state**:
The accepted state that consumers are allowed to treat as representing a causal revision.
_Avoid_: Candidate result, partial work
