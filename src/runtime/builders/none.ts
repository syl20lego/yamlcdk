import path from "node:path";
import type { BuildProvider } from "./contracts.js";
import { splitHandler } from "./shared.js";

export const noneBuildProvider: BuildProvider = {
  mode: "none",
  build({ fn }, context) {
    const { modulePath, exportName } = splitHandler(fn.handler);
    const absModulePath = path.resolve(context.cwd, modulePath);
    const assetPath = path.dirname(absModulePath);
    return {
      assetPath,
      handler: `${path.basename(modulePath)}.${exportName}`,
    };
  },
};
