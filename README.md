# yamlcdk

`yamlcdk` ("AWS YAML for CDK") is a CLI for defining AWS infrastructure in YAML, turning it into AWS CDK/CloudFormation stacks, and running the usual deployment workflow from the command line: initialize config, validate it, synthesize a template, diff changes, deploy, and remove stacks.

yamlcdk supports three input formats:

- **yamlcdk format** — a concise, purpose-built YAML schema (see `examples/service.yml`)
- **Serverless Framework YAML** — `serverless.yml` for AWS, mapped onto yamlcdk's current compiler model (see `examples/serverless.yml`)
- **CloudFormation YAML** — native CloudFormation templates with `AWSTemplateFormatVersion` (see `examples/cloudformation.yml`)

The correct format is detected automatically based on file content. This README is focused on CLI users. If you are developing yamlcdk itself, use [DEVELOPER.md](./DEVELOPER.md) (workflow/tests) and [ARCHITECTURE.md](./ARCHITECTURE.md) (internal design).

## Requirements

- Node.js 20+
- AWS credentials or profile access for the account you plan to target
- A config file: yamlcdk YAML (`yamlcdk.yml`), Serverless Framework YAML (`serverless.yml`), or a CloudFormation YAML template

## Install and run

### Installed CLI (recommended)

```bash
npx yamlcdk --help
```

You can also install it in a project:

```bash
npm i -D yamlcdk
npx yamlcdk --help
```

### From a checkout of this repository (maintainer/development flow)

```bash
npm install
npm run build
node dist/cli.js --help
```

During local development you can run the CLI without building first:

```bash
npm run dev -- --help
```

All examples below use `yamlcdk`. If you are running from a checkout, replace `yamlcdk` with `node dist/cli.js` after `npm run build`, or with `npm run dev --` while developing locally.

## Quick start

Create a starter config, validate it, synthesize the template, then deploy it:

```bash
yamlcdk init -c yamlcdk.yml
yamlcdk validate -c yamlcdk.yml
yamlcdk synth -c yamlcdk.yml --region us-east-1 > stack.template.json
yamlcdk deploy -c yamlcdk.yml --region us-east-1
```

To start with a CloudFormation template instead:

```bash
yamlcdk init -c template.yml --format cloudformation
yamlcdk validate -c template.yml
yamlcdk synth -c template.yml --region us-east-1 > stack.template.json
```

To start with a Serverless Framework config instead:

```bash
yamlcdk init -c serverless.yml --format serverless
yamlcdk validate -c serverless.yml
yamlcdk synth -c serverless.yml --region us-east-1 > stack.template.json
```

If your stack needs a bootstrapped CDK environment, run `npx cdk bootstrap` manually (details below).

You can also start from `examples/service.yml` (yamlcdk format), `examples/serverless.yml` (Serverless format), or `examples/cloudformation.yml` (CloudFormation format) for broader samples.

## Commands

| Command | What it does | Options |
| --- | --- | --- |
| `init` | Create a starter config file. | `-c, --config <path>` (default: `yamlcdk.yml`), `-f, --format <format>` (`yamlcdk`, `serverless`, or `cloudformation`, default: `yamlcdk`) |
| `validate` | Load and validate a config file. | `-c, --config <path>` (default: `yamlcdk.yml`) |
| `synth` | Synthesize a CloudFormation template and print it to stdout. | shared AWS flags |
| `diff` | Show the CDK diff for the stack. | shared AWS flags |
| `deploy` | Deploy the stack. | shared AWS flags + `--require-approval` |
| `remove` | Destroy the stack. | shared AWS flags + `--force` |

## Shared flags

The following flags are available on `synth`, `diff`, `deploy`, and `remove`:

- `-c, --config <path>` - config file path. Required on these commands.
- `--region <region>` - AWS region override.
- `--profile <profile>` - AWS profile override.
- `--account <account>` - AWS account override.

Command-specific flags:

- `deploy --require-approval` - keep approval for security-related changes. When omitted, yamlcdk deploys with approval disabled. This flag is not supported when `provider.deployment.cloudFormationServiceRoleArn` is set.
- `remove --force` - skip the destroy confirmation prompt. Use this in CI or any non-interactive shell.

## CDK bootstrap (manual when required)

yamlcdk does not run `cdk bootstrap` for you. Bootstrap is still required for environments that depend on CDKToolkit bootstrap resources (for example many `DefaultStackSynthesizer`-based deployments).

Run bootstrap directly with CDK (typically once per account/region):

