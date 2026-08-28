/**
 * Bun-invoked lowering driver for the JS reference backend.
 *
 * The JS instrument (`poc/src/language`) is TypeScript, so it can only be
 * imported from a runtime that executes TypeScript directly. This process is
 * the only place in the conformance harness that touches it, through the
 * documented build and language APIs used below.
 *
 * Acceptance composes the compiler-owned standalone frontends first: comptime
 * over a complete project and durable source lowering for a module with a
 * `smithers:flows` edge. Smithers lowering and language/portability diagnostics
 * follow, and then — only when the program has no frontend errors — a stock
 * TypeScript check of the *emitted* module set via `checkEmittedProject`. A
 * lowering that produces TypeScript the stock checker rejects has not compiled
 * the program, and a harness that skips the last stage scores such a case by
 * omitting a check rather than by observing correct behavior.
 *
 * Protocol: one JSON request object on stdin, one JSON response object on
 * stdout. Everything else this process prints goes to stderr.
 *
 * Request:
 *   {
 *     rootDir: string,                           // also the virtual out dir
 *     comptimeCacheDirectory: string,            // unique to this staged run
 *     runtimeImport: string,                     // specifier for runtime helpers
 *     schemaRuntimeImport: string,               // specifier for derived schemas
 *     sources: [{ fileName, source }],           // authored `.sm` modules
 *     typeScriptSources: [{ fileName, source }], // foreign `.ts` modules
 *     assets: [fileName],                        // staged non-code files, names only
 *     assetCacheDirectory: string,               // unique to this staged run
 *     expectsOutput: boolean                     // the run declares `expect: "output"`
 *   }
 *
 * `expectsOutput` is the only field here that carries the case's EXPECTATION
 * rather than its program, and it is deliberately a single boolean: it must
 * never be able to change what the compilers are asked, only whether a durable
 * refusal is allowed to discard the rest of the run. See the guard at the
 * durable stage below. Absent, it reads as `false`, which is the pre-guard
 * behavior.
 *
 * Response:
 *   { ok: true, files: { [fileName]: { code, sourceMap, outputFileName } },
 *     diagnostics: [{ severity, code, message, fileName, line, column }],
 *     emitChecked: boolean,
 *     emitDiagnostics: [{ code, fileName, line, column, message }],
 *     assetsCompiled: boolean,
 *     generatedFiles: [{ fileName, code }] }     // compiler-issued asset modules
 *   { ok: false, error: string }
 *
 * `assets` carries names, never bytes: the compiler-owned source-asset pass
 * reads each file from disk beneath `rootDir` and tracks its content in the
 * cache identity, so handing it text here would measure a stub instead.
 */

import { resolve } from "node:path";
import * as ts from "typescript-js";

import {
  checkEmittedProject,
  compileProject,
  composeSourceMaps,
} from "../../poc/src/language/index.ts";
import { createOffsetSourceMap } from "../../poc/src/language/source-map.ts";
import {
  AssetCompiler,
  ComptimeCompiler,
  compileComptimeIntrinsics,
  compileSourceAssetModules,
} from "../../poc/src/build/index.ts";
import { compileDurableSource } from "../../poc/src/durable/source-compiler.ts";
import { originalPosition } from "./source-map.mjs";

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function durableCallSite(source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const directNames = new Set();
  const namespaceNames = new Set();
  const flowImports = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "smithers:flows") continue;
    flowImports.push(statement);
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if ((binding.propertyName?.text ?? binding.name.text) === "durable") directNames.add(binding.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
    }
  }
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if ((ts.isIdentifier(expression) && directNames.has(expression.text)) ||
        (ts.isPropertyAccessExpression(expression) && expression.name.text === "durable" &&
          ts.isIdentifier(expression.expression) && namespaceNames.has(expression.expression.text))) {
        calls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (calls.length !== 1) {
    throw new TypeError(`durable lowering succeeded but ${fileName} has ${calls.length} compiler-owned durable call sites`);
  }
  return { call: calls[0], flowImports };
}

