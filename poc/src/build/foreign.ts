import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { digest } from "./stable.ts";

export type ForeignLanguage = "zig" | "rust";

export interface ForeignFunction {
  name: string;
  parameters: Array<{ name: string; foreignType: string; typeScriptType: "number" | "bigint" }>;
  result: { foreignType: string; typeScriptType: "number" | "bigint" | "void" };
}

export interface ForeignBuild {
  language: ForeignLanguage;
  sourcePath: string;
  compilerVersion: string;
  key: string;
  cacheHit: boolean;
  wasm: Uint8Array;
  functions: ForeignFunction[];
  declaration: string;
  dependencies: Array<{ path: string; digest: string }>;
}

export interface ForeignCompilerOptions {
  cacheDirectory: string;
  zig?: string;
  rustc?: string;
}

/**
 * Real Zig/Rust -> Wasm execution, with intentionally tiny source-level binding
 * extraction. It proves the tool/build boundary; a production compiler must use
 * compiler metadata rather than this deliberately small dependency scanner.
 */
export class ForeignCompiler {
  readonly cacheDirectory: string;
  readonly zig: string;
  readonly rustc: string;

  constructor(options: ForeignCompilerOptions) {
    this.cacheDirectory = resolve(options.cacheDirectory);
    this.zig = options.zig ?? "zig";
    this.rustc = options.rustc ?? "rustc";
  }