```bash
npx cdk bootstrap aws://123456789012/us-east-1
npx cdk bootstrap aws://123456789012/us-east-1 --profile my-profile
```

To skip the synthesized bootstrap version rule when you are intentionally managing deployment infrastructure:

- yamlcdk format: `provider.deployment.requireBootstrap: false`
- Serverless format: `provider.deployment.requireBootstrap: false` (or mapped explicit infrastructure via `provider.deploymentBucket.name` / `provider.iam.deploymentRole`)
- CloudFormation format: `Metadata.yamlcdk.deployment.requireBootstrap: false`

`requireBootstrap: false` controls the synthesized bootstrap rule only; it does not guarantee that every deployment mode is bootstrapless.

## Config file shape

yamlcdk supports three input formats. The format is auto-detected based on file content.

### yamlcdk format

`yamlcdk` uses YAML. `examples/service.yml` shows a fuller sample, and `src/config/schema.ts` is the exact schema.

Top-level shape:

```yaml
service: my-service

provider:
  region: us-east-1
  stage: dev

functions: {}

storage:
  s3: {}
  dynamodb: {}

messaging:
  sqs: {}
  sns: {}

iam:
  statements: {}
```

### `service` and `provider`

`service` is required. `provider` controls deployment defaults:

- `region` - default AWS region
- `stage` - logical stage name; defaults to `dev`
- `account` - target AWS account
- `profile` - AWS profile to use
- `stackName` - override the default stack name (`<service>-<stage>`, sanitized)
- `tags` - extra stack tags
- `s3.cleanupRoleArn` - required if any S3 bucket enables `autoDeleteObjects: true`
- `restApi.apiKeyRequired` - require API keys on all REST API routes
- `restApi.cloudWatchRoleArn` - use an existing API Gateway CloudWatch role
- `deployment` - advanced deployment overrides

Example:

```yaml
service: demo-api
provider:
  region: us-east-1
  stage: dev
  stackName: demo-api-dev
  profile: my-profile
  tags:
    Team: platform
  s3:
    cleanupRoleArn: arn:aws:iam::123456789012:role/MyS3CleanupRole
  restApi:
    apiKeyRequired: true
    cloudWatchRoleArn: arn:aws:iam::123456789012:role/MyApiGatewayCloudWatchRole
```

### `functions`

Each function defines a Lambda plus optional build settings, IAM references, and events:

```yaml
functions:
  hello:
    handler: src/handlers/hello.handler
    runtime: nodejs20.x
    timeout: 10
    memorySize: 256
    environment:
      STAGE: dev
    iam:
      - readUsers
    build:
      mode: typescript
    events:
      http:
        - method: GET
          path: /hello
```

Useful fields:

- `handler` - required module path and export, for example `src/handlers/hello.handler`
- `runtime` - optional Lambda runtime
- `timeout` / `memorySize` - optional Lambda settings
- `environment` - optional Lambda environment variables
- `iam` - either `iam.statements` keys or a single IAM role ARN
- `build.mode` - `typescript` (default), `external`, or `none` (skip build, use handler path as-is)
- `build.command`, `build.cwd`, `build.handler` - external build settings
- `events` - see the event types below
- `restApi.apiKeyRequired` - per-function REST API key requirement when the global provider setting is not set

Example external build:

```yaml
functions:
  hello:
    handler: src/handlers/hello.handler
    build:
      mode: external
      command: npm run build:hello
      cwd: .
      handler: dist/handlers/hello.handler
```

### `iam`

Define reusable IAM statements under `iam.statements`, then reference them from functions:

```yaml
iam:
  statements:
    readUsers:
      actions:
        - dynamodb:GetItem
        - dynamodb:Query
      resources:
        - ref:users

functions:
  hello:
    handler: src/handlers/hello.handler
    iam:
      - readUsers
```

Notes:

- `ref:<resourceName>` in IAM `resources` resolves to the ARN of an yamlcdk-managed S3 bucket, DynamoDB table, SQS queue, or SNS topic.
- A function can also use a direct role ARN instead of statement keys, for example:
  `iam: ["arn:aws:iam::123456789012:role/MyExistingRole"]`
- Do not mix statement keys and a role ARN in the same function.

### `storage.s3`

```yaml
storage:
  s3:
    uploads:
      versioned: true
      autoDeleteObjects: false
```

Fields:

- `versioned` - enable bucket versioning
- `autoDeleteObjects` - delete objects during stack removal; opt-in only

Notes:

