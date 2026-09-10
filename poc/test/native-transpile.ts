import { getNativeCompiler } from "../src/compiler/native.ts";

/** Erase already checked test modules through the production native emitter. */
export function nativeTestJavaScript(code: string): string {
  const emitted = getNativeCompiler().transpile({files:[{path:"test-output.ts",text:code}],
    options:{target:"es2022",module:"esnext"}}).files[0]!;
  if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error(JSON.stringify(emitted.diagnostics));
  return emitted.javascript;
}
