# DEVELOPER.md

Contributor notes for the `yamlcdk` repository. User-facing usage belongs in `README.md`; this file is for people changing the CLI itself.

## Local setup

- **Node:** `>=20` (`package.json` -> `engines.node`)
- **Package manager:** npm
- **Module system:** ESM (`"type": "module"`). Keep using ESM syntax and the existing `.js` import specifiers in TypeScript source.

Install dependencies:

```bash
npm install
```

Core checks:

```bash
npm test
npm run build
```

Notes:

- `npm test` runs `tsc -p tsconfig.test.json && vitest run`
- `npm run build` runs `tsc -p tsconfig.json`
- `npm run lint` is only a placeholder right now (`No lint configured`)

Run the CLI locally without building:

```bash
npm run dev -- --help
npm run dev -- validate -c examples/service.yml
npm run dev -- synth -c examples/service.yml --region us-east-1
```

Equivalent direct entrypoint:

```bash
npx tsx src/cli.ts validate -c examples/service.yml
```

Run the built CLI:

```bash
npm run build
node dist/cli.js --help
```

If you want to exercise deploy/diff/remove flows against AWS, make sure you also have AWS credentials configured. Some runtime paths also call the `aws` CLI directly.

## Repository layout

- `README.md` - end-user install/usage docs
- `examples/` - example configs; `examples/service.yml` is the canonical yamlcdk sample, `examples/cloudformation.yml` is the canonical CloudFormation sample
- `src/cli.ts` - Commander-based CLI entrypoint
- `src/commands/` - thin command handlers (`init`, `validate`, `synth`, `bootstrap`, `diff`, `deploy`, `remove`)
- `src/config/`
  - `schema.ts` - raw config Zod schemas and validation
  - `normalize.ts` - defaulting and normalization (`stage`, `region`, `stackName`, empty sections)
  - `load.ts` - YAML file loading
  - `loader.ts` - definition-plugin dispatch via `DefinitionRegistry` to `ServiceModel`
- `src/definitions/`
  - `registry.ts` - shared `DefinitionRegistry` setup (registers all built-in plugins)
  - `yamlcdk/` - native `yamlcdk.yml` definition plugin and starter template
  - `cloudformation/` - CloudFormation YAML definition plugin
    - `cfn-yaml.ts` - custom js-yaml schema for intrinsic functions (`!Ref`, `!GetAtt`, `!Sub`, `!Join`, etc.)
    - `adapt.ts` - CloudFormation template → `ServiceModel` adaptation
    - `plugin.ts` - `cloudformationDefinitionPlugin` implementation
- `src/compiler/`
  - `model.ts` - canonical `ServiceModel` and event/build/provider schemas
  - `stack-builder.ts` - compiler lifecycle orchestration
  - `plugins/` - domain/definition plugin contracts, registries, and typed domain config keys
  - `domains/` - native domain plugins (`s3`, `dynamodb`, `sqs`, `sns`, `functions`, `eventbridge`, `apis`)
  - `stack/` - shared compiler helpers and validation
- `src/runtime/`
  - `build.ts` - per-function build/package preparation
  - `aws.ts` - CLI override resolution and AWS context checks
  - `cdk.ts` - synth/diff/bootstrap/deploy/destroy runtime wrappers
- `src/**/__tests__/` - source-adjacent Vitest suites (`*.test.ts`)
- `src/compiler/domains/__e2e__/` - one CDK-asserted end-to-end suite per compiler domain
- `src/definitions/**/__e2e__/` - format-level end-to-end suites that load real yamlcdk and CloudFormation input through the definition registry before building the stack
  - organize these by definition section (`provider`, `functions`, `storage`, `messaging`, `events`, `iam`, `invalid`) and cover valid permutations plus invalid definitions
- `dist/` - compiled output from `npm run build`; do not edit by hand

## Typical development workflow

1. Start from the user-facing behavior you want to change:
   - config/YAML change -> start in `src/config/` and `src/definitions/yamlcdk/`
   - CloudFormation format change -> start in `src/definitions/cloudformation/`
   - compiler/domain change -> start in `src/compiler/`
   - CLI flag/command change -> start in `src/cli.ts` and `src/commands/`