- If any bucket sets `autoDeleteObjects: true`, you must also set `provider.s3.cleanupRoleArn`.
- Without `autoDeleteObjects: true`, buckets stay retain-safe on removal.

### `storage.dynamodb`

```yaml
storage:
  dynamodb:
    users:
      partitionKey:
        name: pk
        type: string
      sortKey:
        name: sk
        type: string
      billingMode: PAY_PER_REQUEST
      stream: NEW_AND_OLD_IMAGES
```

Fields:

- `partitionKey` - required
- `sortKey` - optional
- `billingMode` - `PAY_PER_REQUEST` or `PROVISIONED`
- `stream` - `NEW_IMAGE`, `OLD_IMAGE`, `NEW_AND_OLD_IMAGES`, or `KEYS_ONLY`

If you use a DynamoDB stream event on a function, the table must set `stream`.

### `messaging.sqs`

```yaml
messaging:
  sqs:
    jobs:
      visibilityTimeout: 30
```

Fields:

- `visibilityTimeout` - queue visibility timeout in seconds

### `messaging.sns`

```yaml
messaging:
  sns:
    events:
      subscriptions:
        - type: sqs
          target: jobs
```

Fields:

- `subscriptions` - optional topic subscriptions
- Supported subscription type here is currently `sqs`
- `target` is the logical queue name from `messaging.sqs` (for example `jobs`), not `ref:jobs`

Use `functions.<name>.events.sns` when you want a Lambda to subscribe to a topic.

### `functions.<name>.url`

Creates a Lambda Function URL for a function:

```yaml
functions:
  hello:
    handler: src/handlers/hello.handler
    url:
      authType: NONE
      invokeMode: RESPONSE_STREAM
      cors:
        allowedMethods:
          - GET
          - POST
        allowOrigins:
          - https://example.com
        allowHeaders:
          - Content-Type
        exposeHeaders:
          - X-Trace-Id
        allowCredentials: true
        maxAge: 300
```

Fields:

- `authType` - `AWS_IAM` or `NONE` (defaults to `AWS_IAM`)
- `invokeMode` - `BUFFERED` or `RESPONSE_STREAM` (defaults to `BUFFERED`)
- `cors.allowCredentials` - include credentials in CORS requests
- `cors.allowHeaders` - allowed request headers
- `cors.allowedMethods` - allowed methods: `GET`, `PUT`, `HEAD`, `POST`, `DELETE`, `PATCH`, `OPTIONS`, or `*`
- `cors.allowOrigins` - allowed origins
- `cors.exposeHeaders` - response headers exposed to callers
- `cors.maxAge` - preflight cache duration in seconds

Notes:

- Function URLs are configured per function, not under `events`.
- yamlcdk currently supports direct function URLs only; alias-qualified URLs are out of scope.
- Public URLs (`authType: NONE`) synthesize the required Lambda invoke permissions automatically.

## Function event types

For S3, SQS, SNS, and DynamoDB events, reference yamlcdk-managed resources with `ref:<name>`.

### `http`

Creates API Gateway HTTP API routes:

```yaml
functions:
  hello:
    handler: src/handlers/hello.handler
    events:
      http:
        - method: GET
          path: /hello
```

### `rest`

Creates API Gateway REST API routes:

```yaml
functions:
  hello:
    handler: src/handlers/hello.handler
    restApi:
      apiKeyRequired: true
    events:
      rest:
        - method: POST
          path: /orders
```

Use `provider.restApi.apiKeyRequired` to require API keys for all REST routes. If that global setting is not present, `functions.<name>.restApi.apiKeyRequired` can control it per function.

### `s3`

Subscribes a Lambda to S3 bucket notifications:

```yaml
functions:
  thumbnailer:
    handler: src/handlers/thumbnailer.handler
    events:
      s3:
        - bucket: ref:uploads
          events:
            - s3:ObjectCreated:*
```

Supported S3 event names:

- `s3:ObjectCreated:*`
- `s3:ObjectCreated:Put`
- `s3:ObjectCreated:Post`
- `s3:ObjectCreated:Copy`
- `s3:ObjectCreated:CompleteMultipartUpload`
- `s3:ObjectRemoved:*`
- `s3:ObjectRemoved:Delete`
- `s3:ObjectRemoved:DeleteMarkerCreated`

### `sqs`

Subscribes a Lambda to an SQS queue:

```yaml
functions:
  worker:
    handler: src/handlers/worker.handler
    events:
      sqs:
        - queue: ref:jobs
          batchSize: 10
```

