import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComptimeCompiler, compileComptimeIntrinsics } from "../../src/build/index.ts";

const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-demo-"));
const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache"), target: "node" });
const result = await compileComptimeIntrinsics({
  compiler,
  sources: {
    "demo.vibe": `
      import { comptime as buildValue } from "vibelang:comptime"
      const config = { mode: "poc", retries: 2 } as const
      export const built = buildValue(config)
    `,
  },
});

if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
console.log(result.calls[0]?.value);
console.log(result.loweredSources?.["demo.vibe"]);
