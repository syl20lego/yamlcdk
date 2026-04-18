import cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { withStageName } from "../../compiler/stack/helpers.js";
import { normalizeManagedResourceRef } from "../../compiler/resource-refs.js";
import { S3_CONFIG } from "./model.js";
import type { DomainPlugin } from "../../compiler/plugins/index.js";

const S3_EVENT_MAP: Record<string, s3.EventType> = {
  "s3:ObjectCreated:*": s3.EventType.OBJECT_CREATED,
  "s3:ObjectCreated:Put": s3.EventType.OBJECT_CREATED_PUT,
  "s3:ObjectCreated:Post": s3.EventType.OBJECT_CREATED_POST,
  "s3:ObjectCreated:Copy": s3.EventType.OBJECT_CREATED_COPY,
  "s3:ObjectCreated:CompleteMultipartUpload":
    s3.EventType.OBJECT_CREATED_COMPLETE_MULTIPART_UPLOAD,
  "s3:ObjectRemoved:*": s3.EventType.OBJECT_REMOVED,
  "s3:ObjectRemoved:Delete": s3.EventType.OBJECT_REMOVED_DELETE,
  "s3:ObjectRemoved:DeleteMarkerCreated":
    s3.EventType.OBJECT_REMOVED_DELETE_MARKER_CREATED,
};

function resolveS3EventType(eventName: string): s3.EventType {
  const mapped = S3_EVENT_MAP[eventName];
  if (!mapped) {
    throw new Error(
      `Unknown S3 event type "${eventName}". Supported: ${Object.keys(S3_EVENT_MAP).join(", ")}`,
    );
  }
  return mapped;
}

export const s3Domain: DomainPlugin = {
  name: "s3",

  validate(ctx) {
    const config = ctx.model.domainConfigs.get(S3_CONFIG);
    if (!config) return;
    const hasAutoDelete = Object.values(config.buckets).some(
      (b) => b.autoDeleteObjects === true,
    );
    if (hasAutoDelete && !config.cleanupRoleArn) {
      throw new Error(
        `S3 auto-delete requires provider.s3.cleanupRoleArn. ` +
          `Set storage.s3.<bucket>.autoDeleteObjects=false or provide provider.s3.cleanupRoleArn.`,
      );
    }
  },

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(S3_CONFIG);
    if (!config) return;

    for (const [name, bucket] of Object.entries(config.buckets)) {
      const autoDeleteObjects = bucket.autoDeleteObjects ?? false;
      const bucketResource = new s3.Bucket(ctx.stack, `Bucket${name}`, {
        bucketName: withStageName(name.toLowerCase(), ctx.model.provider.stage),
        versioned: bucket.versioned ?? false,
        removalPolicy: autoDeleteObjects
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
        autoDeleteObjects,
      });
      ctx.refs[name] = bucketResource;
      ctx.availableOutputs.set(`${name}BucketArn`, bucketResource.bucketArn);
      ctx.availableOutputs.set(`${name}BucketName`, bucketResource.bucketName);
    }
  },

  bind(ctx, events) {
    for (const event of events) {
      if (event.type !== "s3") continue;
      const refName = normalizeManagedResourceRef(event.bucket);
      const bucket = ctx.refs[refName];
      if (!bucket || !("addEventNotification" in bucket)) {
        throw new Error(
          `S3 event references unknown bucket "${refName}". ` +
            `Define it under storage.s3 and reference it as "<name>" or "ref:<name>".`,
        );
      }
      const s3Bucket = bucket as s3.Bucket;
      for (const eventName of event.events) {
        s3Bucket.addEventNotification(
          resolveS3EventType(eventName),
          new s3n.LambdaDestination(event.fnResource),
        );
      }
    }
  },
};