function replaceDurableCall(source, fileName, flow, derivedActions) {
  const { call, flowImports } = durableCallSite(source, fileName);
  const replacements = [
    ...flowImports.map((statement) => ({ start: statement.getFullStart(), end: statement.end, text: "" })),
    // The compiler-owned Action declarations it consumed. Their contracts are
    // in the Plan and their base class disappears with the import, so they are
    // erased at exactly the ranges the compiler reported -- never at ranges the
    // harness guessed for itself.
    ...(derivedActions ?? []).map((action) => ({ start: action.start, end: action.end, text: "" })),
    { start: call.getStart(), end: call.end, text: JSON.stringify(flow) },
  ].sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = 0;
  let code = "";
  const runs = [];
  for (const replacement of replacements) {
    if (replacement.start < cursor || replacement.end < replacement.start || replacement.end > source.length) {
      throw new TypeError(`durable source replacements overlap or exceed ${fileName}`);
    }
    if (replacement.start > cursor) {
      const derivedStart = code.length;
      const kept = source.slice(cursor, replacement.start);
      code += kept;
      runs.push({ derivedStart, authoredStart: cursor, length: kept.length });
    }
    code += replacement.text;
    cursor = replacement.end;
  }
  if (cursor < source.length) {
    const derivedStart = code.length;
    const kept = source.slice(cursor);
    code += kept;
    runs.push({ derivedStart, authoredStart: cursor, length: kept.length });
  }
  return {
    code,
    sourceMap: createOffsetSourceMap({
      derivedText: code,
      authoredText: source,
      runs,
      sourceName: fileName,
      fileName: `${fileName}.durable.ts`,
    }),
  };
}

/**
 * The compiler-owned source-asset stage.
 *
 * Runs over the AUTHORED `.sm` text, exactly as `src/cli.ts` does, because that
 * is where the authored import attributes and the authored positions of every
 * `SMITHERS52xx` refusal are. The compiler reads each asset from disk beneath
 * `rootDir`; the harness has already staged them there, and passes only their
 * names so nothing here can substitute content the compiler did not read.
 *
 * Returns `undefined` when the case ships no asset, which keeps the pass an
 * exact no-op for every case that predates it.
 */
async function compileAssets(request) {
  if (!Array.isArray(request.assets) || request.assets.length === 0) return undefined;
  const compiled = await compileSourceAssetModules({
    compiler: new AssetCompiler({
      root: request.rootDir,
      cacheDirectory: request.assetCacheDirectory,
      target: request.comptimeTarget,
      options: { frontend: "smithers-conformance-js@1" },
    }),
    sources: request.sources.map((source) => ({ fileName: source.fileName, source: source.source })),
  });
  const outputs = compiled.modules.map((module) => ({
    sourceFileName: module.sourceFileName,
    outputFileName: resolve(request.rootDir, "__smithers_assets__", `${module.logicalKey}.ts`),
    resolutionAliases: module.resolutionAliases,
    stripImportAttributes: true,
  }));
  return {
    ok: compiled.ok,
    // Passed on by identity: `compileProject` only grants compiler-owned value
    // provenance to the objects the asset compiler itself issued, so spreading
    // or rebuilding them here would silently downgrade them to ordinary foreign
    // modules and the case would measure the wrong thing.
    modules: compiled.modules,
    outputs,
    diagnostics: compiled.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      fileName: diagnostic.fileName,
      line: diagnostic.line,
      column: diagnostic.column,
      mapped: true,
    })),
  };
}

