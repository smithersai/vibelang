import { realpathSync, statSync, unwatchFile, watchFile, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createUnplugin, type UnpluginBuildContext, type UnpluginOptions } from "unplugin";
import type { ViteDevServer } from "vite";
import { getNativeCompiler } from "../poc/dist/compiler/native.js";
import { COMPILER_INTRINSIC_SPECIFIERS } from "../poc/dist/language/compiler-modules.js";
import { composeSourceMaps, createOffsetSourceMap } from "../poc/dist/language/source-map.js";
import {
  compileVibeLangFiles, isRecord, MAX_CLI_SOURCE_BYTES,
  readBoundedUtf8File, resolveAuthoredVibeLangImport,
  type CliDiagnostic, type ProjectBuildPublication,
} from "./project-build.js";

export interface VibeLangPluginOptions {
  /** Complete checked program roots, relative to root. Imported .vibe files
   * are discovered with the same resolver and limits as the CLI. */
  readonly entries: readonly string[];
  /** Stable module-identity and dependency boundary. Defaults to cwd. */
  readonly root?: string;
  /** Checked is the default. Transform-only is NOT a conforming compiler: its
   * current conservative subset refuses every non-compiler module dependency. */
  readonly mode?: "checked" | "transform-only";
  /** Comptime/loader target identity; output is ES2022 ESM. Set this explicitly
   * for browser/Bun builds; the default matches the CLI: node-es2022. */
  readonly target?: string;
}

/** Opaque, structurally compatible host plugins. The host owns its hook types;
 * importing this factory must not pull every optional bundler's declarations
 * into an otherwise ordinary language consumer. Options remain fully typed. */
export interface NamedBuildPlugin { readonly name: string }
export interface SetupBuildPlugin extends NamedBuildPlugin { setup(host: unknown): void | Promise<void> }
export interface CompilerBuildPlugin { apply(compiler: unknown): void }
export type VibeLangBuildHost = "rollup" | "vite" | "rolldown" | "webpack" | "rspack" | "rsbuild" | "esbuild" | "farm" | "bun" | "unloader";
export interface VibeLangUnplugin {
  vite(options: VibeLangPluginOptions): NamedBuildPlugin;
  rollup(options: VibeLangPluginOptions): NamedBuildPlugin;
  rolldown(options: VibeLangPluginOptions): NamedBuildPlugin;
  webpack(options: VibeLangPluginOptions): CompilerBuildPlugin;
  rspack(options: VibeLangPluginOptions): CompilerBuildPlugin;
  rsbuild(options: VibeLangPluginOptions): SetupBuildPlugin;
  esbuild(options: VibeLangPluginOptions): SetupBuildPlugin;
  farm(options: VibeLangPluginOptions): NamedBuildPlugin;
  bun(options: VibeLangPluginOptions): SetupBuildPlugin;
  raw(options: VibeLangPluginOptions, meta: { readonly framework: VibeLangBuildHost }): NamedBuildPlugin;
}

