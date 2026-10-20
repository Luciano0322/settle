import { ESLint } from "eslint";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it.each(["@langchain/langgraph", "inngest", "@inngest/test", "@temporalio/activity", "@playwright/test", "reactive-correction-graph"])(
  "rejects %s at the core import guard while allowing it in examples", async (specifier) => {
    const eslint = new ESLint();
    const source = `export * from ${JSON.stringify(specifier)};`;
    const core = await eslint.lintText(source, { filePath: "src/host-guard-fixture.ts" });
    const example = await eslint.lintText(source, { filePath: "examples/host-guard-fixture.ts" });
    expect(core[0]?.messages.some((message) => message.ruleId === "no-restricted-imports")).toBe(true);
    expect(example[0]?.errorCount).toBe(0);
  },
);

it("keeps every example on package public exports rather than Settle source or private subpaths", async () => {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? files(path) : Promise.resolve(entry.name.endsWith(".ts") ? [path] : []);
    }))).flat();
  }
  const violations: string[] = [];
  for (const path of await files("examples")) {
    const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith("@signal-kernel/settle/") || /(?:^|\/)src\//.test(specifier)) violations.push(`${path}: ${specifier}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
