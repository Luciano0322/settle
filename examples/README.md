# Host interoperability references

These are development examples, not public adapter packages. All Settle imports
use `@signal-kernel/settle`; host SDKs are dev dependencies and never core runtime
dependencies. Use Node 22+ and the repository lockfile for development.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
```

Run one reference with `pnpm exec vitest run tests/examples/<name>.test.ts`.

| Reference | Host-facing entry | Verified ownership |
| --- | --- | --- |
| Plain async | `plain-async/index.ts`: `runChangingInputExample` | Host starts both attempts; old settlement is superseded and its late candidate is rejected. |
| LangGraph | `langgraph/index.ts`: `createLangGraphExample` | Real graph nodes/edges, thread ID, and `MemorySaver` own invocation and checkpointing. Graph state contains serialized snapshots, not live settlers. |
| Inngest | `inngest/index.ts`: `createInngestExample` | Each SDK step reconstructs a fresh settler; host owns step output memoization and retry. |
| Temporal | `temporal/activities.ts`: `createTemporalActivityExample` | Settle stays Activity-local; Temporal context owns attempt identity and cancellation. |

## Plain async

Inject an `execute(input)` function that returns a domain-selected candidate.
The reference explicitly receives two inputs, starts both host executions, and
reports settlement/submission outcomes and trace provenance. It waits for old
physical work only to demonstrate its late rejection; that wait is not a Settle
settlement requirement. No candidate scores or quality decisions exist in Settle.

## LangGraph

Call `graph.invoke({ input }, { configurable: { thread_id } })` on the returned
compiled graph. The host's prepare/evaluate/finalize topology runs through the
real SDK. A checkpointed snapshot enables unchanged-input reuse on subsequent
invocations. Settle does not schedule nodes or select edges. `MemorySaver` is
test-local evidence of graph-state compatibility, not production persistence.

## Inngest

The function uses `initial` and `next` steps. A fresh instance is created inside
each step and only `{ output, snapshot }` crosses the durable seam. SDK retry
configuration belongs to Inngest, not Settle.

Tests run the real function with `InngestTestEngine`. The retry case supplies a
stored successful step result through the official engine's external platform
simulation, then explicitly requests another attempt. This proves local failure
propagation and compatibility with host memoization; it does not test an Inngest
server, actual retry timing, crash recovery, or production durability.

## Temporal

Register the factory's returned function as an `evaluate` Activity on a
host-owned Worker. `workflows.ts` shows `proxyActivities` with host-owned timeout
and retry configuration. Workflow code imports only the Activity type, not
Settle's runtime. Tests execute Activities in the SDK's `MockActivityEnvironment`,
including changed attempt metadata, JSON snapshot transfer, and cancellation
while application work ignores abort. The host revokes local authority on cancel.

This validates the RFC's Activity-local seam. No Temporal server/Worker/history
replay was run, and no Workflow-level deterministic replay guarantee is claimed.

## Correction-graph migration

The real reference is the adjacent `reactive-correction-graph` repository on
`feat/settle-migration`, not a replacement toy correction example. Its existing
causal-validity comparison/savings baseline remains unchanged. It uses
`link:../settle` while these Settle features are unreleased; its CI uses a pinned
paired checkout. See [validation notes](../docs/phase-10-validation.md) and the
migration section of that repository's README before making it standalone.

## Package portability and guardrails

`pnpm check` builds the npm exports, runs Node ESM lifecycle/snapshot assertions
and CJS loading, and enforces the core dependency/import policy. Browser smoke
bundles those built public exports with esbuild and executes them in headless
Chromium, including changing-input containment and JSON snapshot reuse.

Core source rejects host SDK imports; examples may use them. An AST-based guard
checks example imports for private Settle paths. Browser checks run in a separate
CI job; the ordinary Node matrix includes all local SDK integration tests.

Primary SDK references used for these prototypes:

- [LangGraph graph ownership](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [Inngest official testing engine](https://www.inngest.com/docs/reference/typescript/testing)
- [Temporal Activity testing context](https://docs.temporal.io/develop/typescript/best-practices/testing-suite)