2. Make the schema/model change first.
3. Update adaptation/normalization.
4. Update the compiler/runtime behavior.
5. Add or adjust tests in the nearest `src/**/__tests__/*.test.ts` suite, update `src/definitions/**/__e2e__/` when input-format loading behavior changes, and update `src/compiler/domains/__e2e__/` when domain stack behavior changes.
6. Run:

   ```bash
   npm test
   npm run build
   ```

7. Smoke-test the relevant command with `npm run dev -- ...`.
8. If the change affects end users, update `README.md`, `examples/service.yml`, and the `init` starter template if needed.

## Schema-first development with Zod

This repo is intentionally **schema-first**.

Zod schemas are the source of truth in:

- `src/config/schema.ts` for raw YAML input
- `src/compiler/model.ts` for the canonical compiler model
- `src/compiler/plugins/native-domain-configs.ts` for domain-specific config slices

Expectations:

- Add or change the Zod schema **before** adding ad hoc TypeScript-only interfaces.
- Prefer `z.infer<>`-derived types over manually duplicated types.
- Keep runtime validation and compile-time types aligned.
- Preserve clear error messages. `validateServiceConfig()` already formats issue paths; new validation should stay similarly actionable.

For a config/model change, the usual path is:

1. Update the relevant Zod schema.
2. Update `src/config/normalize.ts` if defaults or derived values change.
3. Update `src/definitions/yamlcdk/plugin.ts` so normalized config is adapted into the canonical `ServiceModel`.
4. Update any consuming domain/runtime code.
5. Update tests.

Important: a schema change is not complete until all consumers are updated too. For example, if you expand accepted function runtimes or event shapes, also update the code that interprets them in the compiler/runtime.

## Adding or updating a domain plugin

The active compiler pipeline is domain-plugin based.

Key files:

- contract: `src/compiler/plugins/domain-plugin.ts`
- typed config keys: `src/compiler/plugins/domain-configs.ts`
- native domain config schemas/keys: `src/compiler/plugins/native-domain-configs.ts`
- native domain registration: `src/compiler/domains/index.ts`
- compiler lifecycle orchestration: `src/compiler/stack-builder.ts`

### Domain plugin lifecycle

`ServiceStack` runs domains in four phases:

1. `validate`
2. `synthesize`
3. `bind`
4. `finalize`

Use them as intended:

- `validate` - reject invalid domain-specific combinations early
- `synthesize` - create CDK constructs and register shared refs in `ctx.refs`
- `bind` - wire event sources to targets using aggregated `EventBinding[]`
- `finalize` - outputs or post-bind cleanup

### Safe process for a new or changed domain

1. **Define the domain config contract**
   - Add a Zod schema and typed config key in `src/compiler/plugins/native-domain-configs.ts`
   - Create the key with `createDomainConfigKey(...)` so `DomainConfigs.set()` validates writes at runtime

2. **Expose the domain through YAML if needed**
   - Extend `src/config/schema.ts`
   - Update `src/config/normalize.ts` if the new section needs defaults

3. **Adapt normalized config into the domain config store**
   - Update `adaptDomainConfigs()` in `src/definitions/yamlcdk/plugin.ts`

4. **Implement the plugin**
   - Add or update `src/compiler/domains/<name>.ts`
   - Read your slice through `ctx.model.domainConfigs`
   - Share constructs through `ctx.refs`

5. **Register it in order**
   - Update `src/compiler/domains/index.ts`
   - Ordering matters:
     - resource-creation domains before `functions`
     - binding domains after `functions`

6. **Test it**
   - `src/compiler/plugins/__tests__/` for registration/order/schema-level behavior
   - `src/compiler/domains/__e2e__/` for domain-specific CDK stack behavior
   - `src/compiler/__tests__/stack-builder.test.ts` for cross-domain and deployment behavior

### Architectural expectations

- Keep domains decoupled.
- Prefer `ctx.model.domainConfigs` and `ctx.refs` over importing one domain into another.
- If a domain produces events for another domain to bind, return them from `synthesize()` as `events`.
- If a rule is global rather than domain-local, consider whether it belongs in shared validation instead of a single plugin.

