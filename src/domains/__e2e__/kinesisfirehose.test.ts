import { Match } from "aws-cdk-lib/assertions";
import { describe, test } from "vitest";
import { synthServiceConfig } from "./helpers.js";

describe("kinesisfirehose domain e2e", () => {
  test("creates Firehose delivery streams with helper defaults", () => {
    const { template } = synthServiceConfig({
      messaging: {
        firehose: {
          helperDefaults: true,
          streams: {
            audit: {
              properties: {
                ExtendedS3DestinationConfiguration: {
                  BucketARN: "arn:aws:s3:::audit-bucket",
                  RoleARN: "arn:aws:iam::123456789012:role/FirehoseRole",
                },
              },
            },
          },
        },
      },
    });

    template.resourceCountIs("AWS::KinesisFirehose::DeliveryStream", 1);
    template.hasResourceProperties(
      "AWS::KinesisFirehose::DeliveryStream",
      Match.objectLike({
        DeliveryStreamName: "audit-dev",
        DeliveryStreamType: "DirectPut",
        ExtendedS3DestinationConfiguration: Match.objectLike({
          BucketARN: "arn:aws:s3:::audit-bucket",
          RoleARN: "arn:aws:iam::123456789012:role/FirehoseRole",
        }),
      }),
    );
  });
});
