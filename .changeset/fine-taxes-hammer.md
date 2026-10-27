---
"@signal-kernel/settle": minor
---

Resource inputs now use structural equality by default when both values are JSON values, so object selectors are reused when their content is unchanged. Live evaluation are restore now share the same rule. Non-JSON values are still compared by reference, passing equals to customize.
