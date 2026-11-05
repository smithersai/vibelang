// run-seconds: 180
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js";

const source = readFileSync(new URL("./main.vibe", import.meta.url), "utf8");
const directory = mkdtempSync(join(tmpdir(), "callable-contracts-"));
const options = { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true };
function compile(name, files, extra = {}, succeeds = true) {
  writeFileSync(join(directory, name + ".json"), JSON.stringify({ compilerOptions: { ...options, ...extra }, files }));
  const result = spawnSync(process.env.VIBELANG_BINARY, ["-p", name + ".json", "--singleThreaded", "--pretty", "false"], { cwd: directory, encoding: "utf8", timeout: 60000 });
  const output = result.stdout + result.stderr;
  assert.equal(result.error, undefined, name + ": " + result.error);
  if (succeeds) assert.equal(result.status, 0, name + ": " + output);
  else {
    assert.equal(result.status, 2, name + ": " + output);
    assert.match(output, /EK0403/);
    assert.match(output, /RangeError/);
    assert.equal((output.match(/error (?:TS|EK)\d+/g) ?? []).length, 1, output);
  }
}
try {
  mkdirSync(join(directory, "node_modules"));
  symlinkSync(join(resolve(process.env.EFFECT_NODE_MODULES), "effect"), join(directory, "node_modules/effect"), "dir");
  symlinkSync(resolve(process.env.VIBELANG_RUNTIME), join(directory, "node_modules/vibelang-runtime"), "dir");
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "main.vibe"), source);
  writeFileSync(join(directory, "main.ts"), source);
  const stock = ts.createProgram([join(directory, "main.ts")], {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, types: [], noEmit: true,
  });
  assert.deepEqual(ts.getPreEmitDiagnostics(stock), [], "the TypeScript twin compiles");

  const body = `export effect function read() {
    return make()(1) + conditional()(2) + parenthesized()(3)
      + nested()()(4) + generic()(5) + holder.callback(6)
      + first(7) + second(8) + new (constructor())(9).value;
  }\n`;
  const imports = 'import { make, conditional, parenthesized, nested, generic, holder, first, second, constructor } from ';
  writeFileSync(join(directory, "native.vibe"), imports + '"./main.vibe";\n' + body);
  compile("native", ["native.vibe"], { noEmit: true });
  compile("emit", ["main.vibe"], { declaration: true, emitDeclarationOnly: true, outDir: "out" });
  const declaration = readFileSync(join(directory, "out/main.d.ts"), "utf8");
  assert.match(declaration, /Identity callback\./);
  assert.match(declaration, /Make an identity callback\./);
  writeFileSync(join(directory, "sidecar-library.d.ts"), readFileSync(join(directory, "main.d.vibe.ts")));
  for (const [name, path] of [["published", "./out/main.js"], ["sidecar", "./sidecar-library.js"]]) {
    writeFileSync(join(directory, name + ".vibe"), imports + JSON.stringify(path) + ";\n" + body);
    compile(name, [name + ".vibe"], { noEmit: true });
  }

  writeFileSync(join(directory, "foreign.d.ts"), `export declare function makeUnsafe(): {
    /** @throws {RangeError} */
    (value: number): number;
  };
  `);
  // The factory is foreign but its invocation runs in a plain native function.
  // Only the returned call has the explicit RangeError contract.
  writeFileSync(join(directory, "unsafe.vibe"), `import { makeUnsafe } from "./foreign.js";
function getUnsafe() { return makeUnsafe(); }
export effect function read() { return getUnsafe()(1); }
`);
  compile("unsafe", ["unsafe.vibe"], { noEmit: true }, false);
  console.log("callable declaration contracts survive reload");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
