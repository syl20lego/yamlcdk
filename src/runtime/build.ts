import type {
  BuildableConfig,
  BuildProvider,
  BuildProviderContext,
  BuildResult,
} from "./builders/contracts.js";
import { resolveActiveBuildProvider, supportedBuildModes } from "./builders/registry.js";

export type {
  ActiveBuildMode,
  BuildableConfig,
  BuildableFunctionConfig,
  BuildProvider,
  BuildProviderStub,
  BuildResult,
  EsbuildBuildConfig,
  EsbuildSourcemapOption,
  EsbuildTargetOption,
} from "./builders/contracts.js";
export { FUTURE_BUILD_PROVIDER_STUBS } from "./builders/registry.js";

export interface PrepareFunctionBuildsOptions {
  /** When true, return inline stubs instead of compiling real handlers. */
  readonly stub?: boolean;
}

const STUB_INLINE_CODE =
  "exports.handler = async () => ({ statusCode: 200, body: 'validation' });";

function resolveBuildProvider(
  mode: string,
  functionName: string,
): BuildProvider {
  const provider = resolveActiveBuildProvider(mode);
  if (provider) return provider;

  const supportedModes = supportedBuildModes().join(", ");
  throw new Error(
    `Function "${functionName}" uses unsupported build.mode "${mode}". ` +
      `Supported modes: ${supportedModes}.`,
  );
}

export function prepareFunctionBuilds(
  config: BuildableConfig,
  options?: PrepareFunctionBuildsOptions,
): Record<string, BuildResult> {
  if (options?.stub) {
    const output: Record<string, BuildResult> = {};
    for (const name of Object.keys(config.functions)) {
      output[name] = { assetPath: "", handler: "index.handler", inline: STUB_INLINE_CODE };
    }
    return output;
  }

  const context: BuildProviderContext = {
    cwd: process.cwd(),
  };
  const output: Record<string, BuildResult> = {};
  for (const [functionName, fn] of Object.entries(config.functions)) {
    const mode = fn.build?.mode ?? "typescript";
    const provider = resolveBuildProvider(mode, functionName);
    output[functionName] = provider.build({ functionName, fn }, context);
  }
  return output;
}
