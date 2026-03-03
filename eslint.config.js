// @ts-check
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // -------------------------------------------------------------------------
  // Files to ignore globally
  // -------------------------------------------------------------------------
  { ignores: ["node_modules", "drizzle", "dist"] },

  // -------------------------------------------------------------------------
  // src/ — full type-aware linting
  // -------------------------------------------------------------------------
  {
    files: ["src/**/*.ts"],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce explicit return types on module-level functions so the public
      // API surface is always documented in types.
      "@typescript-eslint/explicit-module-boundary-types": "warn",

      // Avoid accidental floating promises (Effect pipelines are already
      // Effect-typed, so this mainly catches raw promise fire-and-forget).
      "@typescript-eslint/no-floating-promises": "error",

      // Unused variables are a common source of stale code.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Allow void operator to intentionally discard a promise.
      "no-void": ["error", { allowAsStatement: true }],
      // Effect.try / Effect.tryPromise catch any thrown value by design —
      // throwing a typed AppError (non-Error object) inside those callbacks
      // is an intentional pattern in this codebase.
      "@typescript-eslint/only-throw-error": "off",
    },
  },

  // -------------------------------------------------------------------------
  // tests/ — recommended rules without type-checking (avoids needing the
  // test files in tsconfig.json, keeps lint fast).
  // -------------------------------------------------------------------------
  {
    files: ["tests/**/*.ts"],
    extends: tseslint.configs.recommended,
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Test helpers/factories commonly use non-null assertions and `any`.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // -------------------------------------------------------------------------
  // Prettier must be last — disables all ESLint rules that could conflict
  // with Prettier's formatting decisions.
  // -------------------------------------------------------------------------
  prettier,
);
