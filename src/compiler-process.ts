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
