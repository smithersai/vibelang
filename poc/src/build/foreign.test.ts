import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForeignCompiler, instantiateForeign } from "./foreign.ts";

const temporary = await mkdtemp(join(tmpdir(), "vibelang-foreign-test-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));

test("Zig and Rust imports become cached typed Wasm modules", async () => {
  const compiler = new ForeignCompiler({ cacheDirectory: temporary });
  const examples = join(import.meta.dir, "../../examples/polyglot");
  const zig = await compiler.compile(join(examples, "math.zig"), "zig");
  const rust = await compiler.compile(join(examples, "math.rs"), "rust");
  const zigAgain = await compiler.compile(join(examples, "math.zig"), "zig");
  const zigExports = await instantiateForeign(zig);
  const rustExports = await instantiateForeign(rust);

  expect(zig.declaration).toContain("add(left: number, right: number): number");
  expect(rust.declaration).toContain("multiply(left: number, right: number): number");
  expect(zigExports.add(20 as never, 22 as never)).toBe(42);
  expect(rustExports.multiply(6 as never, 7 as never)).toBe(42);
  expect(zigAgain.cacheHit).toBe(true);
  expect(zigAgain.key).toBe(zig.key);
});

test("foreign dependency contents invalidate the graph key", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-foreign-deps-"));
  try {
    const main = join(root, "main.rs");
    const dependency = join(root, "dep.rs");
    await writeFile(main, 'mod dep;\n#[no_mangle]\npub extern "C" fn value() -> i32 { dep::VALUE }\n');
    await writeFile(dependency, "pub const VALUE: i32 = 1;\n");
    const compiler = new ForeignCompiler({ cacheDirectory: join(root, ".cache") });
    const first = await compiler.compile(main, "rust");
    await writeFile(dependency, "pub const VALUE: i32 = 2;\n");
    const second = await compiler.compile(main, "rust");
    const exports = await instantiateForeign(second);
    expect(second.key).not.toBe(first.key);
    expect(second.cacheHit).toBe(false);
    expect(second.dependencies).toHaveLength(1);
    expect(exports.value()).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
