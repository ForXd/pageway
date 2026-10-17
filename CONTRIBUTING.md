# Contributing to Pageway

Use Node.js 24 LTS or Node.js 26 and the pnpm version pinned in `package.json`. CI validates both Node versions. Install with `corepack enable` and `pnpm install --frozen-lockfile`.

## Develop and validate

```sh
pnpm dev
pnpm test:watch
pnpm format
pnpm check
pnpm exec playwright install --with-deps --no-shell chromium firefox webkit
pnpm test:e2e
pnpm check:pack
```

`pnpm check:all` runs the complete local gate after browser installation. See [testing](docs/testing.md) for boundaries, coverage, and reports, and [browser integration](docs/testing-e2e.md) for focused runs. No model account or secret is required for unit tests or E2E. Use `pnpm check:model` separately to test a real provider with synthetic inputs.

Add a failing test at a public boundary when fixing a bug, then make the smallest change that passes it. Mock external HTTP services, not Pageway internals. Preserve task cancellation, fresh React context between tools, schema checks before execution, and result IDs across the round trip. Use browser tests for focus, native modal behavior, positioning, and motion.

TypeScript performs strict type checks; Biome provides static linting without depending on TypeScript ESLint's compiler-version support. Prettier owns formatting. Two CSS lint rules are disabled because responsive cascade overrides and reduced-motion `!important` rules are intentional. Tests may use non-null assertions after establishing their fixtures; production code should validate nullable inputs. Keep narrow suppressions documented beside the relevant line.

## Pull requests

Describe the user-visible behavior, the relevant public contract, and the checks you ran. Keep changes focused. Do not commit `.env`, API keys, generated `dist`, coverage, browser traces, or npm tarballs. The `.gitignore` excludes these files, but review your staged diff before pushing.

Use the existing three-package structure unless a separate public responsibility justifies another package. Internal dependencies use `workspace:*`; all public package versions move together. Update integration examples and protocol documentation when changing the public API.

## Releases

Maintainers use the [release procedure](docs/releasing.md). Version tags run all gates before publishing the exact tested tarballs. npm publishing uses GitHub OIDC and package-specific trusted publishers; long-lived npm tokens are not stored in the repository.

By submitting a contribution, you agree that it will be licensed under the project's MIT license.
