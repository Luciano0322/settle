---
"@signal-kernel/settle": minor
---

Add `resource.valueFor(revision)`, which reports whether a resource result belongs to a specific revision: `valid` with the value, `required`, `superseded` with `supersededBy`, or `disposed`. A superseded revision is never reported as `valid`, even when the result is unchanged; reading again with the newer revision returns the reused result without running the resource. Use it to check a result and act on it in the same synchronous step. `emit()` is unchanged.
