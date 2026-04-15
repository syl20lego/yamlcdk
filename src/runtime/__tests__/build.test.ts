import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import { prepareFunctionBuilds } from "../build.js";

function withTmpWorkspace<T>(run: (workspaceRoot: string) => T): T {
  const workspaceRoot = fs.mkdtempSync(
    path.join(process.cwd(), "tmp-yamlcdk-build-test-"),
  );
  try {
    return run(workspaceRoot);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

beforeEach(() => {
  spawnSyncMock.mockReset();
});

describe("runtime build", () => {
  test("accepts direct emitted handler output in TypeScript mode", () => {
    withTmpWorkspace((workspaceRoot) => {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "hello.ts"),
        "export const handler = async () => ({ statusCode: 200 });\n",
        "utf8",
      );

      spawnSyncMock.mockImplementationOnce((_bin: string, args: string[]) => {
        const tsconfigPath = args[2];
        const config = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as {
          compilerOptions: { outDir: string };
          files: string[];
        };
        const emitted = path.join(config.compilerOptions.outDir, "hello.js");
        fs.mkdirSync(path.dirname(emitted), { recursive: true });
        fs.writeFileSync(emitted, "exports.handler = async () => {};\n", "utf8");
        return { status: 0, stdout: "", stderr: "" };
      });

      const builds = prepareFunctionBuilds({
        functions: {
          hello: {
            handler: `${path.relative(process.cwd(), workspaceRoot)}/src/hello.handler`,
            build: { mode: "typescript" },
          },
        },
      });

      expect(builds.hello.handler).toBe("hello.handler");
      expect(fs.existsSync(path.join(builds.hello.assetPath, "hello.js"))).toBe(true);
    });
  });

  test("derives handler path from nested emitted output", () => {
    withTmpWorkspace((workspaceRoot) => {
      fs.mkdirSync(path.join(workspaceRoot, "src", "handlers"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "handlers", "dynamo-listener.ts"),
        "export const handler = async () => ({ ok: true });\n",
        "utf8",
      );

      spawnSyncMock.mockImplementationOnce((_bin: string, args: string[]) => {
        const tsconfigPath = args[2];
        const config = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as {
          compilerOptions: { outDir: string };
          files: string[];
        };
        const sourceFile = config.files[0];
        const relativeDir = path.dirname(path.relative(workspaceRoot, sourceFile));
        const emitted = path.join(
          config.compilerOptions.outDir,
          relativeDir,
          "dynamo-listener.js",
        );
        fs.mkdirSync(path.dirname(emitted), { recursive: true });
        fs.writeFileSync(emitted, "exports.handler = async () => {};\n", "utf8");
        return { status: 0, stdout: "", stderr: "" };
      });

      const builds = prepareFunctionBuilds({
        functions: {
          emailReminderTableListener: {
            handler: `${path.relative(process.cwd(), workspaceRoot)}/src/handlers/dynamo-listener.handler`,
            build: { mode: "typescript" },
          },
        },
      });

      expect(builds.emailReminderTableListener.handler).toBe(
        "src/handlers/dynamo-listener.handler",
      );
      expect(
        fs.existsSync(
          path.join(
            builds.emailReminderTableListener.assetPath,
            "src",
            "handlers",
            "dynamo-listener.js",
          ),
        ),
      ).toBe(true);
    });
  });
});
