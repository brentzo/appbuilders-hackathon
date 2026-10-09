import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Pi's code as forked (src/agent/FORK.md): kept close to upstream so fixes can be diffed in.
    files: ["src/agent/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-useless-assignment": "off",
    },
  },
);
