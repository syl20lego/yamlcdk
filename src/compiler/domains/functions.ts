import cdk, { Duration } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import {
  isIamRoleArn,
  resolveIamPolicy,
  tryGetLogicalId,
  withStageName,
} from "../stack/helpers.js";
import type {
  DomainPlugin,
  EventBinding,
  DomainValidationContribution,
} from "../plugins/index.js";
import type {
  EventDeclaration,
  FunctionUrlConfig,
  FunctionUrlInvokeMode,
} from "../model.js";
import type { EnvValue } from "../../schema/cfn-env.js";
import type { Construct } from "constructs";

type FunctionUrlAllowedMethod = NonNullable<
  NonNullable<FunctionUrlConfig["cors"]>["allowedMethods"]
>[number];

function toLambdaFunctionUrlAuthType(
  authType: FunctionUrlConfig["authType"],
): lambda.FunctionUrlAuthType {
  return authType === "NONE"
    ? lambda.FunctionUrlAuthType.NONE
    : lambda.FunctionUrlAuthType.AWS_IAM;
}

function toLambdaInvokeMode(
  invokeMode: FunctionUrlInvokeMode,
): lambda.InvokeMode {
  return invokeMode === "RESPONSE_STREAM"
    ? lambda.InvokeMode.RESPONSE_STREAM
    : lambda.InvokeMode.BUFFERED;
}

function toLambdaHttpMethod(method: FunctionUrlAllowedMethod): lambda.HttpMethod {
  switch (method) {
    case "GET":
      return lambda.HttpMethod.GET;
    case "PUT":
      return lambda.HttpMethod.PUT;
    case "HEAD":
      return lambda.HttpMethod.HEAD;
    case "POST":
      return lambda.HttpMethod.POST;
    case "DELETE":
      return lambda.HttpMethod.DELETE;
    case "PATCH":
      return lambda.HttpMethod.PATCH;
    case "OPTIONS":
      return lambda.HttpMethod.OPTIONS;
    case "*":
      return lambda.HttpMethod.ALL;
    default:
      throw new Error(`Unsupported Lambda function URL CORS method "${method}".`);
  }
}

function toFunctionUrlOptions(
  config: FunctionUrlConfig,
): lambda.FunctionUrlOptions {
  return {
    authType: toLambdaFunctionUrlAuthType(config.authType),
    invokeMode: toLambdaInvokeMode(config.invokeMode),
    cors: config.cors
      ? {
          allowCredentials: config.cors.allowCredentials,
          allowedHeaders: config.cors.allowHeaders,
          allowedMethods: config.cors.allowedMethods?.map(toLambdaHttpMethod),
          allowedOrigins: config.cors.allowOrigins,
          exposedHeaders: config.cors.exposeHeaders,
          maxAge:
            config.cors.maxAge !== undefined
              ? Duration.seconds(config.cors.maxAge)
              : undefined,
        }
      : undefined,
  };
}

function summarizeLinkedEvent(event: EventDeclaration): Record<string, unknown> {
  switch (event.type) {
    case "http":
      return { type: event.type, method: event.method, path: event.path };
    case "rest":
      return {
        type: event.type,
        method: event.method,
        path: event.path,
        apiKeyRequired: event.apiKeyRequired,
      };
    case "s3":
      return { type: event.type, bucket: event.bucket, events: [...event.events] };
    case "sqs":
      return {
        type: event.type,
        queue: event.queue,
        batchSize: event.batchSize ?? 10,
      };
    case "sns":
      return { type: event.type, topic: event.topic };
    case "dynamodb-stream":
      return {
        type: event.type,
        table: event.table,
        batchSize: event.batchSize ?? 100,
        startingPosition: event.startingPosition ?? "LATEST",
      };
    case "eventbridge":
      return {
        type: event.type,
        schedule: event.schedule,
        eventPattern: event.eventPattern,
      };
    default:
      return { type: "unknown" };
  }
}

function toLambdaRuntime(runtime: string | undefined): lambda.Runtime {
  switch (runtime) {
    case undefined:
    case "nodejs20.x":
      return lambda.Runtime.NODEJS_20_X;
    case "nodejs22.x":
      return lambda.Runtime.NODEJS_22_X;
    case "nodejs24.x":
      return lambda.Runtime.NODEJS_24_X;
    default:
      throw new Error(
        `Unsupported runtime "${runtime}" for Lambda function. ` +
          `Supported runtimes: nodejs20.x, nodejs22.x, nodejs24.x.`,
      );
  }
}

function lowerFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function canonicalizeRefKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function findManagedRefTarget(
  ref: string,
  refs: Record<string, Construct>,
): Construct | undefined {
  if (ref in refs) return refs[ref];

  const candidates = new Set<string>([lowerFirst(ref)]);
  const prefixStripped = ref.replace(/^(Queue|Table|Topic|Bucket|Function)/, "");
  if (prefixStripped !== ref) {
    candidates.add(prefixStripped);
    candidates.add(lowerFirst(prefixStripped));
  }
  for (const candidate of candidates) {
    if (candidate in refs) return refs[candidate];
  }

  const canonical = canonicalizeRefKey(ref);
  const matchedEntry = Object.entries(refs).find(
    ([key]) => canonicalizeRefKey(key) === canonical,
  );
  return matchedEntry?.[1];
}

function resolveRefValueFromConstructRef(
  ref: string,
  refs: Record<string, Construct>,
): string | undefined {
  const target = findManagedRefTarget(ref, refs);
  if (!target) return undefined;

  if ("queueUrl" in target) {
    return cdk.Token.asString((target as sqs.Queue).queueUrl);
  }
  if ("tableName" in target) {
    return cdk.Token.asString((target as dynamodb.Table).tableName);
  }
  if ("topicArn" in target) {
    return cdk.Token.asString((target as sns.Topic).topicArn);
  }
  if ("bucketName" in target) {
    return cdk.Token.asString((target as s3.Bucket).bucketName);
  }
  if ("functionName" in target) {
    return cdk.Token.asString((target as lambda.Function).functionName);
  }

  return undefined;
}

function resolveGetAttValueFromConstructRef(
  logicalId: string,
  attribute: string,
  refs: Record<string, Construct>,
): string | undefined {
  const target = findManagedRefTarget(logicalId, refs);
  if (!target) return undefined;

  if ("queueArn" in target && attribute === "Arn") {
    return cdk.Token.asString((target as sqs.Queue).queueArn);
  }
  if ("queueUrl" in target && attribute === "QueueUrl") {
    return cdk.Token.asString((target as sqs.Queue).queueUrl);
  }
  if ("queueName" in target && attribute === "QueueName") {
    return cdk.Token.asString((target as sqs.Queue).queueName);
  }
  if ("tableArn" in target && attribute === "Arn") {
    return cdk.Token.asString((target as dynamodb.Table).tableArn);
  }
  if ("tableStreamArn" in target && attribute === "StreamArn") {
    const streamArn = (target as dynamodb.Table).tableStreamArn;
    return streamArn ? cdk.Token.asString(streamArn) : undefined;
  }
  if ("topicArn" in target && attribute === "TopicArn") {
    return cdk.Token.asString((target as sns.Topic).topicArn);
  }
  if ("bucketArn" in target && attribute === "Arn") {
    return cdk.Token.asString((target as s3.Bucket).bucketArn);
  }
  if ("functionArn" in target && attribute === "Arn") {
    return cdk.Token.asString((target as lambda.Function).functionArn);
  }

  return undefined;
}

function resolveEnvIntrinsic(value: unknown, refs: Record<string, Construct>): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("Ref" in obj && typeof obj.Ref === "string") {
      const resolvedFromConstruct = resolveRefValueFromConstructRef(obj.Ref, refs);
      if (resolvedFromConstruct !== undefined) return resolvedFromConstruct;
      return cdk.Fn.ref(obj.Ref);
    }
    if ("Fn::GetAtt" in obj) {
      const parts = obj["Fn::GetAtt"] as [string, string];
      const resolvedFromConstruct = resolveGetAttValueFromConstructRef(
        parts[0],
        parts[1],
        refs,
      );
      if (resolvedFromConstruct !== undefined) return resolvedFromConstruct;
      return cdk.Token.asString(cdk.Fn.getAtt(parts[0], parts[1]));
    }
    if ("Fn::Sub" in obj) {
      const sub = obj["Fn::Sub"];
      if (typeof sub === "string") return cdk.Fn.sub(sub);
      const [template, vars] = sub as [string, Record<string, unknown>];
      const resolvedVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) {
        resolvedVars[k] = resolveEnvIntrinsic(v, refs);
      }
      return cdk.Fn.sub(template, resolvedVars);
    }
    if ("Fn::Join" in obj) {
      const [separator, parts] = obj["Fn::Join"] as [string, unknown[]];
      return cdk.Fn.join(
        separator,
        parts.map((p) => resolveEnvIntrinsic(p, refs)),
      );
    }
  }
  throw new Error(`Unsupported environment variable intrinsic: ${JSON.stringify(value)}`);
}

