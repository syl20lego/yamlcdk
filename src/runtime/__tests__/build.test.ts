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

  test("builds handlers with esbuild mode", () => {
    withTmpWorkspace((workspaceRoot) => {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "hello.ts"),
        "export const handler = async () => ({ statusCode: 200 });\n",
        "utf8",
      );

      spawnSyncMock.mockImplementationOnce((_bin: string, args: string[]) => {
        const outArg = args.find((arg) => arg.startsWith("--outfile="));
        const outFile = outArg?.slice("--outfile=".length);
        if (!outFile) {
          throw new Error("missing outfile arg");
        }
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, "exports.handler = async () => {};\n", "utf8");
        return { status: 0, stdout: "", stderr: "" };
      });

      const builds = prepareFunctionBuilds({
        functions: {
          hello: {
            handler: `${path.relative(process.cwd(), workspaceRoot)}/src/hello.handler`,
            runtime: "nodejs22.x",
            build: { mode: "esbuild" },
          },
        },
      });

      const [bin, args] = spawnSyncMock.mock.calls[0] as [string, string[]];
      expect(bin).toContain(`${path.sep}node_modules${path.sep}.bin${path.sep}esbuild`);
      expect(args).toContain("--bundle");
      expect(args).toContain("--platform=node");
      expect(args).toContain("--format=cjs");
      expect(args).toContain("--target=node22");
      expect(builds.hello.handler).toBe("index.handler");
      expect(fs.existsSync(path.join(builds.hello.assetPath, "index.js"))).toBe(true);
    });
  });

  test("resolves esbuild from an ancestor workspace root in monorepos", () => {
    withTmpWorkspace((workspaceRoot) => {
      const appDir = path.join(workspaceRoot, "apps", "consumer-marketing");
      fs.mkdirSync(path.join(appDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, "node_modules", ".bin"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(
          workspaceRoot,
          "node_modules",
          ".bin",
          process.platform === "win32" ? "esbuild.cmd" : "esbuild",
        ),
        "echo esbuild\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(appDir, "src", "hello.ts"),
        "export const handler = async () => ({ statusCode: 200 });\n",
        "utf8",
      );

      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(appDir);
      spawnSyncMock.mockImplementationOnce((_bin: string, args: string[]) => {
        const outArg = args.find((arg) => arg.startsWith("--outfile="));
        const outFile = outArg?.slice("--outfile=".length);
        if (!outFile) {
          throw new Error("missing outfile arg");
        }
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, "exports.handler = async () => {};\n", "utf8");
        return { status: 0, stdout: "", stderr: "" };
      });

      try {
        prepareFunctionBuilds({
          functions: {
            hello: {
              handler: "src/hello.handler",
              build: { mode: "esbuild" },
            },
          },
        });
      } finally {
        cwdSpy.mockRestore();
      }

      const [bin] = spawnSyncMock.mock.calls[0] as [string, string[]];
      expect(bin).toContain(
        path.join(workspaceRoot, "node_modules", ".bin", "esbuild"),
      );
    });
  });

  test("passes custom esbuild options to the CLI", () => {
    withTmpWorkspace((workspaceRoot) => {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "worker.ts"),
        "export const main = async () => ({ ok: true });\n",
        "utf8",
      );

      spawnSyncMock.mockImplementationOnce((_bin: string, args: string[]) => {
        const outArg = args.find((arg) => arg.startsWith("--outfile="));
        const outFile = outArg?.slice("--outfile=".length);
        if (!outFile) {
          throw new Error("missing outfile arg");
        }
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, "exports.main = async () => {};\n", "utf8");
        return { status: 0, stdout: "", stderr: "" };
      });

      prepareFunctionBuilds({
        functions: {
          worker: {
            handler: `${path.relative(process.cwd(), workspaceRoot)}/src/worker.main`,
            build: {
              mode: "esbuild",
              esbuild: {
                bundle: false,
                format: "esm",
                target: ["node22", "es2022"],
                sourcemap: "inline",
                minify: true,
                external: ["aws-sdk"],
                define: {
                  "process.env.NODE_ENV": "\"production\"",
                },
                inject: ["./src/shim.ts"],
                keepNames: true,
              },
            },
          },
        },
      });

      const [, args] = spawnSyncMock.mock.calls[0] as [string, string[]];
      expect(args).toContain("--bundle=false");
      expect(args).toContain("--format=esm");
      expect(args).toContain("--target=node22,es2022");
      expect(args).toContain("--sourcemap=inline");
      expect(args).toContain("--minify");
      expect(args).toContain("--external:aws-sdk");
      expect(args).toContain('--define:process.env.NODE_ENV="production"');
      expect(args).toContain("--inject:./src/shim.ts");
      expect(args).toContain("--keep-names");
    });
  });

  test("fails with a clear error when esbuild is not installed in the project", () => {
    withTmpWorkspace((workspaceRoot) => {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "hello.ts"),
        "export const handler = async () => ({ statusCode: 200 });\n",
        "utf8",
      );

      const realExistsSync = fs.existsSync;
      const existsSyncSpy = vi.spyOn(fs, "existsSync");
      existsSyncSpy.mockImplementation((value) => {
        if (typeof value === "string") {
          const normalized = path.normalize(value);
          if (
            normalized.includes(
              `${path.sep}node_modules${path.sep}.bin${path.sep}esbuild`,
            )
          ) {
            return false;
          }
        }
        return realExistsSync(value);
      });

      try {
        expect(() =>
          prepareFunctionBuilds({
            functions: {
              hello: {
                handler: `${path.relative(process.cwd(), workspaceRoot)}/src/hello.handler`,
                build: { mode: "esbuild" },
              },
            },
          }),
        ).toThrow('build.mode=esbuild requires "esbuild" to be installed in the customer project');
      } finally {
        existsSyncSpy.mockRestore();
      }
    });
  });

  test("fails with a clear error when build.mode is unsupported", () => {
    expect(() =>
      prepareFunctionBuilds({
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: { mode: "vite" },
          },
        },
      }),
    ).toThrow('Function "hello" uses unsupported build.mode "vite"');
  });
});
