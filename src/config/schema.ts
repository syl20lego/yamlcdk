import { z } from "zod";

export const runtimeSchema = z.enum(["nodejs20.x", "nodejs22.x", 'nodejs24.x']);

export const iamStatementSchema = z.object({
  sid: z.string().optional(),
  effect: z.enum(["Allow", "Deny"]).optional(),
  actions: z.array(z.string()).min(1),
  resources: z.array(z.string()).min(1),
});

export const functionSchema = z.object({
  handler: z.string().min(1),
  runtime: runtimeSchema.optional(),
  timeout: z.number().int().min(1).max(900).optional(),
  memorySize: z.number().int().min(128).max(10240).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  iam: z.array(z.string()).optional(),
  build: z
    .object({
      mode: z.enum(["typescript", "external"]).optional(),
      command: z.string().min(1).optional(),
      cwd: z.string().min(1).optional(),
      handler: z.string().min(1).optional(),
    })
    .optional(),
  events: z
    .object({
      http: z
        .array(
          z.object({
            method: z.string().min(1),
            path: z.string().min(1),
          }),
        )
        .optional(),
      rest: z
        .array(
          z.object({
            method: z.string().min(1),
            path: z.string().min(1),
          }),
        )
        .optional(),
      s3: z
        .array(
          z.object({
            bucket: z.string().min(1),
            events: z.array(z.string().min(1)).min(1),
          }),
        )
        .optional(),
      sqs: z
        .array(
          z.object({
            queue: z.string().min(1),
            batchSize: z.number().int().min(1).max(10000).optional(),
          }),
        )
        .optional(),
      sns: z
        .array(
          z.object({
            topic: z.string().min(1),
          }),
        )
        .optional(),
      dynamodb: z
        .array(
          z.object({
            table: z.string().min(1),
            batchSize: z.number().int().min(1).max(10000).optional(),
            startingPosition: z.enum(["LATEST", "TRIM_HORIZON"]).optional(),
          }),
        )
        .optional(),
      eventbridge: z
        .array(
          z.union([
            z.object({ schedule: z.string().min(1) }),
            z.object({ eventPattern: z.record(z.string(), z.unknown()) }),
          ]),
        )
        .optional(),
    })
    .optional(),
  restApi: z
    .object({
      apiKeyRequired: z.boolean().optional(),
    })
    .optional(),
});

export const tableSchema = z.object({
  partitionKey: z.object({
    name: z.string().min(1),
    type: z.enum(["string", "number", "binary"]),
  }),
  sortKey: z
    .object({
      name: z.string().min(1),
      type: z.enum(["string", "number", "binary"]),
    })
    .optional(),
  billingMode: z.enum(["PAY_PER_REQUEST", "PROVISIONED"]).optional(),
  stream: z
    .enum(["NEW_IMAGE", "OLD_IMAGE", "NEW_AND_OLD_IMAGES", "KEYS_ONLY"])
    .optional(),
});

export const serviceConfigSchema = z.object({
  service: z.string().min(1),
  provider: z
    .object({
      region: z.string().optional(),
      stage: z.string().optional(),
      account: z.string().optional(),
      profile: z.string().optional(),
      stackName: z.string().optional(),
      tags: z.record(z.string(), z.string()).optional(),
      s3: z
        .object({
          cleanupRoleArn: z.string().min(1).optional(),
        })
        .optional(),
      restApi: z
        .object({
          apiKeyRequired: z.boolean().optional(),
          cloudWatchRoleArn: z.string().min(1).optional(),
        })
        .optional(),
      deployment: z
        .object({
          fileAssetsBucketName: z.string().min(1).optional(),
          imageAssetsRepositoryName: z.string().min(1).optional(),
          cloudFormationServiceRoleArn: z.string().min(1).optional(),
          cloudFormationExecutionRoleArn: z.string().min(1).optional(),
          deployRoleArn: z.string().min(1).optional(),
          qualifier: z.string().min(1).optional(),
          useCliCredentials: z.boolean().optional(),
          requireBootstrap: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  functions: z.record(z.string(), functionSchema).optional(),
  storage: z
    .object({
      s3: z
        .record(
          z.string(),
          z.object({
            versioned: z.boolean().optional(),
            autoDeleteObjects: z.boolean().optional(),
          }),
        )
        .optional(),
      dynamodb: z.record(z.string(), tableSchema).optional(),
    })
    .optional(),
  messaging: z
    .object({
      sqs: z
        .record(
          z.string(),
          z.object({
            visibilityTimeout: z.number().int().min(0).max(43200).optional(),
          }),
        )
        .optional(),
      sns: z
        .record(
          z.string(),
          z.object({
            subscriptions: z
              .array(
                z.object({
                  type: z.literal("sqs"),
                  target: z.string().min(1),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  iam: z
    .object({
      statements: z.record(z.string(), iamStatementSchema).optional(),
    })
    .optional(),
});

export const normalizedServiceConfigSchema = z.object({
  service: z.string().min(1),
  provider: z.object({
    region: z.string().min(1),
    stage: z.string().min(1),
    account: z.string().optional(),
    profile: z.string().optional(),
    stackName: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    s3: z
      .object({
        cleanupRoleArn: z.string().min(1).optional(),
      })
      .optional(),
    restApi: z
      .object({
        apiKeyRequired: z.boolean().optional(),
        cloudWatchRoleArn: z.string().min(1).optional(),
      })
      .optional(),
    deployment: z
      .object({
        fileAssetsBucketName: z.string().min(1).optional(),
        imageAssetsRepositoryName: z.string().min(1).optional(),
        cloudFormationServiceRoleArn: z.string().min(1).optional(),
        cloudFormationExecutionRoleArn: z.string().min(1).optional(),
        deployRoleArn: z.string().min(1).optional(),
        qualifier: z.string().min(1).optional(),
        useCliCredentials: z.boolean().optional(),
        requireBootstrap: z.boolean().optional(),
      })
      .optional(),
  }),
  functions: z.record(z.string(), functionSchema),
  storage: z.object({
    s3: z.record(
      z.string(),
      z.object({
        versioned: z.boolean().optional(),
        autoDeleteObjects: z.boolean().optional(),
      }),
    ),
    dynamodb: z.record(z.string(), tableSchema),
  }),
  messaging: z.object({
    sqs: z.record(
      z.string(),
      z.object({
        visibilityTimeout: z.number().int().min(0).max(43200).optional(),
      }),
    ),
    sns: z.record(
      z.string(),
      z.object({
        subscriptions: z
          .array(
            z.object({
              type: z.literal("sqs"),
              target: z.string().min(1),
            }),
          )
          .optional(),
      }),
    ),
  }),
  iam: z.object({
    statements: z.record(z.string(), iamStatementSchema),
  }),
  stackName: z.string().min(1),
});

export type RawServiceConfig = z.infer<typeof serviceConfigSchema>;
export type IamStatementConfig = z.infer<typeof iamStatementSchema>;
export type NormalizedServiceConfig = z.infer<
  typeof normalizedServiceConfigSchema
>;

export function validateServiceConfig(input: unknown): RawServiceConfig {
  const parsed = serviceConfigSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid YAML config:\n${details}`);
  }
  return parsed.data;
}
