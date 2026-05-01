import * as cdk from "aws-cdk-lib";
import { withStageName } from "../../compiler/stack/helpers.js";
import type {
  DomainPlugin,
  DomainValidationContribution,
} from "../../compiler/plugins/index.js";
import {
  KINESIS_FIREHOSE_CONFIG,
  type FirehoseDeliveryStreamConfig,
  type FirehoseTokenString,
} from "./model.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toTokenValue(
  value: FirehoseTokenString,
): string | Record<string, unknown> {
  if (typeof value === "string") return value;
  return value;
}

function hasProperty(
  input: Record<string, unknown>,
  key: string,
): boolean {
  return input[key] !== undefined;
}

function buildDeliveryStreamProperties(
  key: string,
  stage: string,
  stream: FirehoseDeliveryStreamConfig,
  helperDefaults: boolean,
): Record<string, unknown> {
  const properties = { ...stream.properties };

  if (stream.name !== undefined) {
    properties.DeliveryStreamName = toTokenValue(stream.name);
  }
  if (stream.type !== undefined) {
    properties.DeliveryStreamType = stream.type;
  }

  if (helperDefaults) {
    if (!hasProperty(properties, "DeliveryStreamName")) {
      properties.DeliveryStreamName = withStageName(key, stage);
    }
    if (!hasProperty(properties, "DeliveryStreamType")) {
      properties.DeliveryStreamType = "DirectPut";
    }
  }

  return properties;
}

function describeStreamName(
  key: string,
  properties: Record<string, unknown>,
): string {
  const value = properties.DeliveryStreamName;
  if (typeof value === "string") return value;
  if (isObject(value)) return "<intrinsic>";
  return key;
}

export const kinesisfirehoseDomain: DomainPlugin = {
  name: "kinesisfirehose",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(KINESIS_FIREHOSE_CONFIG);
    if (!config) return;

    const stage = ctx.model.provider.stage;
    for (const [key, stream] of Object.entries(config.streams)) {
      const properties = buildDeliveryStreamProperties(
        key,
        stage,
        stream,
        config.helperDefaults,
      );

      const streamResource = new cdk.CfnResource(
        ctx.stack,
        `FirehoseDeliveryStream${key}`,
        {
          type: "AWS::KinesisFirehose::DeliveryStream",
          properties,
        },
      );

      ctx.refs[key] = streamResource;
      ctx.availableOutputs.set(
        `${key}DeliveryStreamName`,
        streamResource.ref,
      );
      ctx.availableOutputs.set(
        `${key}DeliveryStreamArn`,
        cdk.Token.asString(streamResource.getAtt("Arn")),
      );
    }
  },

  describeValidation(ctx) {
    const config = ctx.model.domainConfigs.get(KINESIS_FIREHOSE_CONFIG);
    if (!config) return [];

    const contributions: DomainValidationContribution[] = [];
    for (const [key, stream] of Object.entries(config.streams)) {
      const properties = buildDeliveryStreamProperties(
        key,
        ctx.model.provider.stage,
        stream,
        config.helperDefaults,
      );

      contributions.push({
        section: "Resources",
        description: `Firehose delivery stream "${key}"`,
        properties: {
          name: describeStreamName(key, properties),
          type:
            typeof properties.DeliveryStreamType === "string"
              ? properties.DeliveryStreamType
              : "<intrinsic>",
          helperDefaults: config.helperDefaults,
        },
        status: "valid",
      });
    }

    return contributions;
  },
};
