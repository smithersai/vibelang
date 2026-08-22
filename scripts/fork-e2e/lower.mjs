/**
 * Bun-invoked lowering exporter for `scripts/fork-e2e.mjs`.
 *
 * The JS POC frontend lives in TypeScript sources under `poc/src/language`;
 * this process is the only place that imports it, so the Node driver never
 * needs a TypeScript loader and never reaches past the documented public API
 * (`compileProject` from `poc/src/language/index.ts`).
 *
 * Protocol: one JSON request object on stdin, one JSON response object on
 * stdout. Everything else this process prints goes to stderr.
 *
 * Request:
 *   {
 *     rootDir: string,               // virtual project root of the authored files
 *     outDir: string,                // virtual output root used for import rewriting
 *     runtimeImport: string,         // specifier for the generated runtime helper import
 *     sources: [{ fileName, source }],        // authored `.vibe` modules
 *     typeScriptSources: [{ fileName, source }] // checker-visible foreign `.ts` modules
 *   }
 *
 * Response:
 *   { ok: true, files: { [fileName]: { code, sourceMap, outputFileName } }, diagnostics: [...] }
 *   { ok: false, error: string }
 */

import { compileProject } from "../../poc/src/language/index.ts";

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function outputNameFor(outDir, fileName) {
  return `${outDir}/${fileName.replace(/\.ts$/, ".js")}`;
}

async function main() {
  const request = JSON.parse(await readStdin());
  const typeScriptSources = request.typeScriptSources ?? [];
  const compiled = compileProject(request.sources, {
    rootDir: request.rootDir,
    outDir: request.outDir,
    runtimeImport: request.runtimeImport,
    outputExtension: ".ts",
    sourceMap: true,
    additionalRuntimeSources: typeScriptSources.map((file) => ({
      sourceFileName: file.fileName,
      source: file.source,
    })),
    // Foreign `.ts` modules are emitted next to the program by the Go bridge,
    // so their authored `./x.ts` specifiers must be rewritten to `./x.js`.
    additionalRuntimeOutputs: typeScriptSources.map((file) => ({
      sourceFileName: file.fileName,
      outputFileName: outputNameFor(request.outDir, file.fileName),
    })),
  });

  const files = {};
  for (const [fileName, file] of Object.entries(compiled.files)) {
    files[fileName] = {
      code: file.code,
      sourceMap: file.sourceMap,
      outputFileName: file.outputFileName,
    };
  }
  process.stdout.write(JSON.stringify({ ok: true, files, diagnostics: compiled.diagnostics }));
}

try {
  await main();
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? `${error.message}` : String(error) }),
  );
  process.exitCode = 1;
}