export class VibeLangBuildError extends Error {
  readonly diagnostics: readonly CliDiagnostic[];
  constructor(diagnostics: readonly CliDiagnostic[]) {
    super(diagnostics.map(issue => `${issue.file ?? "<project>"}:${issue.line ?? 1}:${issue.column ?? 1} [${issue.code}] ${issue.message}`).join("\n"));
    this.name = "VibeLangBuildError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

const NAME = "unplugin-vibelang";
const ASSET = "virtual:vibelang:asset/";
const FILTER = /(?:\.vibe(?:[?#].*)?$|^virtual:vibelang:asset\/)/;
const portable = (name: string) => name.split(sep).join("/");
const within = (root: string, file: string) => {
  const path = relative(root, file);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const string = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !value.includes("\0") && value.length <= 16 * 1024;
const withoutMapComment = (code: string) => code.replace(/\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/, "");

interface BundlerSourceMap {
  readonly version: 3;
  readonly file: string;
  readonly sources: string[];
  readonly sourcesContent: (string | null)[];
  readonly names: string[];
  readonly mappings: string;
}
interface ModuleOutput { readonly code: string; readonly map: BundlerSourceMap }
interface BuildState { readonly modules: ReadonlyMap<string, ModuleOutput> }

/** Address rewriting uses spans supplied by the Go parser. Ordinary string
 * literals are never searched/replaced. Only verbatim ranges retain mappings;
 * new import addresses are deliberately unmapped. */
function hostModule(
  code: string, sourceMap: string, outputFile: string, id: string,
  destinations: ReadonlyMap<string, string>,
): ModuleOutput {
  code = withoutMapComment(code);
  const facts = getNativeCompiler().inspect([{ path: basename(outputFile), text: code, scriptKind: "javascript" }]).files[0]!;
  if (facts.diagnostics.some(issue => issue.category === "error")) throw new Error("VibeLang bundler received invalid generated JavaScript");
  const edits = facts.moduleSyntax.flatMap(edge => {
    if (!edge.specifier?.startsWith(".") || !edge.specifierSpan) return [];
    const destination = destinations.get(resolve(dirname(outputFile), edge.specifier));
    if (destination === undefined) throw new Error(`VibeLang bundler has no module destination for ${edge.specifier} in ${outputFile}`);
    return [{ start: edge.specifierSpan.start, length: edge.specifierSpan.length, text: JSON.stringify(destination) }];
  }).sort((a, b) => a.start - b.start);
  let derived = "", cursor = 0;
  const runs: { derivedStart: number; authoredStart: number; length: number }[] = [];
  for (const edit of edits) {
    if (edit.start < cursor) throw new Error("VibeLang bundler received overlapping native module spans");
    runs.push({ derivedStart: derived.length, authoredStart: cursor, length: edit.start - cursor });
    derived += code.slice(cursor, edit.start) + edit.text;
    cursor = edit.start + edit.length;
  }
  runs.push({ derivedStart: derived.length, authoredStart: cursor, length: code.length - cursor });
  derived += code.slice(cursor);
  const composed = edits.length === 0 ? sourceMap : composeSourceMaps(createOffsetSourceMap({
    authoredText: code, derivedText: derived, runs, sourceName: outputFile, fileName: id,
  }), sourceMap, id);
  const map: unknown = JSON.parse(composed);
  if (!isRecord(map) || map.version !== 3 || !Array.isArray(map.sources) ||
    !map.sources.every(source => typeof source === "string") || typeof map.mappings !== "string" ||
    !Array.isArray(map.names) || !map.names.every(name => typeof name === "string") ||
    !Array.isArray(map.sourcesContent) || map.sourcesContent.length !== map.sources.length ||
    !map.sourcesContent.every(source => source === null || typeof source === "string") ||
    (map.sourceRoot !== undefined && map.sourceRoot !== "")) {
    throw new Error("VibeLang bundler received an invalid source map");
  }
  // CLI map sources are relative to the virtual output; host module IDs are
  // authored paths. Absolute sources avoid accidentally resolving against the
  // bundler's virtual namespace or relocated output directory.
  return { code: derived, map: {
    version: 3, file: id, sources: map.sources.map(source => portable(resolve(dirname(outputFile), source))),
    sourcesContent: map.sourcesContent, names: map.names, mappings: map.mappings,
  } };
}

function createPlugin(options: VibeLangPluginOptions, meta: { readonly framework: VibeLangBuildHost }): UnpluginOptions {
  if (!isRecord(options) || Object.keys(options).some(key => !["entries", "root", "mode", "target"].includes(key)) ||
    !Array.isArray(options.entries) || options.entries.length === 0 || options.entries.length > 1024 || !options.entries.every(string) ||
    (options.root !== undefined && !string(options.root)) ||
    (options.mode !== undefined && !["checked", "transform-only"].includes(options.mode)) ||
    (options.target !== undefined && (!string(options.target) || options.target.length > 1024))) {
    throw new TypeError("VibeLang bundler requires bounded entries and valid root/mode/target options");
  }
  const root = realpathSync(resolve(options.root ?? process.cwd()));
  if (!statSync(root).isDirectory()) throw new TypeError("VibeLang bundler root must be a directory");
  const entries = [...new Set(options.entries.map(file => resolve(root, file)))].sort();
  if (entries.some(file => !file.endsWith(".vibe") || !within(root, file))) {
    throw new TypeError("VibeLang bundler entries must be .vibe files beneath root");
  }
  const mode = options.mode ?? "checked", target = options.target ?? "node-es2022";
  const outDir = join(root, ".vibelang-bundler-output"); // virtual: never created
  const overrides = new Map<string, string>();
  const builds = new Map<string, Promise<BuildState>>();
  const loaded = new Set<string>();
  const watchedFiles = new Set(entries), watchedDirectories = new Set<string>();
  let viteServer: ViteDevServer | undefined;
  const viteWatches = new Map<string, (current: Stats, previous: Stats) => void>();
  let generation = 0;

  function invalidate(clearOverrides = true) {
    generation++;
    builds.clear();
    loaded.clear();
    watchedFiles.clear();
    watchedDirectories.clear();
    entries.forEach(file => watchedFiles.add(file));
    if (clearOverrides) overrides.clear();
  }

  function watch(context: UnpluginBuildContext) {
    if (viteServer) {
      // Vite turns addWatchFile entries into import-graph edges. Negative
      // resolution probes are not modules, and node_modules is ignored by its
      // default watcher. Poll the bounded native input inventory independently
      // and invalidate the host's checked-module cache on every real change.
      // This is dependency transport only; compilation stays in ensure().
      const inputs = new Set([...watchedFiles, ...watchedDirectories]);
      for (const [file, callback] of viteWatches) if (!inputs.has(file)) {
        unwatchFile(file, callback);
        viteWatches.delete(file);
      }
      for (const file of inputs) if (!viteWatches.has(file)) {
        const callback = (current: Stats, previous: Stats) => {
          if (!viteServer || (current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs &&
            current.size === previous.size && current.ino === previous.ino && current.nlink === previous.nlink)) return;
          invalidate();
          for (const environment of Object.values(viteServer.environments)) {
            for (const module of environment.moduleGraph.idToModuleMap.values()) {
              if (module.id && (module.id.startsWith(ASSET) || (module.id.endsWith(".vibe") && within(root, module.id)))) {
                environment.moduleGraph.invalidateModule(module);
              }
            }
          }
          // A changed row can alter all caller ABIs. A complete client reload
          // is conservative and does not pretend an old closure is still valid.
          viteServer.ws.send({ type: "full-reload" });
        };
        viteWatches.set(file, callback);
        watchFile(file, { persistent: false, interval: 250 }, callback);
      }
      return;
    }
    for (const file of watchedFiles) context.addWatchFile(file);
    const native = context.getNativeBuildContext?.();
    if (native?.framework === "webpack" || native?.framework === "rspack") {
      for (const probe of watchedDirectories) {
        // These hosts distinguish missing paths from directory membership.
        // Promoting a missing path to a recursive parent watch could otherwise
        // scan an entire checkout (or drive) during initial resolution.
        const stat = statSync(probe, { throwIfNoEntry: false });
        if (stat?.isDirectory()) native.loaderContext?.addContextDependency(probe);
        else if (stat) context.addWatchFile(probe);
        else native.loaderContext?.addMissingDependency(probe);
      }
    } else if (meta.framework !== "esbuild") {
      for (const directory of watchedDirectories) context.addWatchFile(directory);
    }
  }

  function canonical(id: string): string {
    if (/\.vibe[?#]/.test(id)) throw new TypeError("VibeLang bundler does not support query/hash variants of authored modules");
    const file = realpathSync(resolve(id));
    if (!within(root, file)) throw new TypeError("VibeLang bundler source escaped its project root");
    return file;
  }

  async function ensure(file: string): Promise<BuildState> {
    const key = mode === "checked" ? "<checked-project>" : file;
    let active = builds.get(key);
    if (active) return active;
    const epoch = generation;
    active = (async () => {
      if (mode === "transform-only") {
        const source = overrides.get(file) ?? readBoundedUtf8File(file, MAX_CLI_SOURCE_BYTES, ".vibe source").source;
        const facts = getNativeCompiler().inspect([{ path: portable(relative(root, file)), text: source, scriptKind: "typescript" }]).files[0]!;
        // The native single-file pass remains responsible for all local call
        // conventions. This delivery profile never discovers foreign callees
        // and then pretends that was a transform-only decision.
        if (facts.moduleSyntax.some(edge => edge.kind !== "import-meta" &&
          (edge.specifier === undefined || (!COMPILER_INTRINSIC_SPECIFIERS.has(edge.specifier) && edge.specifier !== "vibelang:schema")))) {
          throw new Error("VibeLang transform-only cannot decide cross-module calling conventions; use checked mode");
        }
      }
      let publication: ProjectBuildPublication | undefined;
      const results = await compileVibeLangFiles(mode === "checked" ? entries : [file], {
        rootDir: root, outDir, sourceMap: true, target, sourceOverrides: overrides,
        durableBodyCompatibility: false,
        onDependencies(trace) {
          if (epoch !== generation) return;
          trace.files.forEach(path => watchedFiles.add(path));
          trace.directories.forEach(path => watchedDirectories.add(path));
        },
        publish(value) { publication = value; },
      });
      if (epoch !== generation) throw new Error("VibeLang project changed while compiling; rebuild required");
      const diagnostics = results.flatMap(result => result.diagnostics).filter(issue => issue.severity === "error");
      if (diagnostics.length > 0) throw new VibeLangBuildError(diagnostics);
      if (!publication) throw new Error("VibeLang bundler received no accepted project output");
      const destinations = new Map(publication.modules.map(module => [module.outputFileName,
        module.kind === "asset" ? ASSET + encodeURIComponent(module.outputFileName) : portable(module.sourceFileName)]));
      const outputs = new Map(publication.outputs.map(output => [output.fileName, output.code]));
      const modules = new Map<string, ModuleOutput>();
      for (const module of publication.modules) {
        if (module.kind === "foreign") continue;
        const code = outputs.get(module.outputFileName), map = outputs.get(`${module.outputFileName}.map`);
        if (code === undefined || map === undefined) throw new Error("VibeLang bundler requires code and a map for every emitted module");
        const id = destinations.get(module.outputFileName)!;
        modules.set(id, hostModule(code, map, module.outputFileName, id, destinations));
      }
      return { modules };
    })();
    builds.set(key, active);
    return active;
  }

  async function moduleOutput(id: string, context: UnpluginBuildContext, source?: string): Promise<ModuleOutput> {
    const file = id.startsWith(ASSET) ? entries[0]! : canonical(id);
    if (source !== undefined && overrides.get(file) !== source) {
      invalidate(false);
      overrides.set(file, source);
    }
    try {
      const state = await ensure(file);
      const output = state.modules.get(id.startsWith(ASSET) ? id : portable(file));
      if (!output) throw new Error(`VibeLang module is outside the checked entry closure: ${id}`);
      return output;
    } finally {
      watch(context);
    }
  }

  function esbuildDirectories(): string[] {
    const directories = new Set<string>();
    for (const probe of watchedDirectories) {
      // esbuild watches directory entries non-recursively, but only accepts
      // existing directories. Cover missing probes by the nearest parent.
      let directory = probe;
      while (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
        const parent = dirname(directory);
        if (directory === parent) break;
        directory = parent;
      }
      directories.add(directory);
    }
    return [...directories];
  }

  return {
    name: NAME,
    enforce: "pre",
    buildStart() { invalidate(); },
    watchChange() { invalidate(); },
    resolveId(id, importer, resolution) {
      if (id.startsWith(ASSET)) return id; // load requires an issued module
      if (/\.vibe[?#]/.test(id)) throw new TypeError("VibeLang bundler does not support query/hash variants of authored modules");
      if (id.endsWith(".vibe")) {
        // Vite also sends root-relative browser URLs (and /@fs/ URLs) through
        // resolveId. Its resolver owns converting those to real filesystem IDs;
        // the subsequent load still enforces our canonical project boundary.
        if (meta.framework === "vite" && id.startsWith("/") && !within(root, id)) return null;
        // Entry strings belong to the host's working directory, which need
        // not equal the language's identity root. Its ordinary exact-file
        // resolution works for .vibe; our load hook owns the resulting bytes.
        if (resolution.isEntry && !isAbsolute(id)) return null;
        if (importer && !isAbsolute(id) && !id.startsWith(".") && !resolution.isEntry) return null;
        const absolute = isAbsolute(id) ? id : resolve(importer ? dirname(importer) : root, id);
        const resolved = portable(canonical(absolute));
        // enhanced-resolve invokes this hook again with the returned address.
        // Let it finish an already-canonical file instead of resolving itself
        // recursively. Other hosts don't use this resolve-again protocol.
        if (meta.framework === "webpack" && id === resolved) return null;
        return resolved;
      }
      if (importer && id.startsWith(".") && !importer.startsWith(ASSET)) {
        const file = resolveAuthoredVibeLangImport(importer, id);
        if (file) return portable(canonical(file));
      }
      return null;
    },
    load: { filter: { id: FILTER }, async handler(id) {
      if (!FILTER.test(id)) return null;
      const result = await moduleOutput(id, this);
      loaded.add(id);
      return result;
    } },
    transform: { filter: { id: FILTER }, async handler(code, id) {
      if (!FILTER.test(id)) return null;
      if (loaded.has(id) || id.startsWith(ASSET)) {
        // Farm's unplugin load adapter drops load-result maps. Its transform
        // adapter accepts them, so forward the SAME output/map there once.
        if (meta.framework === "farm") return moduleOutput(id, this);
        watch(this);
        return null;
      }
      return moduleOutput(id, this, code);
    } },
    vite: {
      configureServer(server) { viteServer = server; },
      closeBundle() {
        for (const [file, callback] of viteWatches) unwatchFile(file, callback);
        viteWatches.clear();
        viteServer = undefined;
      },
    },
    esbuild: {
      loader: "js",
      // unplugin has no watchDirs result field. Transport the SAME common
      // module output through esbuild's complete load response, including its
      // distinct directory-membership dependency contract. No second lowering.
      setup(build) {
        // Rewritten module IDs belong to the host's resolution pipeline, not
        // the emitted program. An unbundled build never visits those imports.
        if (build.initialOptions.bundle !== true) {
          throw new Error("VibeLang esbuild integration requires bundle: true; use 'vibe compile' for unbundled output");
        }
        build.onLoad({ filter: FILTER }, async args => {
          const context: UnpluginBuildContext = {
            addWatchFile(file) { watchedFiles.add(file); },
            getWatchFiles: () => [...watchedFiles],
            getNativeBuildContext: () => ({ framework: "esbuild", build }),
            emitFile() { throw new Error("VibeLang build output must remain in memory"); },
            parse() { throw new Error("VibeLang parsing belongs to Go"); },
          };
          try {
            const output = await moduleOutput(args.path, context);
            return {
              contents: output.code + "\n//# sourceMappingURL=data:application/json;base64," + Buffer.from(JSON.stringify(output.map)).toString("base64") + "\n",
              loader: "js", resolveDir: dirname(args.path),
              watchFiles: [...watchedFiles], watchDirs: esbuildDirectories(),
            };
          } catch (error) {
            return { errors: [{ text: error instanceof Error ? error.message : String(error) }],
              watchFiles: [...watchedFiles], watchDirs: esbuildDirectories() };
          }
        });
      },
    },
    bun: { loader: "js" },
  };
}

export const unpluginFactory: VibeLangUnplugin["raw"] = createPlugin;
export const unplugin: VibeLangUnplugin = createUnplugin<VibeLangPluginOptions, false>(createPlugin);
export default unplugin;
