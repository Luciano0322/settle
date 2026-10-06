import { readFile } from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

const dependencySections = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

const forbiddenDependencies = [
  /^@anthropic-ai\//,
  /^@langchain\//,
  /^@temporalio\//,
  /^inngest$/,
  /^openai$/,
  /^react(?:\/|$)/,
  /^reactive-correction-graph$/,
  /^vue(?:\/|$)/,
];

const violations = dependencySections.flatMap((section) =>
  Object.keys(packageJson[section] ?? {})
    .filter((dependency) =>
      forbiddenDependencies.some((pattern) => pattern.test(dependency)),
    )
    .map((dependency) => `${section}: ${dependency}`),
);

if (violations.length > 0) {
  throw new Error(
    `Settle core contains forbidden dependencies:\n${violations.join("\n")}`,
  );
}
