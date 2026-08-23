import { afterAll, expect, test } from "bun:test";
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ForeignBuild, ForeignCompiler, instantiateForeign } from "./foreign.ts";

const temporary = await mkdtemp(join(tmpdir(), "smithers-foreign-test-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));

test("Zig and Rust imports become cached typed Wasm modules", async () => {
  const compiler = new ForeignCompiler({ cacheDirectory: temporary });
  const examples = join(import.meta.dir, "../../examples/polyglot");
  const zig = await compiler.compile(join(examples, "math.zig"), "zig");
  const rust = await compiler.compile(join(examples, "math.rs"), "rust");
  const zigAgain = await compiler.compile(join(examples, "math.zig"), "zig");
  const independentZig = await new ForeignCompiler({ cacheDirectory: join(temporary, "independent") })
    .compile(join(examples, "math.zig"), "zig");
  const zigExports = await instantiateForeign(zig);
  const rustExports = await instantiateForeign(rust);

  expect(zig.declaration).toContain("add(left: number, right: number): number");
  expect(rust.declaration).toContain("multiply(left: number, right: number): number");
  expect(zigExports.add(20 as never, 22 as never)).toBe(42);
  expect(rustExports.multiply(6 as never, 7 as never)).toBe(42);
  expect(zigAgain.cacheHit).toBe(true);
  expect(zigAgain.key).toBe(zig.key);
  expect(independentZig.key).toBe(zig.key);
  expect(independentZig.wasm).toEqual(zig.wasm);
}, 120_000);

test("foreign dependency contents invalidate the graph key", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-deps-"));
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
}, 60_000);

test("foreign compilers consume the exact tracked source snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-snapshot-"));
  // Every started compile must settle inside this test even when an assertion
  // throws first: an abandoned compile's rejection would otherwise surface as
  // an unhandled error inside whichever test runs next.
  const started: Array<Promise<unknown>> = [];
  try {
    const marker = join(root, "compiler-started");
    const tool = join(root, "delayed-zig");
    await writeFile(tool, `#!/usr/bin/env node
      const { spawnSync } = require("node:child_process")
      const fs = require("node:fs")
      if (process.argv[2] === "version") { console.log("snapshot-zig-1"); process.exit(0) }
      fs.writeFileSync(${JSON.stringify(marker)}, "started")
      setTimeout(() => {
        const result = spawnSync("zig", process.argv.slice(2), { stdio: "inherit" })
        process.exit(result.status ?? 1)
      }, 150)
    `);
    await chmod(tool, 0o755);
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 1; }\n");
    const compiler = new ForeignCompiler({ cacheDirectory: join(root, ".cache"), zig: tool });
    const pending = compiler.compile(source, "zig");
    started.push(pending.catch(() => undefined));
    let compilerStarted = false;
    for (let attempt = 0; attempt < 4_000 && !compilerStarted; attempt++) {
      try { await access(marker); compilerStarted = true; } catch { await Bun.sleep(5); }
    }
    expect(compilerStarted).toBe(true);
    await writeFile(source, "export fn value() i32 { return 2; }\n");
    const secondPending = compiler.compile(source, "zig");
    started.push(secondPending.catch(() => undefined));
    const first = await pending;
    expect((await instantiateForeign(first)).value()).toBe(1);
    const second = await secondPending;
    expect((await instantiateForeign(second)).value()).toBe(2);
    expect(second.key).not.toBe(first.key);
  } finally {
    await Promise.all(started);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("binary Rust includes and path-attributed modules are snapshotted", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-rust-snapshot-"));
  try {
    const source = join(root, "main.rs");
    await writeFile(join(root, "payload.bin"), new Uint8Array([0xff, 0x00, 0x7f]));
    await writeFile(join(root, "custom.rs"), "pub const VALUE: i32 = 41;\n");
    await writeFile(source, `
      #[path = "custom.rs"] mod custom;
      const DATA: &[u8] = include_bytes!("payload.bin");
      #[no_mangle]
      pub extern "C" fn value() -> i32 { custom::VALUE + (DATA[0] == 0xff) as i32 }
    `);
    const build = await new ForeignCompiler({ cacheDirectory: join(root, ".cache") }).compile(source, "rust");
    expect(build.dependencies.map((dependency) => dependency.path).sort()).toEqual(["custom.rs", "payload.bin"]);
    expect((await instantiateForeign(build)).value()).toBe(42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("Zig embedded files are content-keyed dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-zig-embed-"));
  try {
    const source = join(root, "main.zig");
    const payload = join(root, "payload.bin");
    await writeFile(payload, new Uint8Array([41]));
    await writeFile(source, `
      const payload = @embedFile("payload.bin");
      export fn value() i32 { return payload[0] + 1; }
    `);
    const compiler = new ForeignCompiler({ cacheDirectory: join(root, ".cache") });
    const first = await compiler.compile(source, "zig");
    expect(first.dependencies.map((dependency) => dependency.path)).toEqual(["payload.bin"]);
    expect((await instantiateForeign(first)).value()).toBe(42);
    await writeFile(payload, new Uint8Array([40]));
    const second = await compiler.compile(source, "zig");
    expect(second.key).not.toBe(first.key);
    expect((await instantiateForeign(second)).value()).toBe(41);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("foreign source graphs enforce root authority and file-count bounds before tool execution", async () => {
  const parent = await mkdtemp(join(tmpdir(), "smithers-foreign-authority-"));
  try {
    const root = join(parent, "root");
    await mkdir(root);
    await writeFile(join(root, "main.rs"), '#[path = "../outside.rs"] mod outside;\n#[no_mangle]\npub extern "C" fn value() -> i32 { outside::VALUE }\n');
    await writeFile(join(parent, "outside.rs"), "pub const VALUE: i32 = 42;\n");
    await expect(new ForeignCompiler({ cacheDirectory: join(parent, ".cache") }).compile(join(root, "main.rs"), "rust"))
      .rejects.toThrow("escapes configured source root");

    await writeFile(join(root, "main.rs"), 'mod dependency;\n#[no_mangle]\npub extern "C" fn value() -> i32 { dependency::VALUE }\n');
    await writeFile(join(root, "dependency.rs"), "pub const VALUE: i32 = 42;\n");
    await expect(new ForeignCompiler({
      cacheDirectory: join(parent, ".cache"),
      maxSourceFiles: 1,
    }).compile(join(root, "main.rs"), "rust")).rejects.toThrow("exceeds 1 files");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("foreign keys include the sanitized explicit environment and executable content identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-tool-identity-"));
  try {
    const makeTool = async (name: string, flavor: string): Promise<string> => {
      const tool = join(root, name);
      await writeFile(tool, `#!/usr/bin/env node
        const { spawnSync } = require("node:child_process")
        const flavor = ${JSON.stringify(flavor)}
        if (process.env.HOME !== undefined) { console.error("ambient HOME leaked"); process.exit(91) }
        if (!process.env.SMITHERS_TEST_MODE) { console.error("explicit environment missing"); process.exit(92) }
        if (process.argv[2] === "version") { console.log("identity-zig-1"); process.exit(0) }
        const result = spawnSync("zig", process.argv.slice(2), { stdio: "inherit", env: process.env })
        if (!flavor) process.exit(93)
        process.exit(result.status ?? 1)
      `);
      await chmod(tool, 0o755);
      return tool;
    };
    const firstTool = await makeTool("zig-one", "one");
    const secondTool = await makeTool("zig-two", "two");
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 42; }\n");
    const first = await new ForeignCompiler({
      cacheDirectory: join(root, ".cache"), zig: firstTool, environment: { SMITHERS_TEST_MODE: "one" },
    }).compile(source, "zig");
    const environmentChanged = await new ForeignCompiler({
      cacheDirectory: join(root, ".cache"), zig: firstTool, environment: { SMITHERS_TEST_MODE: "two" },
    }).compile(source, "zig");
    const toolChanged = await new ForeignCompiler({
      cacheDirectory: join(root, ".cache"), zig: secondTool, environment: { SMITHERS_TEST_MODE: "one" },
    }).compile(source, "zig");
    expect(environmentChanged.key).not.toBe(first.key);
    expect(toolChanged.key).not.toBe(first.key);
    expect((await instantiateForeign(toolChanged)).value()).toBe(42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test.skipIf(process.platform === "win32")("foreign cache objects cannot be symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-cache-link-"));
  try {
    const cache = join(root, ".cache");
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 42; }\n");
    const compiler = new ForeignCompiler({ cacheDirectory: cache, maxCacheMetadataBytes: 1024 });
    const first = await compiler.compile(source, "zig");
    const outside = join(root, "outside-metadata");
    const poison = "x".repeat(2048);
    await writeFile(outside, poison);
    await rm(join(cache, `${first.key}.json`));
    await symlink(outside, join(cache, `${first.key}.json`));
    const rebuilt = await compiler.compile(source, "zig");
    expect(rebuilt.cacheHit).toBe(false);
    expect(await readFile(outside, "utf8")).toBe(poison);
    expect((await lstat(join(cache, `${first.key}.json`))).isSymbolicLink()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("foreign artifacts are size-bounded before loading", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-artifact-limit-"));
  try {
    const tool = join(root, "large-zig");
    await writeFile(tool, `#!/usr/bin/env node
      const fs = require("node:fs")
      if (process.argv[2] === "version") { console.log("large-zig-1"); process.exit(0) }
      const output = process.argv.find((arg) => arg.startsWith("-femit-bin="))?.slice(11)
      fs.writeFileSync(output, Buffer.alloc(2048))
    `);
    await chmod(tool, 0o755);
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 1; }\n");
    await expect(new ForeignCompiler({
      cacheDirectory: join(root, ".cache"), zig: tool, maxArtifactBytes: 1024,
    }).compile(source, "zig")).rejects.toThrow("exceeds 1024 bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("unsupported foreign languages are rejected before any tool or filesystem work", async () => {
  const compiler = new ForeignCompiler({ cacheDirectory: join(temporary, "language-check") });
  await expect(compiler.compile(join(temporary, "does-not-exist.c"), "c" as never))
    .rejects.toThrow("unsupported foreign language");
});

test("sources outside an explicit source root are rejected and sources inside it compile", async () => {
  const parent = await mkdtemp(join(tmpdir(), "smithers-foreign-explicit-root-"));
  try {
    const authorized = join(parent, "authorized");
    const foreign = join(parent, "elsewhere");
    await mkdir(authorized);
    await mkdir(foreign);
    await writeFile(join(foreign, "main.zig"), "export fn value() i32 { return 42; }\n");
    await writeFile(join(authorized, "main.zig"), "export fn value() i32 { return 42; }\n");
    const compiler = new ForeignCompiler({ cacheDirectory: join(parent, ".cache"), sourceRoot: authorized });
    await expect(compiler.compile(join(foreign, "main.zig"), "zig")).rejects.toThrow("escapes configured source root");
    const build = await compiler.compile(join(authorized, "main.zig"), "zig");
    expect((await instantiateForeign(build)).value()).toBe(42);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}, 60_000);

test("foreign sources may not be read out of the compiler cache directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-cache-read-"));
  try {
    const cache = join(root, ".cache");
    await mkdir(cache);
    await writeFile(join(cache, "main.zig"), "export fn value() i32 { return 1; }\n");
    await expect(new ForeignCompiler({ cacheDirectory: cache }).compile(join(cache, "main.zig"), "zig"))
      .rejects.toThrow("cannot read compiler cache path");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("symlinked dependencies that escape the source root are rejected", async () => {
  const parent = await mkdtemp(join(tmpdir(), "smithers-foreign-symlink-dep-"));
  try {
    const root = join(parent, "root");
    await mkdir(root);
    await writeFile(join(parent, "secret.bin"), new Uint8Array([42]));
    await symlink(join(parent, "secret.bin"), join(root, "data.bin"));
    await writeFile(join(root, "main.zig"), `
      const payload = @embedFile("data.bin");
      export fn value() i32 { return payload[0]; }
    `);
    await expect(new ForeignCompiler({ cacheDirectory: join(parent, ".cache") }).compile(join(root, "main.zig"), "zig"))
      .rejects.toThrow("escapes configured source root");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("hard-link aliased sources inside one graph are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-hard-link-"));
  try {
    await writeFile(join(root, "a.rs"), "pub const VALUE: i32 = 21;\n");
    await link(join(root, "a.rs"), join(root, "b.rs"));
    await writeFile(
      join(root, "main.rs"),
      'mod a;\nmod b;\n#[no_mangle]\npub extern "C" fn value() -> i32 { a::VALUE + b::VALUE }\n',
    );
    await expect(new ForeignCompiler({ cacheDirectory: join(root, ".cache") }).compile(join(root, "main.rs"), "rust"))
      .rejects.toThrow("aliases one file through hard links");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("oversized cache metadata is never consumed and the cache self-heals", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-metadata-limit-"));
  try {
    const cache = join(root, ".cache");
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 42; }\n");
    const compiler = new ForeignCompiler({ cacheDirectory: cache, maxCacheMetadataBytes: 1024 });
    const first = await compiler.compile(source, "zig");
    await writeFile(join(cache, `${first.key}.json`), "x".repeat(4096));
    const rebuilt = await compiler.compile(source, "zig");
    expect(rebuilt.cacheHit).toBe(false);
    expect((await instantiateForeign(rebuilt)).value()).toBe(42);
    const healed = await compiler.compile(source, "zig");
    expect(healed.cacheHit).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

test("foreign tools above the configured byte limit are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-tool-limit-"));
  try {
    const tool = join(root, "fat-zig");
    await writeFile(tool, `#!/usr/bin/env node\n// ${"padding ".repeat(512)}\nconsole.log("fat-zig-1")\n`);
    await chmod(tool, 0o755);
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 1; }\n");
    await expect(new ForeignCompiler({ cacheDirectory: join(root, ".cache"), zig: tool, maxToolBytes: 1024 })
      .compile(source, "zig")).rejects.toThrow("exceeds 1024 bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("foreign tool modification between resolution and completion is detected", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-tool-drift-"));
  try {
    const tool = join(root, "drifting-zig");
    await writeFile(tool, `#!/usr/bin/env node
      const fs = require("node:fs")
      if (process.argv[2] === "version") { console.log("drifting-zig-1"); process.exit(0) }
      fs.appendFileSync(__filename, "\\n// drift\\n")
      process.exit(0)
    `);
    await chmod(tool, 0o755);
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 1; }\n");
    await expect(new ForeignCompiler({ cacheDirectory: join(root, ".cache"), zig: tool }).compile(source, "zig"))
      .rejects.toThrow("changed during build");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("returned foreign builds are isolated clones that cannot corrupt the cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-clone-"));
  try {
    const source = join(root, "main.zig");
    await writeFile(source, "export fn add(left: i32, right: i32) i32 { return left + right; }\n");
    const compiler = new ForeignCompiler({ cacheDirectory: join(root, ".cache") });
    // allSettled joins both concurrent compiles even when one rejects, so no
    // in-flight promise can outlive the test.
    const settled = await Promise.allSettled([compiler.compile(source, "zig"), compiler.compile(source, "zig")]);
    for (const entry of settled) {
      if (entry.status === "rejected") throw entry.reason;
    }
    const [first, second] = settled.map((entry) => (entry as PromiseFulfilledResult<ForeignBuild>).value) as
      [ForeignBuild, ForeignBuild];
    first.wasm.fill(0);
    first.functions[0]!.name = "corrupted";
    first.functions[0]!.parameters[0]!.name = "corrupted";
    first.functions[0]!.result.typeScriptType = "void";
    expect(second.functions[0]!.name).toBe("add");
    expect(second.functions[0]!.parameters[0]!.name).toBe("left");
    expect((await instantiateForeign(second)).add(20 as never, 22 as never)).toBe(42);
    const third = await compiler.compile(source, "zig");
    expect(third.cacheHit).toBe(true);
    expect(third.functions[0]!.name).toBe("add");
    expect(third.declaration).toContain("add(left: number, right: number): number");
    expect((await instantiateForeign(third)).add(20 as never, 22 as never)).toBe(42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

test("partial or corrupted cache objects are ordinary misses", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-partial-cache-"));
  try {
    const cache = join(root, ".cache");
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 42; }\n");
    const compiler = new ForeignCompiler({ cacheDirectory: cache });
    const first = await compiler.compile(source, "zig");
    await rm(join(cache, `${first.key}.wasm`));
    const rebuilt = await compiler.compile(source, "zig");
    expect(rebuilt.cacheHit).toBe(false);
    await writeFile(join(cache, `${first.key}.wasm`), new Uint8Array([1, 2, 3, 4]));
    const repaired = await compiler.compile(source, "zig");
    expect(repaired.cacheHit).toBe(false);
    expect((await instantiateForeign(repaired)).value()).toBe(42);
    const hit = await compiler.compile(source, "zig");
    expect(hit.cacheHit).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test.skipIf(process.platform === "win32")("cache paths are canonical and ambient variables stay out of the key", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-canonical-cache-"));
  try {
    const real = join(root, "real");
    await mkdir(real);
    await symlink(real, join(root, "link"));
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 42; }\n");
    process.env.SMITHERS_AMBIENT_NOISE = "one";
    const linked = new ForeignCompiler({ cacheDirectory: join(root, "link", "cache") });
    process.env.SMITHERS_AMBIENT_NOISE = "two";
    const direct = new ForeignCompiler({ cacheDirectory: join(real, "cache") });
    expect(linked.cacheDirectory).toBe(direct.cacheDirectory);
    const built = await linked.compile(source, "zig");
    const hit = await direct.compile(source, "zig");
    expect(hit.cacheHit).toBe(true);
    expect(hit.key).toBe(built.key);
  } finally {
    delete process.env.SMITHERS_AMBIENT_NOISE;
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("foreign tool processes are killed at the configured deadline", async () => {
  const root = await mkdtemp(join(tmpdir(), "smithers-foreign-timeout-"));
  try {
    const tool = join(root, "fake-zig");
    const survivor = join(root, "survivor");
    await writeFile(tool, `#!/usr/bin/env node
      if (process.argv[2] === "version") { console.log("fake-zig-1"); process.exit(0) }
      require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(
        `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify("SURVIVOR_PATH")}, "alive"), 150)`,
      )}.replace("SURVIVOR_PATH", ${JSON.stringify(survivor)})], { stdio: "ignore" })
      setInterval(() => {}, 1000)
    `);
    await chmod(tool, 0o755);
    const source = join(root, "main.zig");
    await writeFile(source, "export fn value() i32 { return 1; }\n");
    const compiler = new ForeignCompiler({
      cacheDirectory: join(root, ".cache"),
      zig: tool,
      timeoutMs: 50,
    });
    await expect(compiler.compile(source, "zig")).rejects.toThrow("timed out");
    await Bun.sleep(250);
    await expect(access(survivor)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
