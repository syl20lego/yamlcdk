/** Minimal provider shape needed for deployment mode validation. */
interface DeploymentValidationInput {
  readonly provider: {
    readonly deployment?: {
      readonly fileAssetsBucketName?: string;
      readonly imageAssetsRepositoryName?: string;
      readonly cloudFormationServiceRoleArn?: string;
      readonly cloudFormationExecutionRoleArn?: string;
      readonly deployRoleArn?: string;
      readonly useCliCredentials?: boolean;
    };
  };
}

export function validateDeploymentMode(config: DeploymentValidationInput): void {
  const deployment = config.provider.deployment;
  const hasAssetLocationOverrides = Boolean(
    deployment?.fileAssetsBucketName || deployment?.imageAssetsRepositoryName,
  );
  const hasDeployRoleOverride = Boolean(deployment?.deployRoleArn);
  const hasCloudFormationExecutionRoleOverride = Boolean(
    deployment?.cloudFormationExecutionRoleArn,
  );
  const hasRoleOverrides =
    hasDeployRoleOverride || hasCloudFormationExecutionRoleOverride;
  const hasCloudFormationServiceRole = Boolean(
    deployment?.cloudFormationServiceRoleArn,
  );
  const inferredUseCliCredentials =
    hasAssetLocationOverrides && !hasDeployRoleOverride;
  const useCliCredentials =
    deployment?.useCliCredentials ?? inferredUseCliCredentials;

  if (useCliCredentials && hasDeployRoleOverride) {
    throw new Error(
      `provider.deployment.useCliCredentials=true cannot be combined with deployRoleArn. ` +
        `Use either CLI credentials, or a deploy role. ` +
        `cloudFormationExecutionRoleArn is still allowed in CLI-credentials mode.`,
    );
  }
  if (hasCloudFormationServiceRole && hasRoleOverrides) {
    throw new Error(
      `provider.deployment.cloudFormationServiceRoleArn cannot be combined with deployRoleArn/cloudFormationExecutionRoleArn in this mode.`,
    );
  }
}
