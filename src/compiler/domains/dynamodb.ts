import cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { withStageName } from "../stack/helpers.js";
import { DYNAMODB_CONFIG } from "../plugins/native-domain-configs.js";
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

export const dynamodbDomain: DomainPlugin = {
  name: "dynamodb",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(DYNAMODB_CONFIG);
    if (!config) return;

    for (const [name, table] of Object.entries(config.tables)) {
      const streamView = table.stream
        ? STREAM_VIEW_MAP[table.stream]
        : undefined;
      ctx.refs[name] = new dynamodb.Table(ctx.stack, `Table${name}`, {
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
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        stream: streamView,
      });
    }
  },

  bind(ctx, events) {
    for (const event of events) {
      if (event.type !== "dynamodb-stream") continue;
      const refName = event.table.replace("ref:", "");
      const table = ctx.refs[refName];
      if (!table || !("tableStreamArn" in table)) {
        throw new Error(
          `DynamoDB stream event references unknown table "${refName}". ` +
            `Define it under storage.dynamodb with stream enabled.`,
        );
      }
      const dynamoTable = table as dynamodb.Table;
      if (!dynamoTable.tableStreamArn) {
        throw new Error(
          `DynamoDB table "${refName}" does not have streams enabled. ` +
            `Add "stream: NEW_AND_OLD_IMAGES" (or another view type) to storage.dynamodb.${refName}.`,
        );
      }
      event.fnResource.addEventSource(
        new lambdaEventSources.DynamoEventSource(dynamoTable, {
          startingPosition:
            event.startingPosition === "TRIM_HORIZON"
              ? lambda.StartingPosition.TRIM_HORIZON
              : lambda.StartingPosition.LATEST,
          batchSize: event.batchSize ?? 100,
        }),
      );
    }
  },
};
