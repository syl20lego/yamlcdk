import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { BuildProvider } from "./contracts.js";
import { splitHandler } from "./shared.js";

function runExternalBuild(
  functionName: string,
  command: string,
  sourceHandler: string,
  cwd: string,
  commandCwd?: string,
  handlerOverride?: string,
): {
  assetPath: string;
  handler: string;
} {
  const result = spawnSync(command, {
    cwd: commandCwd ? path.resolve(cwd, commandCwd) : cwd,
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `External build failed for function "${functionName}".\nCommand: ${command}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  const effectiveHandler = handlerOverride ?? sourceHandler;
  const { modulePath, exportName } = splitHandler(effectiveHandler);
  const absModulePath = path.resolve(cwd, modulePath);
  const assetPath = path.dirname(absModulePath);
  if (!fs.existsSync(`${absModulePath}.js`) && !fs.existsSync(absModulePath)) {
    throw new Error(
      `External build output for "${functionName}" not found at ${absModulePath}(.js).`,
    );
  }

  return {
    assetPath,
    handler: `${path.basename(modulePath)}.${exportName}`,
  };
}

export const externalBuildProvider: BuildProvider = {
  mode: "external",
  build({ functionName, fn }, context) {
    const command = fn.build?.command;
    if (!command) {
      throw new Error(
        `Function "${functionName}" build.mode=external requires build.command.`,
      );
    }
    return runExternalBuild(
      functionName,
      command,
      fn.handler,
      context.cwd,
      fn.build?.cwd,
      fn.build?.handler,
    );
  },
};
