import cdk, { Duration } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
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
        environment: fn.environment ? { ...fn.environment } : undefined,
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
