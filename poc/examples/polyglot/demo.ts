import { join } from "node:path";
import { ForeignCompiler, instantiateForeign } from "../../src/build/index.ts";

const compiler = new ForeignCompiler({ cacheDirectory: join(import.meta.dir, ".demo-cache") });
const zig = await compiler.compile(join(import.meta.dir, "math.zig"), "zig");
const rust = await compiler.compile(join(import.meta.dir, "math.rs"), "rust");
const zigExports = await instantiateForeign(zig);
const rustExports = await instantiateForeign(rust);

console.log(JSON.stringify({
  zig: {
    key: zig.key.slice(0, 12),
    cacheHit: zig.cacheHit,
    declaration: zig.declaration.trim().split("\n"),
    add: zigExports.add(20 as never, 22 as never),
    fibonacci: zigExports.fibonacci(10 as never),
  },
  rust: {
    key: rust.key.slice(0, 12),
    cacheHit: rust.cacheHit,
    declaration: rust.declaration.trim(),
    multiply: rustExports.multiply(6 as never, 7 as never),
  },
}, null, 2));

