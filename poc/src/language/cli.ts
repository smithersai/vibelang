#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { compileVibe } from "./compile.ts";
import { checkEmittedTypeScript } from "./validate.ts";
export { checkEmittedTypeScript } from "./validate.ts";

export function main(): void {
  const inputArgument = process.argv[2];
  if (!inputArgument || !inputArgument.endsWith(".vibe")) {
    console.error("usage: vibe <input.vibe> [output.ts]");
    process.exit(2);
  }

  const input = resolve(inputArgument);
  const output = resolve(process.argv[3] ?? input.replace(/\.vibe$/, ".generated.ts"));
  const canonicalOutput = resolve(canonicalDirectory(dirname(output)), basename(output));
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDirectory = dirname(modulePath);
  const runtimeExtension = extname(modulePath) === ".js" ? ".js" : ".ts";
  const runtime = realpathSync(resolve(moduleDirectory, `../runtime/index${runtimeExtension}`));
  let runtimeImport = relative(dirname(canonicalOutput), runtime).split(sep).join("/");
  if (!runtimeImport.startsWith(".")) runtimeImport = `./${runtimeImport}`;

  const result = compileVibe(readFileSync(input, "utf8"), {
    fileName: input,
    outputFileName: canonicalOutput,
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

  const outputCode = result.sourceMap
    ? `${result.code.replace(/\s*$/, "")}\n//# sourceMappingURL=${basename(output)}.map\n`
    : result.code;
  const emitDiagnostics = checkEmittedTypeScript(outputCode, output)
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
  writeFileSync(output, outputCode);
  if (result.sourceMap) writeFileSync(`${output}.map`, result.sourceMap);
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

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) main();