  async compile(sourcePath: string, language: ForeignLanguage): Promise<ForeignBuild> {
    const absolute = resolve(sourcePath);
    const source = await readFile(absolute, "utf8");
    const tool = language === "zig" ? this.zig : this.rustc;
    const compilerVersion = (await run(tool, language === "zig" ? ["env"] : ["--version", "--verbose"])).stdout.trim();
    const sources = await collectForeignSources(absolute, language);
    const dependencies = sources
      .filter((entry) => entry.path !== absolute)
      .map((entry) => ({ path: entry.path, digest: digest(entry.source) }));
    const functions = language === "zig" ? parseZigFunctions(source) : parseRustFunctions(source);
    if (functions.length === 0) throw new Error(`${basename(absolute)} exports no supported C/Wasm functions`);
    const key = digest({
      rule: "vibelang:foreign-wasm@1",
      language,
      compilerVersion,
      sources,
      target: language === "zig" ? "wasm32-freestanding" : "wasm32-unknown-unknown",
    });
    const wasmPath = join(this.cacheDirectory, `${key}.wasm`);
    const metadataPath = join(this.cacheDirectory, `${key}.json`);
    if (await exists(wasmPath) && await exists(metadataPath)) {
      return {
        language, sourcePath: absolute, compilerVersion, key, cacheHit: true,
        wasm: new Uint8Array(await readFile(wasmPath)), functions,
        declaration: declarationFor(functions), dependencies,
      };
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), "vibelang-foreign-"));
    const temporaryWasm = join(temporaryDirectory, "module.wasm");
    try {
      const args = language === "zig"
        ? ["build-exe", absolute, "-target", "wasm32-freestanding", "-fno-entry", "-rdynamic", "-O", "ReleaseSmall", `-femit-bin=${temporaryWasm}`]
        : ["--crate-type=cdylib", "--target", "wasm32-unknown-unknown", "-O", absolute, "-o", temporaryWasm];
      await run(tool, args);
      const wasm = new Uint8Array(await readFile(temporaryWasm));
      const actualExports = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).filter((entry) => entry.kind === "function").map((entry) => entry.name);
      for (const fn of functions) {
        if (!actualExports.includes(fn.name)) throw new Error(`compiler did not export ${fn.name}; actual: ${actualExports.join(", ")}`);
      }
      await mkdir(this.cacheDirectory, { recursive: true });
      await writeAtomic(wasmPath, wasm);
      await writeAtomic(metadataPath, `${JSON.stringify({ language, compilerVersion, functions }, null, 2)}\n`);
      return { language, sourcePath: absolute, compilerVersion, key, cacheHit: false, wasm, functions, declaration: declarationFor(functions), dependencies };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function collectForeignSources(
  entry: string,
  language: ForeignLanguage,
  seen = new Set<string>(),
): Promise<Array<{ path: string; source: string }>> {
  const absolute = resolve(entry);
  if (seen.has(absolute)) return [];
  seen.add(absolute);
  const source = await readFile(absolute, "utf8");
  const output = [{ path: absolute, source }];
  const children = new Set<string>();
  if (language === "zig") {
    for (const match of source.matchAll(/@import\(\s*["']([^"']+\.zig)["']\s*\)/g)) {
      children.add(resolve(dirname(absolute), match[1]!));
    }
  } else {
    for (const match of source.matchAll(/(?:^|\n)\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/g)) {
      const flat = resolve(dirname(absolute), `${match[1]}.rs`);
      const nested = resolve(dirname(absolute), match[1]!, "mod.rs");
      children.add(await exists(flat) ? flat : nested);
    }
    for (const match of source.matchAll(/(?:include|include_str|include_bytes)!\(\s*["']([^"']+)["']\s*\)/g)) {
      children.add(resolve(dirname(absolute), match[1]!));
    }
    for (const match of source.matchAll(/#\s*\[\s*path\s*=\s*["']([^"']+)["']\s*\]\s*(?:pub\s+)?mod\s+\w+\s*;/g)) {
      children.add(resolve(dirname(absolute), match[1]!));
    }
  }
  for (const child of [...children].sort()) {
    output.push(...await collectForeignSources(child, language, seen));
  }
  return output;
}

export async function instantiateForeign(build: ForeignBuild): Promise<Record<string, (...args: never[]) => unknown>> {
  const result = await WebAssembly.instantiate(build.wasm, {});
  return result.instance.exports as unknown as Record<string, (...args: never[]) => unknown>;
}

function parseZigFunctions(source: string): ForeignFunction[] {
  const output: ForeignFunction[] = [];
  for (const match of source.matchAll(/\bexport\s+fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([A-Za-z_]\w*)\s*\{/g)) {
    output.push({ name: match[1], parameters: parseParameters(match[2], ":"), result: foreignResult(match[3]) });
  }
  return output;
}

function parseRustFunctions(source: string): ForeignFunction[] {
  const output: ForeignFunction[] = [];
  for (const match of source.matchAll(/\bpub\s+extern\s+"C"\s+fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([A-Za-z_]\w*))?/g)) {
    output.push({ name: match[1], parameters: parseParameters(match[2], ":"), result: foreignResult(match[3] ?? "void") });
  }
  return output;
}

function parseParameters(source: string, separator: string): ForeignFunction["parameters"] {
  if (!source.trim()) return [];
  return source.split(",").map((parameter) => {
    const [name, rawType] = parameter.split(separator).map((part) => part.trim());
    if (!name || !rawType) throw new Error(`unsupported foreign parameter: ${parameter}`);
    const result = foreignResult(rawType);
    if (result.typeScriptType === "void") throw new Error(`void parameter: ${parameter}`);
    return { name, foreignType: rawType, typeScriptType: result.typeScriptType };
  });
}

function foreignResult(type: string): ForeignFunction["result"] {
  if (type === "void" || type === "()") return { foreignType: type, typeScriptType: "void" };
  if (["i64", "u64"].includes(type)) return { foreignType: type, typeScriptType: "bigint" };
  // Both POC foreign targets are wasm32, so pointer-sized integers are i32.
  if (["i8", "u8", "i16", "u16", "i32", "u32", "isize", "usize", "f32", "f64"].includes(type)) {
    return { foreignType: type, typeScriptType: "number" };
  }
  throw new Error(`foreign type '${type}' needs an explicit ABI codec`);
}

function declarationFor(functions: readonly ForeignFunction[]): string {
  return functions.map((fn) =>
    `export declare function ${fn.name}(${fn.parameters.map((parameter) => `${parameter.name}: ${parameter.typeScriptType}`).join(", ")}): ${fn.result.typeScriptType};`,
  ).join("\n") + "\n";
}

async function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const process = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed (${exitCode})\n${stderr}`);
  return { stdout, stderr };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}
