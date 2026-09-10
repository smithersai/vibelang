import { spawnSync } from "node:child_process";
import { NativeCompiler } from "./compiler.js";

/** Resolve and authenticate the same pinned Go executable the language uses. */
export function resolveTypeScriptCompiler(): string {
  // A fresh binding revalidates the executable digest immediately before each
  // CLI invocation, including an explicitly configured toolchain override.
  return new NativeCompiler().executable;
}

/**
 * Run the native TypeScript CLI without parsing or normalizing its arguments.
 * This is the compatibility path used by `vibec`.
 */
export function runTypeScriptCompiler(
  args: readonly string[],
  options: { cwd?: string | undefined } = {},
): number {
  const result = spawnSync(resolveTypeScriptCompiler(), ["--typescript", ...args], {
    cwd: options.cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.signal) {
    process.stderr.write(`vibec: TypeScript compiler terminated by ${result.signal}\n`);
    return 1;
  }
  return result.status ?? 1;
}

export interface CapturedTypeScriptRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the native TypeScript CLI and capture its output instead of inheriting
 * the terminal. Project mode uses this to type-check the TypeScript roots of a
 * mixed project and fold the compiler's findings into the structured report,
 * so `--format json` stays a single envelope.
 */
export function captureTypeScriptCompiler(
  args: readonly string[],
  options: { cwd?: string | undefined } = {},
): CapturedTypeScriptRun {
  const result = spawnSync(resolveTypeScriptCompiler(), ["--typescript", ...args], {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.signal ? 1 : (result.status ?? 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
