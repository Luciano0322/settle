# @signal-kernel/settle

## 0.1.0

### Minor Changes

- [#3](https://github.com/Luciano0322/settle/pull/3) [`0535e10`](https://github.com/Luciano0322/settle/commit/0535e102c1a1ea0555a57c20e1b260fb0809f64c) Thanks [@Luciano0322](https://github.com/Luciano0322)! - Introduce the first experimental Settle API for maintaining result validity as causal inputs change.
  
  - Add revision-scoped settlement outcomes that terminate as either `settled` or `superseded` without automatically following newer revisions.
  - Add required validity obligations that prevent settlement until they are satisfied.
  - Associate candidate results with identified executions and causal revisions.
  - Atomically validate causal eligibility, commit observable results, and satisfy execution-associated obligations.
  - Reject late candidate results from superseded executions.
  - Add host-driven reactive resources with selective invalidation, downstream validity propagation, and reuse of unaffected committed results.
  - Keep application execution under host control while using signal-kernel and async-runtime primitives for reactive validity and manual asynchronous execution.

This package has not been published yet. Release entries are managed by
Changesets.
