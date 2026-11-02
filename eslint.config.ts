import antfu from "@antfu/eslint-config";

export default antfu({
  typescript: true,
  react: true,
  stylistic: {
    indent: 2,
    quotes: "double",
    semi: true,
  },
  rules: {
    "no-console": "warn",
    "ts/no-explicit-any": "error",
    "ts/consistent-type-imports": [
      "error",
      { prefer: "type-imports" },
    ],
    "perfectionist/sort-imports": [
      "error",
      {
        environment: "bun",
        groups: [
          "type-import",
          [
            "type-parent",
            "type-sibling",
            "type-index",
            "type-internal",
          ],
          "value-builtin",
          "value-external",
          "value-internal",
          ["value-parent", "value-sibling", "value-index"],
          "side-effect",
          "ts-equals-import",
          "unknown",
        ],
        newlinesBetween: "ignore",
        newlinesInside: "ignore",
        order: "asc",
        type: "natural",
      },
    ],
  },
  ignores: [
    "**/*.json",
    "**/*.md",
    "**/*.toml",
    "**/*.yml",
    "**/*.yaml",
    "public/r/**",
    "apps/demo-web/src/components/ui/**",
    "apps/demo-web/src/components/theme-provider.tsx",
    "apps/demo-web/src/routeTree.gen.ts",
  ],
}, {
  // Code shipped to hosts must run on Bun and Cloudflare Workers alike.
  files: ["registry/fm/**/*.{ts,tsx}"],
  ignores: ["registry/fm/drivers/local.ts", "registry/fm/server/contract.ts", "**/*.test.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["node:*", "bun:*", "bun"],
            message: "Registry code must use Web-standard APIs only.",
          },
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      "Bun",
      "process",
      "Buffer",
      "require",
      "__dirname",
      "__filename",
    ],
  },
}, {
  files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
  rules: {
    "no-console": "off",
  },
});
