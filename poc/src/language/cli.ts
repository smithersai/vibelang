#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import * as ts from "typescript-js";
import { compileVibe } from "./compile";

export function checkEmittedTypeScript(code: string, fileName: string): readonly ts.Diagnostic[] {
  const output = resolve(fileName);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const sourceFile = ts.createSourceFile(output, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(name) === output ? sourceFile : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = (name) => resolve(name) === output || fileExists(name);
  host.readFile = (name) => resolve(name) === output ? code : readFile(name);
  const program = ts.createProgram([output], options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(output));
}

function main(): void {
  const inputArgument = process.argv[2];
  if (!inputArgument || !inputArgument.endsWith(".vibe")) {
    console.error("usage: bun poc/src/language/cli.ts <input.vibe> [output.ts]");
    process.exit(2);
  }

  const input = resolve(inputArgument);
  const output = resolve(process.argv[3] ?? input.replace(/\.vibe$/, ".generated.ts"));
  const runtime = realpathSync(resolve(import.meta.dir, "../runtime/index.ts"));
  let runtimeImport = relative(canonicalDirectory(dirname(output)), runtime).split(sep).join("/");
  if (!runtimeImport.startsWith(".")) runtimeImport = `./${runtimeImport}`;

  const result = compileVibe(readFileSync(input, "utf8"), {
    runtimeImport,
    sourceName: relative(process.cwd(), input),
  });

  for (const diagnostic of result.analysis.diagnostics) {
    console.error(
      `${relative(process.cwd(), input)}:${diagnostic.line}:${diagnostic.column} ` +
        `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    );
  }

  if (result.analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    process.exit(1);
  }

  const emitDiagnostics = checkEmittedTypeScript(result.code, output)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  for (const diagnostic of emitDiagnostics) {
    const position = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
    const location = position ? `:${position.line + 1}:${position.character + 1}` : "";
    console.error(
      `${relative(process.cwd(), output)}${location} error TS${diagnostic.code}: ` +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
  }
  if (emitDiagnostics.length > 0) process.exit(1);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, result.code);
  console.log(`vibe: ${relative(process.cwd(), input)} -> ${relative(process.cwd(), output)}`);
  for (const [name, rows] of Object.entries(result.analysis.rows)) {
    console.log(
      `  ${name}: throws ${rows.failures.join(" | ") || "never"}; uses ${rows.requirements.join(" | ") || "nothing"}`,
    );
  }
}

function canonicalDirectory(path: string): string {
  let existing = path;
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...missing);
}

if (import.meta.main) main();
