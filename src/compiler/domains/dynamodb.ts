import cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { withStageName } from "../stack/helpers.js";
import { normalizeManagedResourceRef } from "../resource-refs.js";
import { DYNAMODB_CONFIG } from "../plugins/index.js";
import type { DomainPlugin } from "../plugins/index.js";

function attrType(
  value: "string" | "number" | "binary",
): dynamodb.AttributeType {
  if (value === "string") return dynamodb.AttributeType.STRING;
  if (value === "number") return dynamodb.AttributeType.NUMBER;
  return dynamodb.AttributeType.BINARY;
}

const STREAM_VIEW_MAP: Record<string, dynamodb.StreamViewType> = {
  NEW_IMAGE: dynamodb.StreamViewType.NEW_IMAGE,
  OLD_IMAGE: dynamodb.StreamViewType.OLD_IMAGE,
  NEW_AND_OLD_IMAGES: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
  KEYS_ONLY: dynamodb.StreamViewType.KEYS_ONLY,
};

function toDynamoRemovalPolicy(
  removalPolicy: "DESTROY" | "RETAIN" | undefined,
): cdk.RemovalPolicy {
  if (removalPolicy === "RETAIN") {
    return cdk.RemovalPolicy.RETAIN;
  }
  return cdk.RemovalPolicy.DESTROY;
}

export const dynamodbDomain: DomainPlugin = {
  name: "dynamodb",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(DYNAMODB_CONFIG);
    if (!config) return;

    for (const [name, table] of Object.entries(config.tables)) {
      const streamView = table.stream
        ? STREAM_VIEW_MAP[table.stream]
        : undefined;
      const tableResource = new dynamodb.Table(ctx.stack, `Table${name}`, {
        tableName: withStageName(name, ctx.model.provider.stage),
        partitionKey: {
          name: table.partitionKey.name,
          type: attrType(table.partitionKey.type),
        },
        sortKey: table.sortKey
          ? {
              name: table.sortKey.name,
              type: attrType(table.sortKey.type),
            }
          : undefined,
        billingMode:
          table.billingMode === "PROVISIONED"
            ? dynamodb.BillingMode.PROVISIONED
            : dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: toDynamoRemovalPolicy(table.removalPolicy),
        stream: streamView,
      });
      ctx.refs[name] = tableResource;
      ctx.availableOutputs.set(`${name}TableArn`, tableResource.tableArn);
      ctx.availableOutputs.set(`${name}TableName`, tableResource.tableName);
    }
  },

  bind(ctx, events) {
    for (const event of events) {
      if (event.type !== "dynamodb-stream") continue;
      const refName = normalizeManagedResourceRef(event.table);
      const table = ctx.refs[refName];
      if (!table || !("tableStreamArn" in table)) {
        throw new Error(
          `DynamoDB stream event references unknown table "${refName}". ` +
            `Define it under storage.dynamodb with stream enabled, and reference it as "<name>" or "ref:<name>".`,
        );
      }
      const dynamoTable = table as dynamodb.Table;
      if (!dynamoTable.tableStreamArn) {
        throw new Error(
          `DynamoDB table "${refName}" does not have streams enabled. ` +
            `Add "stream: NEW_AND_OLD_IMAGES" (or another view type) to storage.dynamodb.${refName}.`,
        );
      }
      new lambda.EventSourceMapping(
        ctx.stack,
        `DynamoEventSource${event.functionName}${refName}`,
        {
          target: event.fnResource,
          eventSourceArn: dynamoTable.tableStreamArn,
          startingPosition:
            event.startingPosition === "TRIM_HORIZON"
              ? lambda.StartingPosition.TRIM_HORIZON
              : lambda.StartingPosition.LATEST,
          batchSize: event.batchSize ?? 100,
        },
      );
      event.fnResource.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            "dynamodb:DescribeStream",
            "dynamodb:GetRecords",
            "dynamodb:GetShardIterator",
          ],
          resources: [dynamoTable.tableStreamArn],
        }),
      );
      event.fnResource.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["dynamodb:ListStreams"],
          resources: ["*"],
        }),
      );
    }
  },
};
