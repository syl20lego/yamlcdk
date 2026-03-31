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
  const hasRoleOverrides = Boolean(
    deployment?.cloudFormationExecutionRoleArn || deployment?.deployRoleArn,
  );
  const hasCloudFormationServiceRole = Boolean(
    deployment?.cloudFormationServiceRoleArn,
  );
  const inferredUseCliCredentials = hasAssetLocationOverrides && !hasRoleOverrides;
  const useCliCredentials =
    deployment?.useCliCredentials ?? inferredUseCliCredentials;

  if (useCliCredentials && hasRoleOverrides) {
    throw new Error(
      `provider.deployment.useCliCredentials=true cannot be combined with deploy/cloudformation role overrides. Choose one mode.`,
    );
  }
  if (hasCloudFormationServiceRole && hasRoleOverrides) {
    throw new Error(
      `provider.deployment.cloudFormationServiceRoleArn cannot be combined with deployRoleArn/cloudFormationExecutionRoleArn in this mode.`,
    );
  }
}

