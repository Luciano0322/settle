import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@langchain/*",
                "@temporalio/*",
                "@anthropic-ai/*",
                "inngest",
                "openai",
                "react",
                "react/*",
                "reactive-correction-graph",
                "vue",
                "vue/*",
              ],
              message:
                "Settle core must remain independent from hosts, frameworks, and application domains.",
            },
          ],
        },
      ],
    },
  },
);