## Adding or updating a definition plugin

Definition plugins translate a file format into the canonical `ServiceModel`.

Key files:

- contract: `src/compiler/plugins/definition-plugin.ts`
- registry types: `src/compiler/plugins/registry.ts`
- shared registry setup: `src/definitions/registry.ts`
- yamlcdk implementation: `src/definitions/yamlcdk/plugin.ts`
- CloudFormation implementation: `src/definitions/cloudformation/plugin.ts`
- loader dispatch: `src/config/loader.ts`

### Current state of the repo

The **plugin contract, registries, and loader dispatch are all wired**. `loadModel()` resolves the correct definition plugin through the shared `DefinitionRegistry` in `src/definitions/registry.ts`. `runInit()` selects a plugin's `generateStarter()` based on the `--format` flag.

Two built-in plugins exist:

- **`yamlcdkDefinitionPlugin`** — catch-all for `.yml`/`.yaml` files in the native yamlcdk format.
- **`cloudformationDefinitionPlugin`** — matches CloudFormation templates by detecting `AWSTemplateFormatVersion` or `Resources` with `Type: AWS::*` in the first 4KB of the file.

The cloudformation plugin is registered first (more specific detection), so it takes precedence when both could match.

### Safe process

1. Create `src/definitions/<format>/plugin.ts`
2. Implement `DefinitionPlugin`:
   - `formatName`
   - `canLoad(filePath)` for a cheap format match
   - `load(filePath)` to parse -> validate -> normalize/adapt -> return `ServiceModel`
   - `generateStarter()` if the format should support `init`
3. Export it from `src/definitions/<format>/index.ts`
4. Register it in `src/definitions/registry.ts` — pay attention to registration order (more specific plugins first)
5. Add definition-level tests in `src/definitions/<format>/__tests__/`
6. If the format should support `init`, the `--format` flag in `src/commands/init.ts` already dispatches through the registry

### Definition-plugin expectations

- Produce the canonical compiler model, not format-specific one-off structures.
- Reuse Zod-backed config/domain contracts instead of bypassing them.
- Resolve format-specific defaults before the model reaches domain plugins.
- Keep `canLoad()` cheap and deterministic.

## Updating CLI commands safely

The CLI surface is intentionally thin.

Key files:

- `src/cli.ts` - Commander wiring and shared flags
- `src/commands/*.ts` - one thin module per command
- `src/runtime/aws.ts` - override resolution and AWS context checks
- `src/runtime/cdk.ts` - runtime implementations

### Existing pattern

AWS-aware commands currently follow this flow:

1. `loadModel(options.config)`
2. `resolveModelOverrides(model, options)`
3. `assertModelResolution(model)`
4. delegate to a runtime function (`cdkSynth`, `cdkDeploy`, `cdkDiff`, `cdkDestroy`, `cdkBootstrap`)

`validate` is thinner: it loads the model, asserts resolution, and prints success.

### Guidelines

- Keep `src/commands/*.ts` as wrappers, not places for core business logic.
- Reuse `withAwsFlags(...)` in `src/cli.ts` for AWS-aware commands so `config`, `region`, `profile`, and `account` stay consistent.
- Let command handlers throw; the top-level `program.parseAsync(...).catch(...)` is the shared CLI error formatter.
- Preserve existing flags and defaults where possible.
- If you add a new flag or command, smoke-test it both through:
  - `npm run dev -- ...`
  - `node dist/cli.js ...` after `npm run build`

If a CLI change also changes documented behavior, update `README.md` and examples in the same change.

## Testing strategy

The repo currently relies on Vitest plus TypeScript compilation of the test project.

Run:

```bash
npm test
```

What the current suites cover:

- `src/config/__tests__/config.test.ts`
  - raw config validation
  - normalization defaults
  - AWS override resolution
  - deployment/build config shape
- `src/compiler/plugins/__tests__/registry.test.ts`
  - domain/definition registries
  - native domain registration order
