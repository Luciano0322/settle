import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import type { runBrowserSmoke } from "./fixture.js";

test("runs built package exports and snapshot restore in a real browser", async ({ page }) => {
  const bundle = await build({
    entryPoints: ["tests/browser/fixture.ts"],
    bundle: true, platform: "browser", format: "iife", globalName: "SettleSmoke", write: false,
  });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const result = await page.evaluate(() => {
    const host = window as unknown as { SettleSmoke: { runBrowserSmoke: typeof runBrowserSmoke } };
    return host.SettleSmoke.runBrowserSmoke();
  });
  expect(result).toEqual({
    output: "selected:new", previous: "rejected", current: "settled",
    restored: "browser value", settlement: "settled", hostRuns: 0,
  });
});