### `sns`

Subscribes a Lambda to an SNS topic:

```yaml
functions:
  notifier:
    handler: src/handlers/notifier.handler
    events:
      sns:
        - topic: ref:events
```

### `dynamodb`

Subscribes a Lambda to a DynamoDB stream:

```yaml
functions:
  projector:
    handler: src/handlers/projector.handler
    events:
      dynamodb:
        - table: ref:users
          batchSize: 100
          startingPosition: LATEST
```

`startingPosition` can be `LATEST` or `TRIM_HORIZON`. The table referenced by `table:` must have `stream` enabled under `storage.dynamodb`.

### `eventbridge`

Creates EventBridge rules for schedules or event patterns:

```yaml
functions:
  scheduler:
    handler: src/handlers/scheduler.handler
    events:
      eventbridge:
        - schedule: rate(5 minutes)
        - eventPattern:
            source:
              - my.app
            detail-type:
              - order.created
```

Each entry is either a `schedule` rule or an `eventPattern` rule.

### Serverless Framework format

yamlcdk can also load AWS `serverless.yml` files and adapt the supported subset onto the same compiler model used by yamlcdk format.

Detection is aimed at real Serverless AWS configs (`service`, `provider.name: aws`) and is intended for `serverless.yml` / `serverless.yaml`.

Supported top-level surface today:

- `service`
- `provider.name`, `provider.stage`, `provider.region`, `provider.runtime`, `provider.timeout`, `provider.memorySize`, `provider.stackName`, `provider.profile`, `provider.tags`
- `provider.iam.deploymentRole`, `provider.deploymentBucket.name`
- `functions.*.handler`, `runtime`, `timeout`, `memorySize`, `environment`, `role`, `url`
- function events: `http`, `httpApi`, `schedule`, `s3`, `sns`, `sqs`, `stream` (DynamoDB only), and `eventBridge`
- raw `resources.Resources` / `resources.Outputs`

Supported Serverless variable sources today:

- `${self:...}`
- `${sls:stage}`
- `${sls:service}`
- `${aws:region}`
- `${aws:accountId}` when the account is available via config or environment
- `${opt:...}` from CLI options, with optional fallback, for example `${opt:memory, 1024}` with `yamlcdk deploy --memory 2048`
- `${env:VAR_NAME}` reads the OS environment variable `VAR_NAME`, with optional fallback, for example `${env:DB_HOST, 'localhost'}`
- `${file(path):selector}` with optional fallback, for example `${file(./global.yml):custom.region, 'us-east-1'}`

### `.env` file support

yamlcdk automatically loads `.env` files from the same directory as the YAML definition file:

- `.env` — base environment variables, always loaded when present
- `.env.{stage}` — stage-specific overrides (e.g., `.env.prod`, `.env.dev`), loaded when the stage is known

Loading rules:

- `.env` files are **optional** — missing files are silently ignored.
- **OS environment takes precedence**: values already set in the OS environment are never overridden by `.env` files.
- **Stage-specific files take precedence over `.env`**: `.env.prod` values override `.env` values (but not OS environment).
- The stage is determined from the `--stage` CLI option (via `${opt:stage}`).
- No variable interpolation is performed inside `.env` files — they use plain `KEY=VALUE` syntax.

Example `.env`:

```
# Database config
DB_HOST=localhost
DB_PORT=5432
API_KEY="my-secret-key"
```

Example YAML using `${env:...}`:

```yaml
functions:
  api:
    handler: src/handlers/api.handler
    environment:
      DB_HOST: ${env:DB_HOST, 'localhost'}
      DB_PORT: ${env:DB_PORT, '5432'}
      API_KEY: ${env:API_KEY}
```

`file(path)` resolution rules:

- `path` is resolved relative to the YAML file containing the expression.
- `selector` uses dotted path lookup in the referenced YAML document.
- Nested variables are supported in both `path` and `selector`.
- Missing values fail validation unless a fallback alternative resolves.
- Variables inside imported files (e.g. `${self:provider.stage}`) resolve against the imported file first, then fall back to the entry/root document context. This allows imported files to reference values defined in the main configuration file.
- The same `${file(path):selector}` behavior is also available for yamlcdk and CloudFormation input files.

Example:

