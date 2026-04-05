import cdk, { Duration } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { prepareFunctionBuilds } from "../../runtime/build.js";
import { isIamRoleArn, resolveIamPolicy, withStageName } from "../stack/helpers.js";
import type { DomainPlugin, EventBinding } from "../plugins/index.js";
import type {
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
    const buildOutputs = prepareFunctionBuilds(ctx.model);
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

      const build = buildOutputs[name];
      const fnResource = new lambda.Function(ctx.stack, `Function${name}`, {
        functionName: withStageName(name, ctx.model.provider.stage),
        runtime:
          fn.runtime === "nodejs22.x"
            ? lambda.Runtime.NODEJS_22_X
            : lambda.Runtime.NODEJS_20_X,
        handler: build.handler,
        code: lambda.Code.fromAsset(build.assetPath),
        timeout: Duration.seconds(fn.timeout ?? 30),
        memorySize: fn.memorySize ?? 256,
        environment: fn.environment ? { ...fn.environment } : undefined,
        role: importedRole,
      });
      ctx.refs[name] = fnResource;

      if (fn.url) {
        const functionUrl = fnResource.addFunctionUrl(toFunctionUrlOptions(fn.url));
        new cdk.CfnOutput(ctx.stack, `${name}FunctionUrl`, {
          value: functionUrl.url,
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
};
