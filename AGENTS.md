# AGENTS.md

## Read this first (fast orientation)
1. `README.md` (user-facing behavior/CLI contract)
2. `DEVELOPER.md` (maintainer workflow + test map)
3. `ARCHITECTURE.md` (plugin lifecycle + ordering invariants)

## Big-picture architecture (what must stay true)
- Pipeline is `load -> validate -> synthesize -> bind -> finalize -> describeValidation` in `src/compiler/stack-builder.ts`.
- Input format detection is delegated to `DefinitionRegistry` (`src/definitions/registry.ts`) in strict order: `cloudformation`, `serverless`, `yamlcdk` catch-all.
- All formats must adapt into canonical `ServiceModel` (`src/compiler/model.ts`) plus domain slices in `DomainConfigs` (`src/compiler/plugins/domain-configs.ts`).
- Domain plugins are independent units coordinated through `ctx.refs` + `EventBinding[]`, not direct cross-domain imports.
- Native domain execution order is declared in `src/domains/manifest.ts` and enforced by `src/domains/index.ts`: `s3 -> dynamodb -> sqs -> sns -> functions -> eventbridge -> apis -> cloudfront`.

## Core integration boundaries
- CLI commands are thin wrappers in `src/commands/*.ts`; shared AWS flags come from `withAwsFlags(...)` in `src/cli.ts`.
- AWS overrides flow is always: `loadModel()` -> `resolveModelOverrides()` -> `assertModelResolution()` -> runtime call.
- Runtime execution boundary is `src/runtime/cdk.ts`: synthesizes to a temp outdir, shells to `aws-cdk` and sometimes `aws` CLI.
- `aws-cdk` binary resolution prefers consumer project `node_modules` before package-local copy (`resolveCdkBin()` in `src/runtime/cdk.ts`).
- Variable resolution (`${self|opt|sls|aws|env|file(...)}`) is shared across definition formats in `src/definitions/variables/resolve.ts`.

## Project-specific conventions (non-obvious)
- ESM is required (`"type": "module"`): keep `.js` import specifiers in TS source (`src/cli.ts` style).
- Schema-first changes: update Zod schema first (`src/config/schema.ts`, `src/compiler/model.ts`, domain config schemas), then adapters/consumers.
- `yamlcdk` plugin resolves REST apiKey precedence before emitting canonical `rest` events (`src/definitions/yamlcdk/plugin.ts`).
- Domain config is validated at write time via typed keys (`src/domains/<domain>/model.ts` + `DomainConfigs.set`).
- Deployment mode constraints are enforced centrally in `src/compiler/stack/validation.ts` (e.g., `useCliCredentials` vs `deployRoleArn`).

## Developer workflow (commands that matter)
- Install: `npm install`
- Test: `npm test` (`tsc -p tsconfig.test.json && vitest run`)
- Build: `npm run build` (`tsc -p tsconfig.json`)
- Fast CLI loop: `npm run dev -- validate -c examples/service.yml`
- Built CLI smoke: `node dist/cli.js --help`

## Where to add/change code safely
- YAML schema/defaults: `src/config/schema.ts`, `src/config/normalize.ts`
- Format adaptation: `src/definitions/{yamlcdk,serverless,cloudformation}/`
- Canonical model/lifecycle: `src/compiler/model.ts`, `src/compiler/stack-builder.ts`
- New domain: add key/schema in `src/domains/<name>/model.ts`, implement `src/domains/<name>/compiler.ts`, add definition adapters in `src/definitions/{yamlcdk,cloudformation,serverless}/domain-adapters.ts`, register in `src/domains/manifest.ts` with careful ordering.

## Tests and docs sync expectations
- Place tests close to changed area (`src/**/__tests__/*.test.ts`).
- Domain behavior changes also need `src/domains/__e2e__/` coverage.
- Format detection/adaptation changes also need `src/definitions/**/__e2e__/` coverage.
- If user-facing behavior changes, update `README.md`, relevant `examples/*.yml`, and starter templates in each definition plugin.
