import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import {
  firstResourceOfType,
  functionConfig,
  synthServiceConfig,
  type ResourceDefinition,
} from "./helpers.js";

describe("s3 domain e2e", () => {
  test("retains the bucket when autoDeleteObjects is not configured", () => {
    const { template } = synthServiceConfig({
      storage: {
        s3: { uploads: {} },
      },
    });

    const bucket = firstResourceOfType<ResourceDefinition>(
      template,
      "AWS::S3::Bucket",
    );

    expect(bucket?.DeletionPolicy).toBe("Retain");
    expect(bucket?.Properties?.VersioningConfiguration).toBeUndefined();
  });

  test("enables bucket versioning when versioned is configured", () => {
    const { template } = synthServiceConfig({
      storage: {
        s3: { uploads: { versioned: true } },
      },
    });

    template.hasResourceProperties(
      "AWS::S3::Bucket",
      Match.objectLike({
        VersioningConfiguration: {
          Status: "Enabled",
        },
      }),
    );
  });

  test("deletes the bucket when autoDeleteObjects and cleanupRoleArn are configured", () => {
    const { template } = synthServiceConfig({
      provider: {
        s3: {
          cleanupRoleArn: "arn:aws:iam::123456789012:role/MyS3CleanupRole",
        },
      },
      storage: {
        s3: { uploads: { autoDeleteObjects: true } },
      },
    });

    const bucket = firstResourceOfType<ResourceDefinition>(
      template,
      "AWS::S3::Bucket",
    );

    expect(bucket?.DeletionPolicy).toBe("Delete");
  });

  test("rejects autoDeleteObjects when cleanupRoleArn is missing", () => {
    expect(() =>
      synthServiceConfig({
        storage: {
          s3: { uploads: { autoDeleteObjects: true } },
        },
      }),
    ).toThrow("S3 auto-delete requires provider.s3.cleanupRoleArn");
  });

  test("creates a bucket notification custom resource for an s3 event", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            s3: [{ bucket: "ref:uploads", events: ["s3:ObjectCreated:*"] }],
          },
        }),
      },
      storage: {
        s3: { uploads: {} },
      },
    });

    template.resourceCountIs("Custom::S3BucketNotifications", 1);
  });
});
