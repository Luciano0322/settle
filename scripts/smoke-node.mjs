import assert from "node:assert/strict";
import { createSettler } from "@signal-kernel/settle";

const options = { definition: { id: "node-esm-smoke", version: "1" }, now: () => 0 };
const source = createSettler(options);
const first = source.receive("old");
const execution = source.associateExecution(first, { requiredForSettlement: true });
const waiting = source.settle(first);
const current = source.receive("new");
assert.equal((await waiting).status, "superseded");
assert.equal(execution.submit("late").status, "rejected");
source.associateExecution(current).submit("selected candidate");
assert.equal((await source.settle(current)).status, "settled");
assert.equal(source.emit(), "selected candidate");

const target = createSettler(options);
const restored = target.restore(JSON.parse(JSON.stringify(source.snapshot())));
assert.equal((await target.settle(restored.revision)).status, "settled");
assert.equal(target.emit(), "selected candidate");
assert.equal(target.inspect().obligations.required, 0);
source.dispose();
target.dispose();
console.log("Node ESM public-export lifecycle and snapshot smoke passed.");
