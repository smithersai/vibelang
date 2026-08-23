import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Resolve the platform-aware TypeScript 7 launcher shipped by the dependency. */
export function resolveTypeScriptCompiler(): string {
  const packageJson = require.resolve("typescript/package.json");
  return join(dirname(packageJson), "bin", "tsc");
}

/**
 * Run the native TypeScript CLI without parsing or normalizing its arguments.
 * This is the compatibility path used by `smithersc`.
 */
export function runTypeScriptCompiler(
  args: readonly string[],
  options: { cwd?: string | undefined } = {},
): number {
  const result = spawnSync(process.execPath, [resolveTypeScriptCompiler(), ...args], {
    cwd: options.cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.signal) {
    process.stderr.write(`smithersc: TypeScript compiler terminated by ${result.signal}\n`);
    return 1;
  }
  return result.status ?? 1;
}
