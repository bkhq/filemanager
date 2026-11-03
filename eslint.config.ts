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
    "apps/fm-web/src/components/ui/**",
    "apps/fm-web/src/components/theme-provider.tsx",
    "apps/fm-web/src/routeTree.gen.ts",
    "apps/fm-worker/wrangler.jsonc",
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
  // Copied files share the host namespace: exported types carry the Fm prefix.
  files: ["registry/fm/**/*.{ts,tsx}"],
  rules: {
    "ts/naming-convention": [
      "error",
      {
        selector: "typeLike",
        modifiers: ["exported"],
        format: ["PascalCase"],
        filter: { regex: "Props$", match: false },
        prefix: ["Fm"],
      },
    ],
  },
}, {
  files: ["registry/fm/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  ignores: ["registry/fm/{react,plugins}/**/*.test.ts", "apps/fm-web/src/components/ui/**", "apps/fm-web/src/routeTree.gen.ts"],
  languageOptions: {
    parserOptions: {
      project: [
        "tsconfig.json",
        "apps/fm-api/tsconfig.json",
        "apps/fm-web/tsconfig.app.json",
        "apps/fm-worker/tsconfig.json",
      ],
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "ts/no-deprecated": "error",
  },
}, {
  files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
  rules: {
    "no-console": "off",
  },
});
