import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeTestJavaScript } from "../../test/native-transpile.ts";
import { __vsInspectResult, isPanic, type ResultType } from "../runtime/index.ts";
import { compileAndCheckVibeLang } from "./validate.ts";

// The native standalone prelude and SDK are distinct emission targets. These
// tests execute the SDK output: an Error constructor passed as Result.try's
// mapper can look plausible in emitted text while violating the runtime ABI.
const support = `/** @module @throws {never} */
export class Declined extends Error {}
/** @throws {Declined} */
export function decline(mode: number): string {
  if (mode === 1) throw new Declined("declined");
  if (mode === 2) throw new RangeError("wrong class");
  if (mode === 3) throw { name: "Declined", message: "forged" };
  return "ok";
}
/** @throws {Declined} */
export async function reject(mode: number): Promise<string> { return decline(mode) }
export const client = {
  /** @throws {never} */
  get value(): string { return "safe" }
};`;

for (const spelling of ["named", "namespace"] as const) {
  test(`native SDK foreign adapters execute with ${spelling} Error bindings`, async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-sdk-foreign-"));
    try {
      await writeFile(join(root, "foreign.ts"), support);
      const imports = spelling === "named"
        ? 'import { decline, reject, client, Declined as Failure } from "./foreign.ts";'
        : 'import * as foreign from "./foreign.ts";';
      const select = (name: string) => spelling === "named" ? name : `foreign.${name}`;
      const errorType = spelling === "named" ? "Failure" : "foreign.Declined";
      const source = `${imports}
export function read(mode: number): Result<string, ${errorType} | Panic> { return ${select("decline")}(mode)! }
export async function readAsync(mode: number): Promise<Result<string, ${errorType} | Panic>> { return (await ${select("reject")}(mode))! }
export function trusted(): string { return ${select("client")}.value }
class Mapped extends Error {}
export function mapped(): Result<string, Mapped | Panic> {
  return Result.try(() => { throw new Error("raw") }, () => new Mapped("mapped"));
}
export async function mappedAsync(): Promise<Result<string, Mapped | Panic>> {
  return await Result.tryPromise(async () => { throw new Error("raw") }, () => new Mapped("mapped async"));
}
`;
      const outputFileName = join(root, "main.mjs");
      const checked = compileAndCheckVibeLang(source, {
        rootDir: root, fileName: join(root, "main.vibe"), outputFileName,
        sourceName: `native-sdk-foreign-${spelling}.vibe`,
        runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
      });
      expect(checked.result.analysis.diagnostics).toEqual([]);
      expect(checked.emitDiagnostics).toEqual([]);
      expect(checked.ok).toBe(true);
      await writeFile(outputFileName, nativeTestJavaScript(checked.result.code));
      const emitted = await import(pathToFileURL(outputFileName).href) as {
        read(mode: number): ResultType<string, Error>;
        readAsync(mode: number): Promise<ResultType<string, Error>>;
        trusted(): string;
        mapped(): ResultType<string, Error>;
        mappedAsync(): Promise<ResultType<string, Error>>;
      };
      expect(emitted.trusted()).toBe("safe");
      for (const mode of [0, 1, 2, 3]) {
        for (const value of [emitted.read(mode), await emitted.readAsync(mode)]) {
          const state = __vsInspectResult(value);
          if (mode === 0) {
            expect(state).toEqual({ ok: true, value: "ok" });
          } else {
            expect(state.ok).toBe(false);
            if (state.ok) throw new Error("a foreign failure disappeared");
            expect(isPanic(state.error)).toBe(mode !== 1);
            if (mode === 1) expect(state.error.message).toBe("declined");
          }
        }
      }
      for (const [value, message] of [[emitted.mapped(), "mapped"], [await emitted.mappedAsync(), "mapped async"]] as const) {
        const state = __vsInspectResult(value);
        expect(state.ok).toBe(false);
        if (state.ok) throw new Error("an explicit mapper did not fail");
        expect(isPanic(state.error)).toBe(false);
        expect(state.error.message).toBe(message);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