```yaml
service: demo-api
provider:
  name: aws
  stage: ${opt:stage, 'dev'}
  region: us-east-1
  runtime: nodejs20.x
  iam:
    deploymentRole: arn:aws:iam::638914547607:role/AldoDefaultCFNRole
  deploymentBucket:
    name: aldo-serverless-build-omni-hybris-lab-dev-us-east-1

functions:
  hello:
    handler: src/handlers/hello.handler
    environment:
      STAGE: ${sls:stage}
    url:
      cors: true
    events:
      - http: GET /hello
      - httpApi: POST /hello
      - sqs:
          arn: !GetAtt JobsQueue.Arn
          batchSize: 10

resources:
  Resources:
    JobsQueue:
      Type: AWS::SQS::Queue
      Properties:
        VisibilityTimeout: 30
```

Notes:

- yamlcdk keeps Serverless support scoped to the current compiler model, not the full Serverless Framework surface.
- `resources.Resources` are adapted through the existing CloudFormation path and merged into the Serverless-derived model.
- Top-level Serverless config is primary; custom resources may augment generated functions and managed resources, but not override generated function logical IDs.
- `provider.deploymentBucket.name` maps to yamlcdk `provider.deployment.fileAssetsBucketName`.
- `provider.iam.deploymentRole` maps to yamlcdk `provider.deployment.cloudFormationExecutionRoleArn`.
- `provider.deployment.requireBootstrap` maps to yamlcdk `provider.deployment.requireBootstrap`.
- With that mapped pair, yamlcdk uses explicit deployment infrastructure and does not synthesize the CDK bootstrap version rule for the stack.
- External SQS/SNS/DynamoDB event targets are not supported yet by the current yamlcdk domain model.

### CloudFormation format

yamlcdk can also accept native CloudFormation YAML templates as input. This is useful when you have existing CloudFormation templates and want to manage them through yamlcdk's deployment workflow.

A CloudFormation template is auto-detected when the file contains `AWSTemplateFormatVersion` or a `Resources` section with `Type: AWS::*` entries.

#### Metadata section

Service-level config that yamlcdk needs (service name, stage, region, etc.) is provided in the `Metadata.yamlcdk` section. If omitted, defaults are used (service name derived from filename, stage `dev`, region `us-east-1`).

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: my-service
    stage: dev
    region: us-east-1
    tags:
      Team: platform
    s3:
      cleanupRoleArn: arn:aws:iam::123456789012:role/MyS3CleanupRole
    deployment:
      fileAssetsBucketName: my-cdk-assets
      useCliCredentials: true
```

All `Metadata.yamlcdk` fields are optional:

- `service` - service name (defaults to filename)
- `stage` - logical stage name (defaults to `dev`)
- `region` - AWS region (defaults to `AWS_REGION` or `us-east-1`)
- `account`, `profile` - AWS account and profile
- `tags` - extra stack tags
- `s3.cleanupRoleArn` - required if using `autoDeleteObjects`
- `restApi.cloudWatchRoleArn` - existing API Gateway CloudWatch role
- `deployment` - same advanced deployment overrides as the yamlcdk format

#### Build handling

For each `AWS::Lambda::Function`, yamlcdk checks if the handler source file exists as TypeScript (e.g. `src/handlers/hello.ts` for `Handler: src/handlers/hello.handler`). If it does, the function is compiled with `tsc` (same as the yamlcdk format). If no `.ts` file is found, the handler path is used as-is (`build.mode: none`), assuming the code is already built or will be provided at the handler location.

#### Supported resource types

The following CloudFormation resource types are extracted and mapped to the yamlcdk compiler model:

| CloudFormation Type | What it maps to |
| --- | --- |
| `AWS::Lambda::Function` | Lambda functions (handler, runtime, timeout, memorySize, environment) |
| `AWS::Lambda::Url` | Lambda Function URLs attached to functions (authType, invokeMode, CORS) |
| `AWS::S3::Bucket` | S3 buckets (versioning, notification config) |
| `AWS::DynamoDB::Table` | DynamoDB tables (keys, billing mode, streams) |
| `AWS::SQS::Queue` | SQS queues (visibility timeout) |
| `AWS::SNS::Topic` | SNS topics |
| `AWS::SNS::Subscription` | SNS subscriptions (sqs and lambda protocols) |
| `AWS::Lambda::EventSourceMapping` | SQS and DynamoDB stream event triggers on functions |
| `AWS::Events::Rule` | EventBridge schedule and event pattern rules targeting functions |
| `AWS::ApiGatewayV2::Api/Route/Integration` | HTTP API routes targeting functions |

Unsupported resource types in the template are silently ignored.

For `AWS::Lambda::Url`, yamlcdk currently supports direct function URLs only: `TargetFunctionArn` must resolve to a Lambda function resource in the same template via `!Ref` or `!GetAtt`, and `Qualifier` is not supported yet.

#### Cross-resource references

CloudFormation intrinsic functions are supported for cross-resource wiring:

- `!Ref LogicalId` — reference another resource
- `!GetAtt LogicalId.Attribute` — get a resource attribute
- `!Sub`, `!Join`, `!Select`, `!If`, `!Equals`, etc. — parsed but only `!Ref` and `!GetAtt` are used for resource resolution

For example, an `EventSourceMapping` uses `!Ref` and `!GetAtt` to link a Lambda function to an SQS queue:

```yaml
Resources:
  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/hello.handler
      Runtime: nodejs20.x

  JobsQueue:
    Type: AWS::SQS::Queue

  HelloSqsTrigger:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref HelloFunction
      EventSourceArn: !GetAtt JobsQueue.Arn
      BatchSize: 10
