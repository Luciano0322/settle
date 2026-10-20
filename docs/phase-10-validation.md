# Phase 10 interoperability validation

Scope: reference/prototype interoperability through package public exports, not
production adapters or correction-quality evaluation. See
[the runnable examples](../examples/README.md) for entry points and limitations.

## Recorded local evidence

- Settle baseline before Phase 10: 94 passing tests.
- Settle after integration: `pnpm check` passes (107 tests, lint, typecheck,
  dependency policy, ESM/CJS/declaration build, publint, Node ESM lifecycle and
  snapshot smoke, CJS loading).
- `pnpm test:browser`: real Chromium smoke passes against built package exports.
- Correction-graph baseline: 217 passing tests, one optional manual Ollama test
  skipped. Migration: 219 passing tests, same manual test skipped; typecheck and
  build pass. Existing comparison/savings baseline JSON is unchanged.
- Correction-graph desktop/mobile browser regression: all 22 existing cases pass.

Each new reference began with a failing public-seam test before implementation.
Additional retry, serialization, and portability cases exercise the real SDKs
without mocking Settle or internal signal-kernel modules. Inngest's platform step
cache and Temporal's Activity context use their official SDK test environments;
they are not claims about hosted durability or Workflow replay.

## Cross-repository migration

The actual correction runtime now uses Settle resources rather than its own
async-resource causal-key/commit machinery. Domain extraction, coverage
normalization, plan construction, application execution, timeout, and following a
newer input remain host code. The compatibility `runUntilSettled()` facade chooses
to follow superseded revisions; Settle's `settle(revision)` does not.

The sibling repository is on `feat/settle-migration`. Its dependency is deliberately
`link:../settle` for unreleased local validation; CI checks out Settle revision
`db74dda02893c1c643e312b9855f8ff62e8cef89`, builds it, and then installs/tests the
correction repository. This phase does not merge either branch or publish npm.
Replace the link with an appropriate published version and remove paired checkout
before treating correction-graph as independently installable.

## Phase-end review

- Tests cross public package or example host-facing seams; no internal reactive
  modules are mocked. Example imports are checked for private Settle access.
- No new Settle public method or host dependency was added to core.
- LangGraph topology, Inngest retries/steps, Temporal Activity scheduling, and
  correction-domain acceptance remain outside Settle.
- Correction migration removes obsolete private lifecycle methods, manual causal
  keys, and settlement polling. `settlePollMs` remains accepted but deprecated.
- No candidate confidence, score, or quality policy is interpreted by Settle.
- Generic host glue remains small; no adapter packages or framework registry were
  introduced. Snapshot/trace persistence remains host-owned.

## Explicit limits

No production checkpointer, Inngest server retry/crash exercise, Temporal Worker
execution/history replay, browser engine matrix, performance benchmark, or
correction-quality evaluation is included. Chromium portability is not evidence
of those properties. These validation results apply to the locked SDK versions
and tested local environment; remote CI will run when the user pushes changes.