function resolveEnvValue(value: EnvValue, refs: Record<string, Construct>): string {
  if (typeof value === "string") return value;
  return resolveEnvIntrinsic(value, refs);
}

function resolveEnvRecord(
  env: Record<string, EnvValue>,
  refs: Record<string, Construct>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = resolveEnvValue(value, refs);
  }
  return result;
}

export const functionsDomain: DomainPlugin = {
  name: "functions",

  validate(ctx) {
    for (const [name, fn] of Object.entries(ctx.model.functions)) {
      const iamEntries = fn.iam ?? [];
      const roleArnEntry = iamEntries.find((entry) => isIamRoleArn(entry));
      const inlineStatementRefs = iamEntries.filter(
        (entry) => !isIamRoleArn(entry),
      );
      if (roleArnEntry && inlineStatementRefs.length > 0) {
        throw new Error(
          `Function "${name}" mixes a role ARN with iam statement references. ` +
            `Use either a role ARN or iam.statements keys, not both.`,
        );
      }
    }
  },

  synthesize(ctx) {
    const events: EventBinding[] = [];

    for (const [name, fn] of Object.entries(ctx.model.functions)) {
      const iamEntries = fn.iam ?? [];
      const roleArnEntry = iamEntries.find((entry) => isIamRoleArn(entry));
      const inlineStatementRefs = iamEntries.filter(
        (entry) => !isIamRoleArn(entry),
      );

      const importedRole = roleArnEntry
        ? iam.Role.fromRoleArn(ctx.stack, `FunctionRole${name}`, roleArnEntry, {
            mutable: false,
          })
        : undefined;

      const build = ctx.builds[name];
      const fnResource = new lambda.Function(ctx.stack, `Function${name}`, {
        functionName: withStageName(name, ctx.model.provider.stage),
        runtime: toLambdaRuntime(fn.runtime),
        handler: build.handler,
        code: build.inline
          ? lambda.Code.fromInline(build.inline)
          : lambda.Code.fromAsset(build.assetPath),
        timeout: Duration.seconds(fn.timeout ?? 30),
        memorySize: fn.memorySize ?? 256,
        environment: fn.environment ? resolveEnvRecord(fn.environment, ctx.refs) : undefined,
        role: importedRole,
      });
      ctx.refs[name] = fnResource;
      ctx.availableOutputs.set(`${name}LambdaFunctionQualifiedArn`, fnResource.functionArn);
      ctx.availableOutputs.set(`${name}LambdaFunctionArn`, fnResource.functionArn);

      if (fn.url) {
        const functionUrl = fnResource.addFunctionUrl(toFunctionUrlOptions(fn.url));
        const urlValue = functionUrl.url;
        ctx.availableOutputs.set(`${name}FunctionUrl`, urlValue);
        new cdk.CfnOutput(ctx.stack, `${name}FunctionUrl`, {
          value: urlValue,
        });
      }

      for (const policyName of inlineStatementRefs) {
        const statement = ctx.model.iam.statements[policyName];
        if (!statement) {
          throw new Error(
            `Function "${name}" references unknown IAM statement "${policyName}". ` +
              `Use a defined iam.statements key or a role ARN (arn:aws:iam::<account>:role/<name>).`,
          );
        }
        fnResource.addToRolePolicy(resolveIamPolicy(statement, ctx.refs));
      }

      // Convert model-level EventDeclarations → CDK-level EventBindings
      for (const event of fn.events) {
        events.push({ functionName: name, fnResource, ...event });
      }
    }

    return { events };
  },

  describeValidation(ctx) {
    const contributions: DomainValidationContribution[] = [];

    for (const [name, fn] of Object.entries(ctx.model.functions)) {
      const ref = ctx.refs[name];
      if (!ref || !(ref instanceof lambda.Function)) {
        continue;
      }
      const logicalId = tryGetLogicalId(ctx.stack, ref);
      if (!logicalId) {
        continue;
      }

      contributions.push({
        section: "Resources",
        logicalId,
        description: `Lambda function "${name}"`,
        properties: {
          memory: fn.memorySize ?? 256,
          timeout: fn.timeout ?? 30,
          cors: fn.url?.cors ?? null,
          linkedEvents: fn.events.map(summarizeLinkedEvent),
        },
        status: "valid",
      });
    }

    return contributions;
  },
};