```

#### Example

See `examples/cloudformation.yml` for a complete CloudFormation template demonstrating all supported resource types and event wiring patterns.

## Deployment overrides

Use `provider.deployment` when you need to control how CDK assets and deployment roles are handled.

```yaml
provider:
  deployment:
    fileAssetsBucketName: my-cdk-assets-us-east-1
    imageAssetsRepositoryName: my-cdk-assets-ecr
    useCliCredentials: true
    qualifier: hnb659fds
    requireBootstrap: false
```

Supported fields:

- `fileAssetsBucketName` - pre-created bucket for CDK file assets
- `imageAssetsRepositoryName` - pre-created ECR repository for CDK image assets
- `cloudFormationServiceRoleArn` - deploy with `aws cloudformation deploy --role-arn` for template-only stacks
- `cloudFormationExecutionRoleArn` - CloudFormation execution role for CDK deployment mode
- `deployRoleArn` - CDK deploy role
- `qualifier` - custom CDK bootstrap qualifier
- `useCliCredentials` - publish assets with the active CLI credentials
- `requireBootstrap` - override bootstrap version rule behavior

Important rules:

- If you set asset locations (`fileAssetsBucketName` or `imageAssetsRepositoryName`) without `deployRoleArn`, yamlcdk infers `useCliCredentials: true`.
- `useCliCredentials: true` cannot be combined with `deployRoleArn`.
- `useCliCredentials: true` can be combined with `cloudFormationExecutionRoleArn` when you want the CLI credentials to publish assets and start the deployment, but CloudFormation to execute the stack operation with that role.
- `cloudFormationServiceRoleArn` cannot be combined with `deployRoleArn` or `cloudFormationExecutionRoleArn`.
- `cloudFormationServiceRoleArn` is for template-only stacks. It is not supported for stacks that synthesize CDK asset metadata, such as Lambda code or container image assets.
- If you use explicit deployment infrastructure, yamlcdk disables the bootstrap version rule unless you set `requireBootstrap` yourself.
- `requireBootstrap: false` does not make role-based CDK deployments bootstrapless by itself; role-based CDK deploys can still require a bootstrapped environment.

When adapting `examples/service.yml`, choose one supported deployment mode at a time: CLI-credentials mode, role-based CDK mode, or CloudFormation service-role mode.

## Operational notes

- Region resolution order is: CLI `--region` -> `provider.region` -> `AWS_REGION` -> `us-east-1`.
- `provider.stage` defaults to `dev`.
- If `provider.stackName` is not set, yamlcdk uses a sanitized `<service>-<stage>` stack name.
- yamlcdk adds `Service` and `Stage` stack tags automatically, then applies any extra `provider.tags`.
- Generated resource names are stage-scoped. For example, logical names like `jobs` or `users` become physical resource names with the stage suffix.
- `deploy` does not run bootstrap automatically. Run `npx cdk bootstrap ...` manually when your deployment mode requires it.
- If `remove` runs in a non-interactive shell, pass `--force`.
- `synth` prints the generated CloudFormation template to stdout.
- `deploy` prints CloudFormation stack outputs after a successful deployment when available.

## More reading

- `examples/service.yml` - yamlcdk format config example
- `examples/serverless.yml` - Serverless Framework format config example
- `examples/cloudformation.yml` - CloudFormation format config example
- `src/config/schema.ts` - exact yamlcdk config schema
- [DEVELOPER.md](./DEVELOPER.md) - contributor setup, workflow, and test strategy
- [ARCHITECTURE.md](./ARCHITECTURE.md) - plugin system and compiler/runtime architecture
