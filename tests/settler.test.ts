import { describe, expect, it } from "vitest";

import { createSettler } from "@signal-kernel/settle";

describe("causal revisions", () => {
  it("creates a distinct causal revision for each received input", () => {
    const settler = createSettler<string>();

    const firstRevision = settler.receive("first input");
    const secondRevision = settler.receive("second input");

    expect(secondRevision).not.toBe(firstRevision);
  });
});

describe("revision-scoped settlement", () => {
  it("settles the caller-selected revision when no obligations are required", async () => {
    const settler = createSettler<string>();
    const revision = settler.receive("input");

    await expect(settler.settle(revision)).resolves.toEqual({
      status: "settled",
      revision,
    });
  });
});
