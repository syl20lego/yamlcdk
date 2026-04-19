import type {
  ActiveBuildMode,
  BuildProvider,
  BuildProviderStub,
} from "./contracts.js";
import { esbuildBuildProvider } from "./esbuild.js";
import { externalBuildProvider } from "./external.js";
import { noneBuildProvider } from "./none.js";
import { turboBuildProviderStub } from "./stubs/turbo.js";
import { viteBuildProviderStub } from "./stubs/vite.js";
import { typescriptBuildProvider } from "./typescript.js";

const ACTIVE_BUILD_PROVIDER_REGISTRY: Readonly<Record<ActiveBuildMode, BuildProvider>> = {
  typescript: typescriptBuildProvider,
  esbuild: esbuildBuildProvider,
  external: externalBuildProvider,
  none: noneBuildProvider,
};

export const FUTURE_BUILD_PROVIDER_STUBS: readonly BuildProviderStub[] = [
  viteBuildProviderStub,
  turboBuildProviderStub,
];

export function resolveActiveBuildProvider(mode: string): BuildProvider | undefined {
  return ACTIVE_BUILD_PROVIDER_REGISTRY[mode as ActiveBuildMode];
}

export function supportedBuildModes(): readonly ActiveBuildMode[] {
  return Object.keys(ACTIVE_BUILD_PROVIDER_REGISTRY) as ActiveBuildMode[];
}