async function main() {
  const request = JSON.parse(await readStdin());
  // Fail closed rather than letting an absent target reach the compilers as
  // `undefined`, where each would silently substitute its own library default.
  // The whole point of carrying the target in the payload is that one declared
  // value reaches both backends; a missing one must be loud, not defaulted.
  if (typeof request.comptimeTarget !== "string" || request.comptimeTarget.length === 0) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: "the lowering request carried no comptimeTarget" }),
    );
    return;
  }
  const typeScriptSources = request.typeScriptSources ?? [];
  const assets = await compileAssets(request);
  if (assets && !assets.ok) {
    process.stdout.write(JSON.stringify({
      ok: true,
      files: {},
      diagnostics: assets.diagnostics,
      emitChecked: false,
      emitDiagnostics: [],
      assetsCompiled: true,
      generatedFiles: [],
    }));
    return;
  }
  // The standalone comptime frontend is a whole-project pass once either
  // compiler-owned module is present. Without such an edge it must be an exact
  // no-op: in particular, syntax owned by later Smithers lowering must not be
  // reclassified as a comptime parse failure. TypeScript's lexical preprocessor
  // finds module references without attempting to parse the Smithers grammar.
  const usesComptimeFrontend = request.sources.some((source) =>
    ts.preProcessFile(source.source, true, true).importedFiles.some((reference) =>
      reference.fileName === "smithers:comptime" || reference.fileName === "smithers:schema"
    )
  );
  let comptime;
  let loweredSources = request.sources;
  if (usesComptimeFrontend) {
    comptime = await compileComptimeIntrinsics({
      compiler: new ComptimeCompiler({
        root: request.rootDir,
        cacheDirectory: request.comptimeCacheDirectory,
        target: request.comptimeTarget,
        options: { frontend: "smithers-conformance-js@1" },
      }),
      sources: Object.fromEntries(request.sources.map((source) => [source.fileName, source.source])),
      schemaRuntimeImport: request.schemaRuntimeImport,
    });
    if (!comptime.ok || !comptime.loweredFiles) {
      process.stdout.write(JSON.stringify({
        ok: true,
        files: {},
        diagnostics: comptime.diagnostics.map((diagnostic) => ({
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
          fileName: diagnostic.file,
          line: diagnostic.line,
          column: diagnostic.column,
          mapped: true,
        })),
        emitChecked: false,
        emitDiagnostics: [],
        assetsCompiled: assets !== undefined,
        generatedFiles: [],
      }));
      return;
    }
    loweredSources = request.sources.map((source) => {
      const lowered = comptime.loweredFiles[source.fileName];
      if (!lowered) throw new TypeError(`comptime lowering omitted project file '${source.fileName}'`);
      return { fileName: source.fileName, source: lowered.code };
    });
  }
  // `compileDurableSource` is intentionally a single-source, bounded pass.
  // Invoke it only for modules that lexically import its exact compiler-owned
  // module; same-spelled local functions therefore remain ordinary. Successful
  // lowering replaces the compiler-owned call with the static descriptor and
  // erases the virtual import. The offset map keeps all untouched authored text
  // precise and leaves the generated descriptor explicitly unmapped.
  const durableMaps = new Map();
  const durableDiagnostics = [];
  const durablyLoweredSources = [];
  for (const source of loweredSources) {
    const usesDurableFrontend = ts.preProcessFile(source.source, true, true).importedFiles.some(
      (reference) => reference.fileName === "smithers:flows",
    );
    if (!usesDurableFrontend) {
      durablyLoweredSources.push(source);
      continue;
    }
    // No descriptor bindings are supplied: the standalone compiler derives the
    // contracts of Actions declared in this module from its own checked
    // program. Bindings remain the way to describe Actions imported from
    // modules this single-source pass cannot see, which no corpus case uses.
    const durable = compileDurableSource(source.source, { fileName: source.fileName });
    if (!durable.ok) {
      for (const diagnostic of durable.diagnostics) {
        const comptimeMap = comptime?.loweredFiles?.[source.fileName]?.sourceMap;
        const mapped = comptimeMap
          ? originalPosition(comptimeMap, diagnostic.line - 1, diagnostic.column - 1)
          : { source: source.fileName, line: diagnostic.line - 1, column: diagnostic.column - 1 };
        durableDiagnostics.push({
          severity: "error",
          code: diagnostic.code,
          message: diagnostic.message,
          fileName: mapped?.source ?? source.fileName,
          line: (mapped?.line ?? diagnostic.line - 1) + 1,
          column: (mapped?.column ?? diagnostic.column - 1) + 1,
          mapped: Boolean(mapped),
        });
      }
      durablyLoweredSources.push(source);
      continue;
    }
    const lowered = replaceDurableCall(source.source, source.fileName, durable.flow, durable.derivedActions);
    durableMaps.set(source.fileName, lowered.sourceMap);
    durablyLoweredSources.push({ fileName: source.fileName, source: lowered.code });
  }
  // A durable diagnostic used to discard the WHOLE run: `files` went out empty
  // and nothing downstream ever ran, for any module, including the ones that
  // lowered cleanly. For an `expect: "diagnostics"` case that is right — the
  // refusal IS the observable behavior. For an `expect: "output"` case it throws
  // the measurement away and reports a half-migrated module as though the
  // harness produced nothing, rather than as a program that answered wrongly.
  //
  // MEASURED on the corpus's own A/B durable module with one extra, unrelated
  // defect (a `Date.now()`, which only the language stage sees): before, one
  // diagnostic and `files: {}`; after, both diagnostics and the emitted module
  // set. Each further defect in such a module used to cost another fix-and-rerun
  // cycle to discover.
  //
  // It stays FAIL-CLOSED, which is the half that matters more, and that is why
  // the durable diagnostics are carried forward in the `diagnostics` assembly
  // below rather than simply dropped when the short-circuit is skipped. They
  // keep `severity: "error"`, so `hasLanguageErrors` stays true, `emitChecked`
  // stays false, and `backend-js.mjs` still returns a `diagnostics` observation:
  // a refused flow never reaches an `output` observation and so can never be
  // scored on its stdout.
  //
  // Skipping the short-circuit WITHOUT carrying them — the literal one-line
  // change — was measured on the same module: the durable refusal disappeared
  // entirely (`diagnostics: []`), `emitChecked` flipped to `true`, and the run
  // came back as `TS2307, TS2339` about the `smithers:flows` import that
  // successful lowering would have erased. That is a refused program running the
  // acceptance stage, reported under stock TypeScript codes describing this
  // driver's own un-lowered intermediate instead of the rule that refused it.
  // Execution was reached only because that un-erased import happens to fail the
  // emit check; a refusal raised after the import was erased would have had
  // nothing left to stop it.
  //
  // The narrow scope did NOT buy what it looked like it would: all fifteen
  // `expect: "diagnostics"` cases in `17-durable` that reach this stage were
  // lowered both ways on 2026-08-27 and none changed its diagnostic set. It
  // stays scoped anyway. A `diagnostics` expectation is an EXACT set, and a
  // second defect in such a case would append a diagnostic it never declared —
  // which is precisely what the `output` half exists to surface and precisely
  // what the `diagnostics` half has nothing to gain from.
  const expectsOutput = request.expectsOutput === true;
  if (durableDiagnostics.length > 0 && !expectsOutput) {
    process.stdout.write(JSON.stringify({
      ok: true,
      files: {},
      diagnostics: durableDiagnostics,
      emitChecked: false,
      emitDiagnostics: [],
      assetsCompiled: assets !== undefined,
      generatedFiles: [],
    }));
    return;
  }
  loweredSources = durablyLoweredSources;
  // rootDir === outDir keeps every authored relative specifier byte identical,
  // so the emitted `.ts` modules sit beside the foreign `.ts` modules the case
  // imports and bun can execute the set without a resolution shim.
  const compiled = compileProject(loweredSources, {
    rootDir: request.rootDir,
    outDir: request.rootDir,
    runtimeImport: request.runtimeImport,
    outputExtension: ".ts",
    sourceMap: true,
    additionalRuntimeSources: [
      ...typeScriptSources.map((file) => ({
        sourceFileName: file.fileName,
        source: file.source,
      })),
      ...(assets?.modules ?? []),
    ],
    additionalRuntimeOutputs: assets?.outputs ?? [],
  });

  const files = {};
  for (const [fileName, file] of Object.entries(compiled.files)) {
    const comptimeMap = comptime?.loweredFiles?.[fileName]?.sourceMap;
    const durableMap = durableMaps.get(fileName);
    let frontendMap = durableMap;
    if (durableMap && comptimeMap) {
      frontendMap = composeSourceMaps(durableMap, comptimeMap, `${file.outputFileName}.durable.ts`);
    } else if (!durableMap) {
      frontendMap = comptimeMap;
    }
    if (frontendMap && !file.sourceMap) throw new TypeError(`frontend source map is missing for ${fileName}`);
    files[fileName] = {
      code: file.code,
      sourceMap: frontendMap
        ? composeSourceMaps(file.sourceMap, frontendMap, `${file.outputFileName}.frontend.ts`)
        : file.sourceMap,
      outputFileName: file.outputFileName,
      rows: file.analysis.rows,
    };
  }

  // `durableDiagnostics` is empty on every run that short-circuited or had no
  // durable failure at all, so this is an exact no-op except on the one path the
  // guard above opened: an `expect: "output"` run whose durable lowering was
  // refused. There the durable errors MUST survive — dropping them would let a
  // refused flow be judged on stdout alone, which is the fail-open this harness
  // exists to refuse. They are already on authored coordinates.
  const diagnostics = [...durableDiagnostics, ...compiled.diagnostics.map((diagnostic) => {
    const comptimeMap = comptime?.loweredFiles?.[diagnostic.fileName]?.sourceMap;
    const durableMap = durableMaps.get(diagnostic.fileName);
    const frontendMap = durableMap && comptimeMap
      ? composeSourceMaps(durableMap, comptimeMap, `${diagnostic.fileName}.durable.ts`)
      : durableMap ?? comptimeMap;
    if (!frontendMap) return { ...diagnostic, mapped: true };
    const mapped = originalPosition(frontendMap, diagnostic.line - 1, diagnostic.column - 1);
    if (!mapped) return { ...diagnostic, mapped: false };
    return {
      ...diagnostic,
      fileName: mapped.source,
      line: mapped.line + 1,
      column: mapped.column + 1,
      mapped: true,
    };
  })];

  // The final acceptance stage, and the reason this driver exists rather than a bare
  // `compileProject` call: the emitted module set has to survive a stock
  // TypeScript check. The foreign `.ts` modules a case imports are handed to
  // the same program in memory, at the paths the emitted code imports them
  // from, so resolution matches what actually executes afterwards.
  const hasLanguageErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const generatedFiles = (assets?.modules ?? []).map((module, index) => ({
    fileName: assets.outputs[index].outputFileName,
    code: module.source,
  }));
  let emitDiagnostics = [];
  if (!hasLanguageErrors) {
    const emitted = Object.values(compiled.files).map((file) => ({
      fileName: file.outputFileName,
      code: file.code,
    }));
    for (const file of typeScriptSources) {
      emitted.push({ fileName: resolve(request.rootDir, file.fileName), code: file.source });
    }
    // The generated asset modules are part of the emitted set, so a program
    // whose asset module does not type-check is rejected here rather than
    // failing at run time — the same rule the emitted `.sm` modules are held to.
    for (const generated of generatedFiles) emitted.push(generated);
    emitDiagnostics = checkEmittedProject(emitted)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => {
        const position = diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined;
        return {
          code: diagnostic.code,
          fileName: diagnostic.file ? diagnostic.file.fileName : undefined,
          line: position ? position.line + 1 : undefined,
          column: position ? position.character + 1 : undefined,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        };
      });
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    files,
    diagnostics,
    emitChecked: !hasLanguageErrors,
    emitDiagnostics,
    assetsCompiled: assets !== undefined,
    generatedFiles,
  }));
}

try {
  await main();
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? `${error.message}` : String(error) }),
  );
  process.exitCode = 1;
}