- `src/compiler/plugins/__tests__/domain-configs.test.ts`
  - typed domain config storage
  - Zod-backed domain config validation
- `src/compiler/__tests__/model.test.ts`
  - canonical model schema validation
- `src/compiler/__tests__/stack-builder.test.ts`
  - synthesized cross-domain stack behavior
  - deployment and synthesizer behavior
- `src/compiler/domains/__e2e__/functions.test.ts`
  - function synthesis and IAM wiring
- `src/compiler/domains/__e2e__/s3.test.ts`
  - bucket lifecycle settings and S3 event wiring
- `src/compiler/domains/__e2e__/dynamodb.test.ts`
  - table options and DynamoDB stream wiring
- `src/compiler/domains/__e2e__/sqs.test.ts`
  - queue options and SQS event wiring
- `src/compiler/domains/__e2e__/sns.test.ts`
  - topic subscriptions and SNS event wiring
- `src/compiler/domains/__e2e__/eventbridge.test.ts`
  - EventBridge schedule and pattern rules
- `src/compiler/domains/__e2e__/apis.test.ts`
  - HTTP/REST API synthesis and API options
- `src/definitions/yamlcdk/__tests__/plugin.test.ts`
  - yamlcdk definition plugin behavior
  - normalized config to `ServiceModel` adaptation
- `src/definitions/yamlcdk/__e2e__/yamlcdk.test.ts`
  - yamlcdk input format resolution, loading, and stack creation through the definition registry
- `src/definitions/cloudformation/__tests__/cloudformation.test.ts`
  - CloudFormation YAML parsing with intrinsic functions
  - intrinsic function type guards
  - `canLoad()` detection (CloudFormation vs yamlcdk format)
  - definition registry resolution
  - resource extraction (Lambda, S3, DynamoDB, SQS, SNS)
  - event wiring (EventSourceMapping, SNS subscription, S3 notification, EventBridge, API Gateway V2)
- `src/definitions/cloudformation/__e2e__/cloudformation.test.ts`
  - CloudFormation input format resolution, loading, and stack creation through the definition registry

Update tests when you change:

- YAML schema or defaults
- canonical model/event shapes
- domain config keys or plugin order
- build/deploy/runtime behavior
- CLI-visible validation semantics

After a meaningful code change, run:

```bash
npm test
npm run build
```

For command changes, also do a smoke run against `examples/service.yml` or another focused fixture.

## When to update docs and examples

Update user-facing docs/examples when you change:

- YAML shape or defaults
- command names, flags, or examples
- deployment/bootstrap behavior
- the starter config generated by `init`
- package consumption instructions

Concretely, keep these in sync when relevant:

- `README.md`
- `examples/service.yml` (yamlcdk format)
- `examples/cloudformation.yml` (CloudFormation format)
- `src/definitions/yamlcdk/plugin.ts` yamlcdk starter template
- `src/definitions/cloudformation/plugin.ts` CloudFormation starter template
- `DEVELOPER.md` for contributor workflow/internal architecture changes

## Package/bin entry points and local consumption

Useful packaging facts from `package.json`:

- `main` -> `dist/cli.js`
- `bin.yamlcdk` -> `dist/cli.js`
- published `files` currently include `dist/` and `README.md`

Implications:

- Installed consumers run compiled output, not `src/`
- `dist/` must be refreshed with `npm run build` before testing linked/path-installed usage
- `DEVELOPER.md` is repo-only documentation unless packaging rules change

Local consumption already supported by the repo:

### 1. Fast contributor loop

```bash
npm run dev -- validate -c examples/service.yml
```

### 2. Use the built file directly

```bash
npm run build
node dist/cli.js --help
```

### 3. Link globally for local development

```bash
npm run build
npm link
yamlcdk --help
```

### 4. Install from a local path in another project

```bash
npm i -D /absolute/path/to/yamlcdk
npx yamlcdk --help
```

One more practical note: `src/runtime/cdk.ts` resolves `aws-cdk` from the consuming project's `node_modules` first, then falls back to the CLI package copy. If you use yamlcdk as a local `file:` dependency, install `aws-cdk` in the consuming project too.
