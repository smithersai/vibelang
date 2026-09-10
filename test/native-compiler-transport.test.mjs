import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const nativeUrl = new URL("../poc/dist/compiler/native.js", import.meta.url).href;
const sandboxUrl = new URL("../poc/dist/agent/sandbox.js", import.meta.url).href;

// Keep builtin interception in a separate process. No production injection
// seam, executable forgery, or mutation of another test's process is needed.
function probe(t, source, { timeout = 30_000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-transport-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    import childProcess from "node:child_process";
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { tmpdir } from "node:os";
    import { NativeCompiler } from ${JSON.stringify(nativeUrl)};
    const compiler = new NativeCompiler({ timeoutMs: 3000 });
    ${source}
  `], { encoding: "utf8", env, timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readdirSync(directory), [], "a compiler request leaked a temporary pathname");
}

test("native requests have finite read-only stdin with exact UTF-8 bytes and private permissions", (t) => {
  probe(t, `
    const files = [{ path: "🐱.ts", text: "// 🦀\\r\\n" + " ".repeat(262144) + "export const value = 42", scriptKind: "typescript" }];
    let descriptor;
    childProcess.spawnSync = (command, args, options) => {
      assert.equal(command, compiler.executable);
      assert.deepEqual(args, ["--inspect"]);
      assert.equal(Object.hasOwn(options, "input"), false);
      [descriptor] = options.stdio;
      assert.equal(typeof descriptor, "number");
      assert.deepEqual(options.stdio.slice(1), ["pipe", "pipe"]);
      assert.equal(options.timeout, 3000);
      assert.equal(options.killSignal, "SIGKILL");
      const stat = fs.fstatSync(descriptor);
      assert.equal(stat.isFile(), true);
      if (process.platform !== "win32") {
        assert.equal(stat.mode & 0o777, 0o600);
        assert.equal(stat.nlink, 0, "source file should already be unlinked");
        assert.deepEqual(fs.readdirSync(tmpdir()), []);
      }
      assert.deepEqual(fs.readFileSync(descriptor), Buffer.from(JSON.stringify({ files }), "utf8"));
      assert.equal(fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null), 0, "stdin must reach EOF without a parent pipe writer");
      assert.throws(() => fs.writeSync(descriptor, Buffer.from("bad")));
      return { status: 0, signal: null, stdout: JSON.stringify({
        apiVersion: compiler.identity.apiVersion, compilerRevision: compiler.identity.revision,
        result: { files: [{ path: files[0].path, diagnostics: [], moduleSyntax: [] }] }
      }), stderr: "" };
    };
    syncBuiltinESMExports();
    assert.deepEqual(compiler.inspect(files).files[0].diagnostics, []);
    assert.throws(() => fs.fstatSync(descriptor), { code: "EBADF" });
  `);
});

for (const kind of ["success", "exit", "signal", "timeout", "spawn-error", "throw", "protocol"]) {
  test(`native transport closes its descriptor after ${kind}`, (t) => {
    probe(t, `
      const kind = ${JSON.stringify(kind)};
      let descriptor, calls = 0;
      childProcess.spawnSync = (_command, _args, options) => {
        calls++;
        [descriptor] = options.stdio;
        assert.equal(fs.fstatSync(descriptor).isFile(), true);
        assert.equal(fs.readFileSync(descriptor, "utf8"), JSON.stringify({ files: [] }));
        if (kind === "throw") throw new Error("synchronous spawn exception");
        return {
          status: kind === "exit" ? 3 : 0,
          signal: kind === "signal" ? "SIGKILL" : null,
          error: kind === "timeout" || kind === "spawn-error"
            ? Object.assign(new Error("simulated spawn failure"), { code: kind === "timeout" ? "ETIMEDOUT" : "ENOENT" }) : undefined,
          stdout: kind === "protocol" ? "invalid JSON" : JSON.stringify({ apiVersion: compiler.identity.apiVersion,
            compilerRevision: compiler.identity.revision, result: { files: [] } }),
          stderr: ""
        };
      };
      syncBuiltinESMExports();
      if (kind === "success") assert.deepEqual(compiler.inspect([]), { files: [] });
      else if (kind === "throw") assert.throws(() => compiler.inspect([]), /synchronous spawn exception/);
      else assert.throws(() => compiler.inspect([]), { code: kind === "timeout" ? "VIBELANG_GO_TIMEOUT"
        : kind === "protocol" ? "VIBELANG_GO_PROTOCOL" : "VIBELANG_GO_BACKEND" });
      assert.equal(calls, 1, "failed requests must not be retried");
      assert.throws(() => fs.fstatSync(descriptor), { code: "EBADF" });
    `);
  });
}

for (const operation of ["mkdtempSync", "writeFileSync", "openSync"]) {
  test(`native request preparation cleans up after ${operation} fails without spawning`, (t) => {
    probe(t, `
      const operation = ${JSON.stringify(operation)}, original = fs[operation];
      fs[operation] = (...args) => {
        if (typeof args[0] === "string" && (args[0].endsWith("stdin.json") || operation === "mkdtempSync")) {
          if (operation === "writeFileSync") original(args[0], "partial request", { flag: "wx", mode: 0o600 });
          throw Object.assign(new Error("request fixture failure"), { code: "EIO" });
        }
        return original(...args);
      };
      childProcess.spawnSync = () => assert.fail("preparation failure must not spawn or fall back");
      syncBuiltinESMExports();
      assert.throws(() => compiler.inspect([]), { code: "EIO" });
      assert.deepEqual(fs.readdirSync(tmpdir()), []);
    `);
  });
}

test("native metadata commands use closed stdin without creating request files", (t) => {
  probe(t, `
    const spawnSync = childProcess.spawnSync;
    let calls = 0;
    childProcess.spawnSync = (command, args, options) => {
      calls++;
      assert.deepEqual(args, ["--build-identity"]);
      assert.equal(Object.hasOwn(options, "input"), false);
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
      assert.deepEqual(fs.readdirSync(tmpdir()), []);
      return spawnSync(command, args, options);
    };
    syncBuiltinESMExports();
    assert.deepEqual(new NativeCompiler().identity, compiler.identity);
    assert.equal(calls, 1);
  `);
});

test("native request timeout kills a real non-reading child and releases request storage", (t) => {
  probe(t, `
    const timed = new NativeCompiler({ timeoutMs: 500 });
    const spawnSync = childProcess.spawnSync;
    let descriptor, childPid;
    childProcess.spawnSync = (_command, _args, options) => {
      [descriptor] = options.stdio;
      assert.equal(options.timeout, 500);
      const result = spawnSync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
      childPid = result.pid;
      assert.equal(result.error.code, "ETIMEDOUT");
      assert.equal(result.signal, "SIGKILL");
      return result;
    };
    syncBuiltinESMExports();
    assert.throws(() => timed.inspect([]), { code: "VIBELANG_GO_TIMEOUT" });
    assert(childPid > 0);
    assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
    assert.throws(() => fs.fstatSync(descriptor), { code: "EBADF" });
  `);
});

test("native SDK requests remain executable after real Deno sandbox completions", (t) => {
  probe(t, `
    const { DenoSubprocessSandbox } = await import(${JSON.stringify(sandboxUrl)});
    const sandbox = new DenoSubprocessSandbox({ timeoutMs: 3000 });
    const request = { operation: "derive-key", inputJson: JSON.stringify({ text: "🦀".repeat(16384) }) };
    const expected = compiler.keyedPlan(request);
    assert.equal(expected.ok, true);
    for (let round = 0; round < 40; round++) {
      const result = await sandbox.execute("export default async function () { return 42 }", {},
        { sourceDigest: "native-transport-regression", turnId: String(round) });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.result, 42);
      for (let index = 0; index < 5; index++) assert.deepEqual(compiler.keyedPlan(request), expected);
    }
    assert.deepEqual(fs.readdirSync(tmpdir()), []);
  `, { timeout: 60_000 });
});

test("large native input and output survive synchronous calls from asynchronous child completion", (t) => {
  probe(t, `
    const value = "🦀".repeat(40000);
    const source = "export default " + JSON.stringify(value);
    const request = { files: [{ path: "large.ts", text: source }], options: { target: "ES2022", module: "ES2022" } };
    for (let round = 0; round < 40; round++) {
      await new Promise((resolve, reject) => {
        const child = childProcess.spawn(process.execPath, ["-e", "process.stdout.write('done')"], { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.resume();
        child.stderr.resume();
        child.once("error", reject);
        child.once("close", (code, signal) => {
          try {
            assert.equal(code, 0);
            assert.equal(signal, null);
            // Invoke directly in the callback, then again in its Promise
            // continuation. Both calls must preserve a response over 128 KiB.
            assert.equal(compiler.transpile(request).files[0].javascript.includes(value), true);
            resolve();
          } catch (error) { reject(error); }
        });
      });
      assert.equal(compiler.transpile(request).files[0].javascript.includes(value), true);
    }
    assert.deepEqual(fs.readdirSync(tmpdir()), []);
  `, { timeout: 60_000 });
});
