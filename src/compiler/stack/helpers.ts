import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { CfnElement, Stack } from "aws-cdk-lib";
import type { Construct } from "constructs";

/** Minimal IAM statement shape accepted by resolveIamPolicy. */
export interface IamStatementInput {
  readonly sid?: string;
  readonly effect?: "Allow" | "Deny";
  readonly actions: readonly string[];
  readonly resources: readonly string[];
}

export function withStageName(base: string, stage: string): string {
  return `${base}-${stage}`;
}

export function isIamRoleArn(value: string): boolean {
  return /^arn:aws:iam::\d{12}:role\/.+/.test(value);
}

export function resolveIamPolicy(
  statement: IamStatementInput,
  resources: Record<string, Construct>,
): iam.PolicyStatement {
  const resolvedResources = statement.resources.map((res) => {
    if (res.startsWith("ref:")) {
      const key = res.replace("ref:", "");
      const value = resources[key];
      if (!value) {
        throw new Error(`IAM reference "${key}" not found`);
      }
      if ("bucketArn" in value) {
        return (value as s3.Bucket).bucketArn;
      }
      if ("queueArn" in value) {
        return (value as sqs.Queue).queueArn;
      }
      if ("topicArn" in value) {
        return (value as sns.Topic).topicArn;
      }
      if ("tableArn" in value) {
        return (value as dynamodb.Table).tableArn;
      }
      throw new Error(`Unsupported ref target "${key}" in IAM resource`);
    }
    return res;
  });

  return new iam.PolicyStatement({
    sid: statement.sid,
    effect: statement.effect === "Deny" ? iam.Effect.DENY : iam.Effect.ALLOW,
    actions: [...statement.actions],
    resources: resolvedResources,
  });
}

export function tryGetLogicalId(
  stack: Stack,
  value: Construct,
): string | undefined {
  const cfnElement =
    value instanceof CfnElement
      ? value
      : value.node.defaultChild instanceof CfnElement
        ? value.node.defaultChild
        : undefined;

  return cfnElement ? stack.getLogicalId(cfnElement) : undefined;
}
