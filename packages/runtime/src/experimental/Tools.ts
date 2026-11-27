/**
 * The standard tools (VIP-64): files, search, the shell, HTTP, the web and
 * language servers.
 *
 * Each tool is one declaration with two uses. It is an Effect `Tool` a model
 * calls through a toolkit ({@link filesystem}, {@link shell}, {@link http},
 * {@link web}, {@link lsp}, {@link readOnly}), and it is a function a program
 * calls directly: `Tools.read({ path })`. Both reach the same handler.
 *
 * Rules:
 *
 * - Ordinary outcomes are values. A non-zero exit code, an empty match set
 *   and an HTTP 500 are successes with data. {@link ToolError} is for
 *   failures a model must see as failures; its `code` is a closed list.
 * - Limits are disclosed. A capped result says so with `truncated`,
 *   `stdoutTruncated` or `stderrTruncated`, and capture is bounded where it
 *   is read.
 * - A child process gets a small environment: `PATH`, `HOME`, `USER`,
 *   `LANG`, `LC_*`, `TERM`, `TMPDIR`, `SHELL`, the host variables the call
 *   names in `inherit`, and what it declares in `env`.
 * - Each call asks the permission kernel for the resolved resource before it
 *   runs (`fs:read`, `fs:write`, `proc:spawn`, `net:get`, `net:post`), and
 *   each tool carries Effect's `Readonly`, `Destructive` and `Idempotent`
 *   annotations.
 * - `read` preserves bytes: a CRLF file keeps its `\r`, so its text is a valid
 *   `edit` anchor. `edit` fails on an anchor that no longer matches and never
 *   overwrites a change made since it read the file.
 * - Search runs on the {@link Search} service: an in-process walk by default,
 *   ripgrep with {@link layerNativeSearch}, or any function with
 *   {@link layerRemoteSearch}.
 * - Inside a workflow or one of its tasks, a direct call is a recorded step.
 *   A call a model makes is recorded by the model's own step, or by
 *   `Experimental.Agent.run`.
 *
 * There is no `Tools.all`: a tool set that can run a shell is chosen by name.
 * `readOnly` is a tool set, not a confinement.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Glob from "effect/Glob"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import * as ChildProcess from "effect/process/ChildProcess"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import * as Capability from "./Capability.js"
import { commandResource } from "./internal/capabilityGuard.js"
import * as Patch from "./internal/toolsPatch.js"
import { recorded } from "./internal/toolsRecord.js"
import * as Text from "./internal/toolsText.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Tools"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Tools"

// -----------------------------------------------------------------------------
// Failures
// -----------------------------------------------------------------------------

/**
 * Why a tool failed. A closed list.
 *
 * - `invalid_input`: the input does not match the tool's schema, or a
 *   pattern or URL in it does not parse.
 * - `permission_denied`: the permission kernel refused the resource.
 * - `not_found`, `not_a_file`, `not_a_directory`: the path is not what the
 *   tool needs.
 * - `exists`: the file to create is already there.
 * - `anchor_not_found`, `anchor_ambiguous`: `edit`'s `oldText` is not in the
 *   file, or is there more than once without `replaceAll`.
 * - `conflict`: the file changed between `edit`'s read and its write.
 * - `invalid_patch`, `patch_rejected`: `applyPatch`'s patch does not parse,
 *   or does not match the files.
 * - `too_large`: the input is over a tool's limit.
 * - `timeout`: the call ran past its time limit.
 * - `spawn_failed`: the command could not be started.
 * - `network_failed`: the request did not reach a response.
 * - `unavailable`: the service the tool needs is not provided.
 * - `io_failed`: the file system failed in some other way.
 *
 * @category errors
 * @since 0.0.13
 */
export const ToolErrorCode = Schema.Literals([
  "invalid_input",
  "permission_denied",
  "not_found",
  "not_a_file",
  "not_a_directory",
  "exists",
  "anchor_not_found",
  "anchor_ambiguous",
  "conflict",
  "invalid_patch",
  "patch_rejected",
  "too_large",
  "timeout",
  "spawn_failed",
  "network_failed",
  "unavailable",
  "io_failed"
])

/**
 * @category errors
 * @since 0.0.13
 */
export type ToolErrorCode = typeof ToolErrorCode.Type

/**
 * A failure a model must see as a failure. `path` names the file where one
 * exists.
 *
 * @category errors
 * @since 0.0.13
 */
export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
  code: ToolErrorCode,
  message: Schema.String,
  path: Schema.optional(Schema.String)
}) {}

const fail = (code: ToolErrorCode, message: string, path?: string): Effect.Effect<never, ToolError> =>
  Effect.fail(new ToolError(path === undefined ? { code, message } : { code, message, path }))

const ask = (capability: Capability.CapabilityText): Effect.Effect<void, ToolError> =>
  Effect.mapError(Capability.check(capability), (error) =>
    new ToolError({
      code: "permission_denied",
      message: error._tag === "PermissionDenied"
        ? `Permission denied for ${capability}: ${error.reason}`
        : `Permission required for ${capability}; nobody granted it.`
    }))

const platform = (error: { readonly reason?: { readonly _tag?: string } }, path: string, what: string): ToolError => {
  const tag = error.reason?._tag
  return new ToolError({
    code: tag === "NotFound" ? "not_found" : tag === "PermissionDenied" ? "permission_denied" : "io_failed",
    message: tag === "NotFound" ? `${path} does not exist.` : `Could not ${what} ${path}${tag === undefined ? "" : ` (${tag})`}.`,
    path
  })
}

// -----------------------------------------------------------------------------
// Limits
// -----------------------------------------------------------------------------

/**
 * The bounds every tool applies. A call may lower one with its own option;
 * none can be turned off.
 *
 * @category limits
 * @since 0.0.13
 */
export const limits = {
  /** Lines `read` returns unless `limit` says fewer. */
  readLines: 2000,
  /** Characters `read` returns. */
  readChars: 262_144,
  /** Bytes a file may have for `edit`, `applyPatch` and `grep` to read it. */
  fileBytes: 10 * 1024 * 1024,
  /** Entries `ls` returns. */
  entries: 1000,
  /** Paths `glob` returns. */
  paths: 1000,
  /** Matches `grep` returns. */
  matches: 500,
  /** Characters of one matching line `grep` keeps. */
  lineChars: 500,
  /** Bytes of standard output and of standard error `bash` keeps, each. */
  outputBytes: 65_536,
  /** Milliseconds a command runs before it is stopped. */
  commandMs: 120_000,
  /** Bytes of a response body `fetch`, `post` and `webfetch` keep. */
  bodyBytes: 262_144,
  /** Milliseconds a request may take. */
  requestMs: 60_000
} as const

const positive = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : Math.max(1, Math.min(fallback, Math.floor(value)))

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const ReadInput = Schema.Struct({
  path: Schema.String.annotate({ description: "The file to read." }),
  offset: Schema.optional(Count).annotate({ description: "The first line to read, counting from 1." }),
  limit: Schema.optional(Count).annotate({ description: "How many lines to read." })
})
const ReadOutput = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  /** The first line returned, counting from 1. */
  startLine: Schema.Number,
  /** Lines returned. */
  lines: Schema.Number,
  /** Lines in the file. */
  totalLines: Schema.Number,
  truncated: Schema.Boolean
})
const WriteInput = Schema.Struct({
  path: Schema.String.annotate({ description: "The file to write. Missing directories are created." }),
  content: Schema.String
})
const WriteOutput = Schema.Struct({ path: Schema.String, bytes: Schema.Number, created: Schema.Boolean })
const EditInput = Schema.Struct({
  path: Schema.String,
  oldText: Schema.String.annotate({ description: "Text that is in the file now, exactly." }),
  newText: Schema.String,
  replaceAll: Schema.optional(Schema.Boolean)
})
const EditOutput = Schema.Struct({ path: Schema.String, replacements: Schema.Number })
const ApplyPatchInput = Schema.Struct({
  patch: Schema.String.annotate({ description: "A unified diff. Every file it names is changed, or none is." }),
  root: Schema.optional(Schema.String).annotate({ description: "The directory the patch's paths are relative to." })
})
const ApplyPatchOutput = Schema.Struct({
  files: Schema.Array(Schema.Struct({
    path: Schema.String,
    change: Schema.Literals(["created", "modified", "deleted"])
  }))
})
const EntryType = Schema.Literals(["file", "directory", "symlink", "other"])
const LsInput = Schema.Struct({ path: Schema.String })
const LsOutput = Schema.Struct({
  path: Schema.String,
  entries: Schema.Array(Schema.Struct({ name: Schema.String, type: EntryType })),
  total: Schema.Number,
  truncated: Schema.Boolean
})
const GlobInput = Schema.Struct({
  pattern: Schema.String.annotate({ description: "A glob such as src/**/*.ts." }),
  root: Schema.optional(Schema.String)
})
const GlobOutput = Schema.Struct({
  root: Schema.String,
  paths: Schema.Array(Schema.String),
  total: Schema.Number,
  truncated: Schema.Boolean
})

/**
 * The input of `grep`.
 *
 * @category search
 * @since 0.0.13
 */
export const GrepInput = Schema.Struct({
  pattern: Schema.String.annotate({ description: "A JavaScript regular expression." }),
  root: Schema.optional(Schema.String),
  glob: Schema.optional(Schema.String).annotate({ description: "Only files whose relative path matches this glob." }),
  ignoreCase: Schema.optional(Schema.Boolean),
  maxMatches: Schema.optional(Count)
})

/**
 * @category search
 * @since 0.0.13
 */
export type GrepInput = typeof GrepInput.Type

/**
 * What `grep` gives: matches as paths relative to `root`, with 1-based line
 * numbers.
 *
 * @category search
 * @since 0.0.13
 */
export const GrepOutput = Schema.Struct({
  root: Schema.String,
  matches: Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.Number, text: Schema.String })),
  filesSearched: Schema.Number,
  truncated: Schema.Boolean
})

/**
 * @category search
 * @since 0.0.13
 */
export type GrepOutput = typeof GrepOutput.Type

const CommandInput = Schema.Struct({
  command: Schema.String.annotate({ description: "A shell command line, run with sh -c." }),
  cwd: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Count),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Variables to set for the command."
  }),
  inherit: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Host variables to pass through, by name."
  })
})
const CommandOutput = Schema.Struct({
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  timedOut: Schema.Boolean
})
const TestOutput = Schema.Struct({ ...CommandOutput.fields, passed: Schema.Boolean })
const Headers = Schema.Record(Schema.String, Schema.String)
const FetchInput = Schema.Struct({ url: Schema.String, headers: Schema.optional(Headers) })
const PostInput = Schema.Struct({
  url: Schema.String,
  body: Schema.String,
  contentType: Schema.optional(Schema.String),
  headers: Schema.optional(Headers)
})
const HttpOutput = Schema.Struct({
  url: Schema.String,
  status: Schema.Number,
  contentType: Schema.optional(Schema.String),
  body: Schema.String,
  truncated: Schema.Boolean
})
const WebFetchInput = Schema.Struct({ url: Schema.String })
const WebFetchOutput = Schema.Struct({
  url: Schema.String,
  status: Schema.Number,
  title: Schema.optional(Schema.String),
  text: Schema.String,
  truncated: Schema.Boolean
})

/**
 * The input of `websearch`.
 *
 * @category web
 * @since 0.0.13
 */
export const WebSearchInput = Schema.Struct({ query: Schema.String, limit: Schema.optional(Count) })

/**
 * What `websearch` gives.
 *
 * @category web
 * @since 0.0.13
 */
export const WebSearchOutput = Schema.Struct({
  results: Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String, snippet: Schema.String })),
  truncated: Schema.Boolean
})

/**
 * A position in a file for the language-server tools. `line` and
 * `character` count from 1.
 *
 * @category lsp
 * @since 0.0.13
 */
export const LspPosition = Schema.Struct({ path: Schema.String, line: Count, character: Count })

/**
 * A place a language server points at. Lines and characters count from 1.
 *
 * @category lsp
 * @since 0.0.13
 */
export const LspLocation = Schema.Struct({ path: Schema.String, line: Schema.Number, character: Schema.Number })

/**
 * One diagnostic a language server reports.
 *
 * @category lsp
 * @since 0.0.13
 */
export const LspDiagnostic = Schema.Struct({
  path: Schema.String,
  line: Schema.Number,
  character: Schema.Number,
  severity: Schema.Literals(["error", "warning", "info", "hint"]),
  message: Schema.String
})

/**
 * One symbol a language server reports.
 *
 * @category lsp
 * @since 0.0.13
 */
export const LspSymbol = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
  path: Schema.String,
  line: Schema.Number,
  character: Schema.Number
})

const LspFile = Schema.Struct({ path: Schema.String })
const LspLocations = Schema.Struct({ locations: Schema.Array(LspLocation), truncated: Schema.Boolean })
const LspHover = Schema.Struct({ text: Schema.String })
const LspDiagnostics = Schema.Struct({ diagnostics: Schema.Array(LspDiagnostic), truncated: Schema.Boolean })
const LspSymbols = Schema.Struct({ symbols: Schema.Array(LspSymbol), truncated: Schema.Boolean })

// -----------------------------------------------------------------------------
// Services
// -----------------------------------------------------------------------------

/**
 * How `grep` searches. The default walks the file system in process.
 *
 * @category search
 * @since 0.0.13
 */
export interface SearchService {
  readonly kind: "portable" | "native" | "remote"
  readonly search: (input: GrepInput & { readonly root: string }) => Effect.Effect<GrepOutput, ToolError>
}

/**
 * The search `grep` uses, or `undefined` for the in-process walk over the
 * `FileSystem` in context.
 *
 * @category search
 * @since 0.0.13
 */
export const Search: Context.Reference<SearchService | undefined> = /* @__PURE__ */ Context.Reference<
  SearchService | undefined
>("vibelang/experimental/Tools/Search", { defaultValue: () => undefined })

/**
 * Searches with a function the host supplies: another machine, an index.
 *
 * @category search
 * @since 0.0.13
 */
export const layerRemoteSearch = (
  search: (input: GrepInput & { readonly root: string }) => Effect.Effect<GrepOutput, ToolError>
): Layer.Layer<never> => Layer.succeed(Search, { kind: "remote", search })

/**
 * A web search provider for `websearch`.
 *
 * @category web
 * @since 0.0.13
 */
export interface WebSearchService {
  readonly search: (
    input: typeof WebSearchInput.Type
  ) => Effect.Effect<typeof WebSearchOutput.Type, ToolError>
}

/**
 * The provider `websearch` asks. None by default: `websearch` then fails
 * with `unavailable`.
 *
 * @category web
 * @since 0.0.13
 */
export const WebSearch: Context.Reference<WebSearchService | undefined> = /* @__PURE__ */ Context.Reference<
  WebSearchService | undefined
>("vibelang/experimental/Tools/WebSearch", { defaultValue: () => undefined })

/**
 * Installs a web search provider.
 *
 * @category web
 * @since 0.0.13
 */
export const layerWebSearch = (service: WebSearchService): Layer.Layer<never> => Layer.succeed(WebSearch, service)

/**
 * A language server the `lsp` tools query. Positions count from 1.
 *
 * @category lsp
 * @since 0.0.13
 */
export interface LanguageServerService {
  readonly definition: (
    at: typeof LspPosition.Type
  ) => Effect.Effect<ReadonlyArray<typeof LspLocation.Type>, ToolError>
  readonly references: (
    at: typeof LspPosition.Type
  ) => Effect.Effect<ReadonlyArray<typeof LspLocation.Type>, ToolError>
  readonly hover: (at: typeof LspPosition.Type) => Effect.Effect<string, ToolError>
  readonly diagnostics: (path: string) => Effect.Effect<ReadonlyArray<typeof LspDiagnostic.Type>, ToolError>
  readonly symbols: (path: string) => Effect.Effect<ReadonlyArray<typeof LspSymbol.Type>, ToolError>
}

/**
 * The language server the `lsp` tools ask. None by default: they then fail
 * with `unavailable`.
 *
 * @category lsp
 * @since 0.0.13
 */
export const LanguageServer: Context.Reference<LanguageServerService | undefined> = /* @__PURE__ */ Context.Reference<
  LanguageServerService | undefined
>("vibelang/experimental/Tools/LanguageServer", { defaultValue: () => undefined })

/**
 * Installs a language server.
 *
 * @category lsp
 * @since 0.0.13
 */
export const layerLanguageServer = (service: LanguageServerService): Layer.Layer<never> =>
  Layer.succeed(LanguageServer, service)

// -----------------------------------------------------------------------------
// File system
// -----------------------------------------------------------------------------

type Fs = FileSystem.FileSystem | Path.Path

const resolve = (path: Path.Path, given: string, base?: string): Effect.Effect<string, ToolError> =>
  given === "" || given.includes("\u0000")
    ? fail("invalid_input", "A path must be non-empty and hold no NUL character.", given)
    : Effect.succeed(base === undefined ? path.resolve(given) : path.resolve(base, given))

const fileKind = (type: string): typeof EntryType.Type =>
  type === "File" ? "file" : type === "Directory" ? "directory" : type === "SymbolicLink" ? "symlink" : "other"

const readText = (fs: FileSystem.FileSystem, at: string): Effect.Effect<string, ToolError> =>
  Effect.gen(function*() {
    const info = yield* Effect.mapError(fs.stat(at), (error) => platform(error, at, "read"))
    if (info.type === "Directory") return yield* fail("not_a_file", `${at} is a directory.`, at)
    if (Number(info.size) > limits.fileBytes) {
      return yield* fail("too_large", `${at} is ${info.size} bytes; the limit is ${limits.fileBytes}.`, at)
    }
    return yield* Effect.mapError(fs.readFileString(at), (error) => platform(error, at, "read"))
  })

const exists = (fs: FileSystem.FileSystem, at: string): Effect.Effect<boolean> =>
  Effect.orElseSucceed(fs.exists(at), () => false)

const writeText = (fs: FileSystem.FileSystem, path: Path.Path, at: string, content: string) =>
  Effect.gen(function*() {
    yield* Effect.mapError(fs.makeDirectory(path.dirname(at), { recursive: true }), (error) =>
      platform(error, path.dirname(at), "create the directory"))
    yield* Effect.mapError(fs.writeFileString(at, content), (error) => platform(error, at, "write"))
  })

// Splits text into lines that keep their terminators, so a CRLF line keeps its `\r`.
const linesOf = (text: string): Array<string> => {
  if (text === "") return []
  const lines = text.split(/(?<=\n)/)
  return lines
}

const readImpl = (input: typeof ReadInput.Type): Effect.Effect<typeof ReadOutput.Type, ToolError, Fs> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const at = yield* resolve(path, input.path)
    yield* ask(`fs:read:${at}`)
    const text = yield* readText(fs, at)
    const all = linesOf(text)
    const start = (input.offset ?? 1) - 1
    const wanted = positive(input.limit, limits.readLines)
    let chosen = all.slice(start, start + wanted)
    let content = chosen.join("")
    let truncated = start + chosen.length < all.length
    if (content.length > limits.readChars) {
      // Cut at a whole line where one fits, so the content stays a valid anchor.
      let size = 0
      let keep = 0
      while (keep < chosen.length && size + chosen[keep]!.length <= limits.readChars) size += chosen[keep++]!.length
      chosen = keep === 0 ? [chosen[0]!.slice(0, limits.readChars)] : chosen.slice(0, keep)
      content = chosen.join("")
      truncated = true
    }
    return {
      path: at,
      content,
      startLine: start + 1,
      lines: chosen.length,
      totalLines: all.length,
      truncated
    }
  })

const writeImpl = (input: typeof WriteInput.Type): Effect.Effect<typeof WriteOutput.Type, ToolError, Fs> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const at = yield* resolve(path, input.path)
    yield* ask(`fs:write:${at}`)
    const created = !(yield* exists(fs, at))
    yield* writeText(fs, path, at, input.content)
    return { path: at, bytes: new TextEncoder().encode(input.content).length, created }
  })

const occurrences = (text: string, anchor: string): number => {
  let count = 0
  let from = 0
  for (;;) {
    const at = text.indexOf(anchor, from)
    if (at < 0) return count
    count++
    from = at + anchor.length
  }
}

const editImpl = (input: typeof EditInput.Type): Effect.Effect<typeof EditOutput.Type, ToolError, Fs> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const at = yield* resolve(path, input.path)
    if (input.oldText === "") return yield* fail("invalid_input", "oldText must not be empty.", at)
    yield* ask(`fs:read:${at}`)
    yield* ask(`fs:write:${at}`)
    const before = yield* readText(fs, at)
    const count = occurrences(before, input.oldText)
    if (count === 0) return yield* fail("anchor_not_found", `oldText is not in ${at}. Read the file again.`, at)
    if (count > 1 && input.replaceAll !== true) {
      return yield* fail(
        "anchor_ambiguous",
        `oldText is in ${at} ${count} times. Give more context, or set replaceAll.`,
        at
      )
    }
    const after = input.replaceAll === true
      ? before.split(input.oldText).join(input.newText)
      : before.replace(input.oldText, () => input.newText)
    // A change made since the read is never overwritten.
    const now = yield* readText(fs, at)
    if (now !== before) return yield* fail("conflict", `${at} changed while it was edited. Read it again.`, at)
    yield* writeText(fs, path, at, after)
    return { path: at, replacements: input.replaceAll === true ? count : 1 }
  })

const applyPatchImpl = (
  input: typeof ApplyPatchInput.Type
): Effect.Effect<typeof ApplyPatchOutput.Type, ToolError, Fs> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = input.root === undefined ? undefined : yield* resolve(path, input.root)
    const parsed = yield* Effect.try({
      try: () => Patch.parse(input.patch),
      catch: (error) =>
        error instanceof Patch.PatchError
          ? new ToolError({ code: error.code, message: error.message })
          : new ToolError({ code: "invalid_patch", message: String(error) })
    })
    // Every file is computed before any is written, so a patch applies whole or not at all.
    const planned: Array<{ at: string; next: string | undefined; change: "created" | "modified" | "deleted" }> = []
    const seen = new Set<string>()
    for (const file of parsed) {
      const name = file.to ?? file.from!
      const at = yield* resolve(path, name, root)
      if (seen.has(at)) return yield* fail("invalid_patch", `The patch changes ${at} twice.`, at)
      seen.add(at)
      if (file.from !== undefined) yield* ask(`fs:read:${at}`)
      yield* ask(`fs:write:${at}`)
      const present = yield* exists(fs, at)
      const original = present ? yield* readText(fs, at) : undefined
      const next = yield* Effect.try({
        try: () => Patch.apply(file, original),
        catch: (error) =>
          error instanceof Patch.PatchError
            ? new ToolError({ code: error.code, message: error.message, path: at })
            : new ToolError({ code: "patch_rejected", message: String(error), path: at })
      })
      planned.push({
        at,
        next,
        change: file.from === undefined ? "created" : file.to === undefined ? "deleted" : "modified"
      })
    }
    for (const step of planned) {
      if (step.next === undefined) {
        yield* Effect.mapError(fs.remove(step.at), (error) => platform(error, step.at, "delete"))
      } else {
        yield* writeText(fs, path, step.at, step.next)
      }
    }
    return { files: planned.map((step) => ({ path: step.at, change: step.change })) }
  })

const lsImpl = (input: typeof LsInput.Type): Effect.Effect<typeof LsOutput.Type, ToolError, Fs> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const at = yield* resolve(path, input.path)
    yield* ask(`fs:read:${at}`)
    const info = yield* Effect.mapError(fs.stat(at), (error) => platform(error, at, "list"))
    if (info.type !== "Directory") return yield* fail("not_a_directory", `${at} is not a directory.`, at)
    const entries = yield* Effect.mapError(fs.readDirectoryEntries(at), (error) => platform(error, at, "list"))
    const sorted = [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    return {
      path: at,
      entries: sorted.slice(0, limits.entries).map((entry) => ({ name: entry.name, type: fileKind(entry.type) })),
      total: sorted.length,
      truncated: sorted.length > limits.entries
    }
  })

const globImpl = (input: typeof GlobInput.Type): Effect.Effect<typeof GlobOutput.Type, ToolError, Fs> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* resolve(path, input.root ?? ".")
    if (input.pattern === "") return yield* fail("invalid_input", "The pattern must not be empty.")
    yield* ask(`fs:read:${root}`)
    const found = yield* Effect.mapError(
      fs.glob(input.pattern, { root, exclude: ["**/node_modules/**", "**/.git/**", "**/.jj/**"] }),
      (error) => platform(error, root, "search")
    )
    return {
      root,
      paths: found.slice(0, limits.paths),
      total: found.length,
      truncated: found.length > limits.paths
    }
  })

const skipped = new Set([".git", ".jj", "node_modules"])

const compile = (input: GrepInput): Effect.Effect<RegExp, ToolError> =>
  Effect.try({
    try: () => new RegExp(input.pattern, input.ignoreCase === true ? "i" : ""),
    catch: () => new ToolError({ code: "invalid_input", message: `The pattern does not parse: ${input.pattern}` })
  })

const portableSearch = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  input: GrepInput & { readonly root: string }
): Effect.Effect<GrepOutput, ToolError> =>
  Effect.gen(function*() {
    const pattern = yield* compile(input)
    const max = positive(input.maxMatches, limits.matches)
    const matches: Array<{ path: string; line: number; text: string }> = []
    let filesSearched = 0
    let truncated = false
    const compiled = input.glob === undefined ? undefined : Glob.make(input.glob)
    const visit = (directory: string, relative: string): Effect.Effect<void> =>
      Effect.gen(function*() {
        if (truncated) return
        const entries = yield* Effect.orElseSucceed(fs.readDirectoryEntries(directory), () => [])
        const sorted = [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        for (const entry of sorted) {
          if (truncated) return
          if (skipped.has(entry.name)) continue
          const full = path.join(directory, entry.name)
          const rel = relative === "" ? entry.name : `${relative}/${entry.name}`
          if (entry.type === "Directory") {
            yield* visit(full, rel)
            continue
          }
          if (entry.type !== "File") continue
          if (compiled !== undefined && !Glob.match(compiled, rel)) continue
          const info = yield* Effect.option(fs.stat(full))
          if (Option.isNone(info) || Number(info.value.size) > limits.fileBytes) continue
          const text = yield* Effect.option(fs.readFileString(full))
          if (Option.isNone(text) || text.value.includes("\u0000")) continue
          filesSearched++
          const lines = text.value.split("\n")
          for (let index = 0; index < lines.length; index++) {
            const line = lines[index]!
            if (!pattern.test(line)) continue
            if (matches.length >= max) {
              truncated = true
              return
            }
            matches.push({ path: rel, line: index + 1, text: line.replace(/\r$/, "").slice(0, limits.lineChars) })
          }
        }
      })
    const info = yield* Effect.mapError(fs.stat(input.root), (error) => platform(error, input.root, "search"))
    if (info.type !== "Directory") return yield* fail("not_a_directory", `${input.root} is not a directory.`, input.root)
    yield* visit(input.root, "")
    return { root: input.root, matches, filesSearched, truncated }
  })

const grepImpl = (input: GrepInput): Effect.Effect<GrepOutput, ToolError, Fs> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* resolve(path, input.root ?? ".")
    yield* ask(`fs:read:${root}`)
    yield* compile(input)
    const search = yield* Search
    return yield* (search === undefined
      ? portableSearch(fs, path, { ...input, root })
      : search.search({ ...input, root }))
  })

// -----------------------------------------------------------------------------
// Shell
// -----------------------------------------------------------------------------

const runCommand = (
  input: typeof CommandInput.Type
): Effect.Effect<typeof CommandOutput.Type, ToolError, ChildProcessSpawner> =>
  Effect.gen(function*() {
    if (input.command.trim() === "") return yield* fail("invalid_input", "The command must not be empty.")
    const env = Text.childEnvironment(Text.hostEnvironment(), { inherit: input.inherit, env: input.env })
    const request = commandResource({ command: "sh", args: ["-c", input.command], env, extendEnv: false }, input.cwd)
    yield* ask(`proc:spawn:${request.resource}`)
    const timeoutMs = positive(input.timeoutMs, limits.commandMs)
    const stdout = Text.capture(limits.outputBytes)
    const stderr = Text.capture(limits.outputBytes)
    const run = Effect.gen(function*() {
      const child = yield* ChildProcess.make("sh", ["-c", input.command], {
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        env,
        extendEnv: false,
        forceKillAfter: 2000
      }).pipe(Effect.mapError(() => new ToolError({ code: "spawn_failed", message: "The command could not be started." })))
      const drain = (stream: Stream.Stream<Uint8Array, unknown>, sink: Text.Capture) =>
        Effect.ignore(Stream.runForEach(stream, (chunk) => Effect.sync(() => sink.push(chunk))))
      const [, , code] = yield* Effect.all([
        drain(child.stdout, stdout),
        drain(child.stderr, stderr),
        Effect.orElseSucceed(child.exitCode, () => -1)
      ], { concurrency: "unbounded" })
      return Number(code)
    }).pipe(Effect.scoped)
    const exit = yield* Effect.timeoutOption(run, timeoutMs)
    return {
      exitCode: Option.isSome(exit) ? exit.value : -1,
      stdout: stdout.text(),
      stderr: stderr.text(),
      stdoutTruncated: stdout.truncated(),
      stderrTruncated: stderr.truncated(),
      timedOut: Option.isNone(exit)
    }
  })

const bashImpl = runCommand

const testImpl = (
  input: typeof CommandInput.Type
): Effect.Effect<typeof TestOutput.Type, ToolError, ChildProcessSpawner> =>
  Effect.map(runCommand(input), (result) => ({ ...result, passed: result.exitCode === 0 && !result.timedOut }))

// -----------------------------------------------------------------------------
// HTTP and the web
// -----------------------------------------------------------------------------

const urlOf = (given: string): Effect.Effect<{ readonly url: URL; readonly resource: string }, ToolError> =>
  Effect.gen(function*() {
    let url: URL
    try {
      url = new URL(given)
    } catch {
      return yield* fail("invalid_input", `Not an absolute URL: ${given}`)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return yield* fail("invalid_input", `Only http and https URLs are fetched, not ${url.protocol}`)
    }
    const hostname = url.hostname.toLowerCase().replace(/(.)\.$/, "$1")
    return {
      url,
      resource: `${url.protocol}//${hostname}${url.port === "" ? "" : `:${url.port}`}${url.pathname}${url.search}`
    }
  })

const request = (
  method: "GET" | "POST",
  input: {
    readonly url: string
    readonly headers?: Readonly<Record<string, string>> | undefined
    readonly body?: string | undefined
    readonly contentType?: string | undefined
  }
): Effect.Effect<typeof HttpOutput.Type, ToolError, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const target = yield* urlOf(input.url)
    yield* ask(`${method === "GET" ? "net:get" : "net:post"}:${target.resource}`)
    const client = yield* HttpClient.HttpClient
    const body = Text.capture(limits.bodyBytes)
    const options = {
      headers: { ...input.headers },
      ...(method === "POST" ? { body: HttpBody.text(input.body ?? "", input.contentType ?? "text/plain") } : {})
    }
    const exchange = Effect.gen(function*() {
      const response = yield* (method === "GET" ? client.get(target.url, options) : client.post(target.url, options))
      // Reading stops at the bound: a body of gigabytes costs the bound.
      yield* Stream.runForEach(
        Stream.takeWhile(response.stream, () => body.total() <= limits.bodyBytes),
        (chunk) => Effect.sync(() => body.push(chunk))
      )
      return response
    })
    const response = yield* exchange.pipe(
      Effect.timeoutOrElse({
        duration: limits.requestMs,
        orElse: () => fail("timeout", `${target.url.href} did not answer within ${limits.requestMs} milliseconds.`)
      }),
      Effect.mapError((error) =>
        error instanceof ToolError
          ? error
          : new ToolError({ code: "network_failed", message: `The request to ${target.url.href} failed.` })
      )
    )
    const contentType = response.headers["content-type"]
    return {
      url: target.url.href,
      status: response.status,
      ...(contentType === undefined ? {} : { contentType }),
      body: body.text(),
      truncated: body.truncated()
    }
  })

const fetchImpl = (input: typeof FetchInput.Type) => request("GET", input)
const postImpl = (input: typeof PostInput.Type) => request("POST", input)

const webfetchImpl = (
  input: typeof WebFetchInput.Type
): Effect.Effect<typeof WebFetchOutput.Type, ToolError, HttpClient.HttpClient> =>
  Effect.map(request("GET", { url: input.url, headers: { accept: "text/html, text/plain;q=0.9, */*;q=0.1" } }), (response) => {
    const html = (response.contentType ?? "").includes("html") || /^\s*<(!doctype|html)/i.test(response.body)
    const reduced = html ? Text.htmlToText(response.body) : { title: undefined, text: response.body }
    return {
      url: response.url,
      status: response.status,
      ...(reduced.title === undefined ? {} : { title: reduced.title }),
      text: reduced.text,
      truncated: response.truncated
    }
  })

const websearchImpl = (
  input: typeof WebSearchInput.Type
): Effect.Effect<typeof WebSearchOutput.Type, ToolError> =>
  Effect.gen(function*() {
    if (input.query.trim() === "") return yield* fail("invalid_input", "The query must not be empty.")
    const provider = yield* WebSearch
    if (provider === undefined) {
      return yield* fail("unavailable", "No web search provider is installed. Provide Experimental.Tools.layerWebSearch.")
    }
    const max = positive(input.limit, 10)
    const found = yield* provider.search({ ...input, limit: max })
    return { results: found.results.slice(0, max), truncated: found.truncated || found.results.length > max }
  })

// -----------------------------------------------------------------------------
// Language servers
// -----------------------------------------------------------------------------

const server = Effect.flatMap(
  Effect.service(LanguageServer),
  (service) =>
    service === undefined
      ? fail("unavailable", "No language server is installed. Provide Experimental.Tools.layerLanguageServer.")
      : Effect.succeed(service)
)

const lspCap = <A>(items: ReadonlyArray<A>) => ({
  items: items.slice(0, limits.matches),
  truncated: items.length > limits.matches
})

const lspPath = (given: string) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const at = yield* resolve(path, given)
    yield* ask(`fs:read:${at}`)
    return at
  })

const definitionImpl = (input: typeof LspPosition.Type) =>
  Effect.gen(function*() {
    const at = yield* lspPath(input.path)
    const found = lspCap(yield* (yield* server).definition({ ...input, path: at }))
    return { locations: found.items, truncated: found.truncated }
  })
const referencesImpl = (input: typeof LspPosition.Type) =>
  Effect.gen(function*() {
    const at = yield* lspPath(input.path)
    const found = lspCap(yield* (yield* server).references({ ...input, path: at }))
    return { locations: found.items, truncated: found.truncated }
  })
const hoverImpl = (input: typeof LspPosition.Type) =>
  Effect.gen(function*() {
    const at = yield* lspPath(input.path)
    const text = yield* (yield* server).hover({ ...input, path: at })
    return { text: Text.cap(text, limits.readChars).text }
  })
const diagnosticsImpl = (input: typeof LspFile.Type) =>
  Effect.gen(function*() {
    const at = yield* lspPath(input.path)
    const found = lspCap(yield* (yield* server).diagnostics(at))
    return { diagnostics: found.items, truncated: found.truncated }
  })
const symbolsImpl = (input: typeof LspFile.Type) =>
  Effect.gen(function*() {
    const at = yield* lspPath(input.path)
    const found = lspCap(yield* (yield* server).symbols(at))
    return { symbols: found.items, truncated: found.truncated }
  })

// -----------------------------------------------------------------------------
// Declarations
// -----------------------------------------------------------------------------

type Access = "read" | "write" | "spawn" | "net-read" | "net-write"

const declare = <
  const Name extends string,
  P extends Schema.Top,
  S extends Schema.Top
>(name: Name, options: {
  readonly description: string
  readonly parameters: P
  readonly success: S
  readonly access: Access
  readonly idempotent: boolean
}) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: options.success,
    failure: ToolError,
    // A failure reaches the model as a result it can act on.
    failureMode: "return"
  })
    .annotate(Tool.Readonly, options.access === "read" || options.access === "net-read")
    .annotate(Tool.Destructive, options.access === "write" || options.access === "spawn")
    .annotate(Tool.Idempotent, options.idempotent)
    .annotate(Tool.OpenWorld, options.access.startsWith("net") || options.access === "spawn")

/**
 * The capability each tool asks for, by name.
 *
 * @category declarations
 * @since 0.0.13
 */
export const capabilities = {
  read: ["fs:read"],
  write: ["fs:write"],
  edit: ["fs:read", "fs:write"],
  applyPatch: ["fs:read", "fs:write"],
  ls: ["fs:read"],
  glob: ["fs:read"],
  grep: ["fs:read"],
  bash: ["proc:spawn"],
  test: ["proc:spawn"],
  fetch: ["net:get"],
  post: ["net:post"],
  webfetch: ["net:get"],
  websearch: ["net:get"],
  definition: ["fs:read"],
  references: ["fs:read"],
  hover: ["fs:read"],
  diagnostics: ["fs:read"],
  symbols: ["fs:read"]
} as const satisfies Record<string, ReadonlyArray<Capability.Action>>

/**
 * The tool declarations, by name. Each is an Effect `Tool` whose failure is
 * {@link ToolError}, returned to the model rather than raised.
 *
 * @category declarations
 * @since 0.0.13
 */
export const declarations = {
  read: declare("read", {
    description: "Read a text file. Lines keep their terminators, so the content is a valid edit anchor.",
    parameters: ReadInput,
    success: ReadOutput,
    access: "read",
    idempotent: true
  }),
  write: declare("write", {
    description: "Write a whole file, creating it and its directories when missing.",
    parameters: WriteInput,
    success: WriteOutput,
    access: "write",
    idempotent: true
  }),
  edit: declare("edit", {
    description: "Replace oldText, which must be in the file exactly once unless replaceAll is set, with newText.",
    parameters: EditInput,
    success: EditOutput,
    access: "write",
    idempotent: false
  }),
  applyPatch: declare("applyPatch", {
    description: "Apply a unified diff. Every file it names changes, or none does.",
    parameters: ApplyPatchInput,
    success: ApplyPatchOutput,
    access: "write",
    idempotent: false
  }),
  ls: declare("ls", {
    description: "List a directory's entries, sorted by name.",
    parameters: LsInput,
    success: LsOutput,
    access: "read",
    idempotent: true
  }),
  glob: declare("glob", {
    description: "Find paths matching a glob under root. node_modules, .git and .jj are skipped.",
    parameters: GlobInput,
    success: GlobOutput,
    access: "read",
    idempotent: true
  }),
  grep: declare("grep", {
    description: "Search file contents under root for a regular expression.",
    parameters: GrepInput,
    success: GrepOutput,
    access: "read",
    idempotent: true
  }),
  bash: declare("bash", {
    description: "Run a shell command. A non-zero exit code is a result, not a failure.",
    parameters: CommandInput,
    success: CommandOutput,
    access: "spawn",
    idempotent: false
  }),
  test: declare("test", {
    description: "Run a test command and report whether it passed.",
    parameters: CommandInput,
    success: TestOutput,
    access: "spawn",
    idempotent: false
  }),
  fetch: declare("fetch", {
    description: "HTTP GET a URL. Any status is a result.",
    parameters: FetchInput,
    success: HttpOutput,
    access: "net-read",
    idempotent: true
  }),
  post: declare("post", {
    description: "HTTP POST a body to a URL. Any status is a result.",
    parameters: PostInput,
    success: HttpOutput,
    access: "net-write",
    idempotent: false
  }),
  webfetch: declare("webfetch", {
    description: "Fetch a web page as readable text.",
    parameters: WebFetchInput,
    success: WebFetchOutput,
    access: "net-read",
    idempotent: true
  }),
  websearch: declare("websearch", {
    description: "Search the web.",
    parameters: WebSearchInput,
    success: WebSearchOutput,
    access: "net-read",
    idempotent: true
  }),
  definition: declare("definition", {
    description: "Where the symbol at a position is defined. Lines and characters count from 1.",
    parameters: LspPosition,
    success: LspLocations,
    access: "read",
    idempotent: true
  }),
  references: declare("references", {
    description: "Where the symbol at a position is used.",
    parameters: LspPosition,
    success: LspLocations,
    access: "read",
    idempotent: true
  }),
  hover: declare("hover", {
    description: "The language server's hover text at a position.",
    parameters: LspPosition,
    success: LspHover,
    access: "read",
    idempotent: true
  }),
  diagnostics: declare("diagnostics", {
    description: "The language server's diagnostics for a file.",
    parameters: LspFile,
    success: LspDiagnostics,
    access: "read",
    idempotent: true
  }),
  symbols: declare("symbols", {
    description: "The symbols a file declares.",
    parameters: LspFile,
    success: LspSymbols,
    access: "read",
    idempotent: true
  })
}

type Declarations = typeof declarations

// -----------------------------------------------------------------------------
// Direct calls
// -----------------------------------------------------------------------------

// A direct call decodes its input with the tool's schema, as a model's call
// is decoded, and inside a workflow is a recorded step.
const direct = <Name extends keyof Declarations, I, A, R>(
  name: Name,
  impl: (input: I) => Effect.Effect<A, ToolError, R>
) =>
(input: I): Effect.Effect<A, ToolError, R> => {
  const declaration = declarations[name] as unknown as Tool.Any & {
    readonly parametersSchema: Schema.Top
    readonly successSchema: Schema.Top
  }
  const decode = Schema.decodeUnknownEffect(declaration.parametersSchema as Schema.Codec<I, unknown>)
  return Effect.flatMap(
    Effect.mapError(decode(input), (issue) =>
      new ToolError({ code: "invalid_input", message: `The input of ${name} is invalid: ${String(issue)}` })),
    (decoded) =>
      recorded({
        kind: "tool",
        request: [name, input],
        success: declaration.successSchema,
        error: ToolError,
        execute: impl(decoded)
      })
  )
}

/**
 * Reads a text file. `offset` and `limit` choose lines, counting from 1.
 *
 * @category filesystem
 * @since 0.0.13
 */
export const read = direct("read", readImpl)

/**
 * Writes a whole file, creating it and its directories when missing.
 *
 * @category filesystem
 * @since 0.0.13
 */
export const write = direct("write", writeImpl)

/**
 * Replaces `oldText` with `newText`. Fails with `anchor_not_found`,
 * `anchor_ambiguous` or `conflict` rather than guess.
 *
 * @category filesystem
 * @since 0.0.13
 */
export const edit = direct("edit", editImpl)

/**
 * Applies a unified diff to every file it names, or to none.
 *
 * @category filesystem
 * @since 0.0.13
 */
export const applyPatch = direct("applyPatch", applyPatchImpl)

/**
 * Lists a directory.
 *
 * @category filesystem
 * @since 0.0.13
 */
export const ls = direct("ls", lsImpl)

/**
 * Finds paths matching a glob.
 *
 * @category filesystem
 * @since 0.0.13
 */
export const glob = direct("glob", globImpl)

/**
 * Searches file contents with the {@link Search} service in context.
 *
 * @category filesystem
 * @since 0.0.13
 */
export const grep = direct("grep", grepImpl)

/**
 * Runs a shell command with `sh -c` and a small environment.
 *
 * @category shell
 * @since 0.0.13
 */
export const bash = direct("bash", bashImpl)

/**
 * Runs a test command. `passed` is whether it exited 0 in time.
 *
 * @category shell
 * @since 0.0.13
 */
export const test = direct("test", testImpl)

/**
 * HTTP `GET`.
 *
 * @category http
 * @since 0.0.13
 */
export const fetch = direct("fetch", fetchImpl)

/**
 * HTTP `POST`.
 *
 * @category http
 * @since 0.0.13
 */
export const post = direct("post", postImpl)

/**
 * Fetches a web page as readable text.
 *
 * @category web
 * @since 0.0.13
 */
export const webfetch = direct("webfetch", webfetchImpl)

/**
 * Searches the web with the {@link WebSearch} provider in context.
 *
 * @category web
 * @since 0.0.13
 */
export const websearch = direct("websearch", websearchImpl)

/**
 * @category lsp
 * @since 0.0.13
 */
export const definition = direct("definition", definitionImpl)

/**
 * @category lsp
 * @since 0.0.13
 */
export const references = direct("references", referencesImpl)

/**
 * @category lsp
 * @since 0.0.13
 */
export const hover = direct("hover", hoverImpl)

/**
 * @category lsp
 * @since 0.0.13
 */
export const diagnostics = direct("diagnostics", diagnosticsImpl)

/**
 * @category lsp
 * @since 0.0.13
 */
export const symbols = direct("symbols", symbolsImpl)

// -----------------------------------------------------------------------------
// Toolkits
// -----------------------------------------------------------------------------

const impls = {
  read: readImpl,
  write: writeImpl,
  edit: editImpl,
  applyPatch: applyPatchImpl,
  ls: lsImpl,
  glob: globImpl,
  grep: grepImpl,
  bash: bashImpl,
  test: testImpl,
  fetch: fetchImpl,
  post: postImpl,
  webfetch: webfetchImpl,
  websearch: websearchImpl,
  definition: definitionImpl,
  references: referencesImpl,
  hover: hoverImpl,
  diagnostics: diagnosticsImpl,
  symbols: symbolsImpl
} as const

type Impls = typeof impls
type Needs<Name extends keyof Impls> = Effect.Services<ReturnType<Impls[Name]>>

type WithHandlerOf<Names extends keyof Declarations> = Toolkit.WithHandler<{ readonly [N in Names]: Declarations[N] }>

// A toolkit whose handlers are the same functions the direct calls run,
// closed over the services in the caller's context.
const kit = <const Names extends ReadonlyArray<keyof Declarations>>(
  ...names: Names
): Effect.Effect<WithHandlerOf<Names[number]>, never, Needs<Names[number]>> =>
  Effect.gen(function*() {
    const context = yield* Effect.context<Needs<Names[number]>>()
    const toolkit = Toolkit.make(...names.map((name) => declarations[name] as Tool.Any))
    const handlers: Record<string, (input: unknown) => Effect.Effect<unknown, ToolError>> = {}
    for (const name of names) {
      const impl = impls[name] as unknown as (input: unknown) => Effect.Effect<unknown, ToolError, never>
      // The caller's context wins, so its permission store and ceiling apply;
      // the services the toolkit was built with fill in what it lacks.
      handlers[name] = (input) => Effect.updateContext(impl(input), (current) => Context.merge(context, current))
    }
    const dynamicKit = toolkit as unknown as {
      readonly pipe: (fn: unknown) => Effect.Effect<WithHandlerOf<Names[number]>, never, Needs<Names[number]>>
      readonly toHandlers: (h: typeof handlers) => Effect.Effect<Context.Context<never>>
    }
    return yield* dynamicKit.pipe(Effect.provideContext(yield* dynamicKit.toHandlers(handlers)))
  }) as unknown as Effect.Effect<WithHandlerOf<Names[number]>, never, Needs<Names[number]>>

/**
 * `read`, `write`, `edit`, `applyPatch`, `ls`, `glob` and `grep`. Needs
 * `FileSystem` and `Path`.
 *
 * @category toolkits
 * @since 0.0.13
 */
export const filesystem = kit("read", "write", "edit", "applyPatch", "ls", "glob", "grep")

/**
 * `bash` and `test`. Needs `ChildProcessSpawner`.
 *
 * @category toolkits
 * @since 0.0.13
 */
export const shell = kit("bash", "test")

/**
 * `fetch` and `post`. Needs `HttpClient`.
 *
 * @category toolkits
 * @since 0.0.13
 */
export const http = kit("fetch", "post")

/**
 * `webfetch` and `websearch`. Needs `HttpClient`; `websearch` needs a
 * provider from {@link layerWebSearch}.
 *
 * @category toolkits
 * @since 0.0.13
 */
export const web = kit("webfetch", "websearch")

/**
 * `definition`, `references`, `hover`, `diagnostics` and `symbols`. Needs
 * `Path` and a server from {@link layerLanguageServer}.
 *
 * @category toolkits
 * @since 0.0.13
 */
export const lsp = kit("definition", "references", "hover", "diagnostics", "symbols")

/**
 * Every tool above that changes nothing: `read`, `ls`, `glob`, `grep`,
 * `fetch`, `webfetch`, `websearch` and the `lsp` queries. It is a tool set,
 * not a confinement.
 *
 * @category toolkits
 * @since 0.0.13
 */
export const readOnly = kit(
  "read",
  "ls",
  "glob",
  "grep",
  "fetch",
  "webfetch",
  "websearch",
  "definition",
  "references",
  "hover",
  "diagnostics",
  "symbols"
)

/**
 * Searches with ripgrep (`rg`) through the `ChildProcessSpawner` in context.
 * Output is read as JSON lines and bounded like the portable search.
 *
 * @category search
 * @since 0.0.13
 */
export const layerNativeSearch: Layer.Layer<never, never, ChildProcessSpawner> = Layer.effect(
  Search,
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner
    const search = (input: GrepInput & { readonly root: string }): Effect.Effect<GrepOutput, ToolError> =>
      Effect.gen(function*() {
        yield* compile(input)
        const max = positive(input.maxMatches, limits.matches)
        const args = [
          "--json",
          "--no-config",
          "--max-filesize",
          String(limits.fileBytes),
          ...(input.ignoreCase === true ? ["-i"] : []),
          ...(input.glob === undefined ? [] : ["--glob", input.glob]),
          "--glob",
          "!node_modules",
          "--glob",
          "!.jj",
          "-e",
          input.pattern,
          "."
        ]
        const output = Text.capture(16 * 1024 * 1024)
        yield* Effect.gen(function*() {
          const child = yield* ChildProcess.make("rg", args, {
            cwd: input.root,
            env: Text.childEnvironment(Text.hostEnvironment()),
            extendEnv: false
          }).pipe(Effect.mapError(() => new ToolError({ code: "spawn_failed", message: "ripgrep could not be started." })))
          yield* Effect.ignore(Stream.runForEach(child.stdout, (chunk) => Effect.sync(() => output.push(chunk))))
          yield* Effect.ignore(child.exitCode)
        }).pipe(Effect.scoped, Effect.provideService(ChildProcessSpawner, spawner))
        const matches: Array<{ path: string; line: number; text: string }> = []
        const files = new Set<string>()
        let truncated = output.truncated()
        for (const line of output.text().split("\n")) {
          if (line === "") continue
          let event: { readonly type?: unknown; readonly data?: { readonly path?: { readonly text?: unknown }; readonly line_number?: unknown; readonly lines?: { readonly text?: unknown } } }
          try {
            event = JSON.parse(line)
          } catch {
            continue
          }
          if (event.type === "begin") files.add(String(event.data?.path?.text ?? ""))
          if (event.type !== "match") continue
          if (matches.length >= max) {
            truncated = true
            break
          }
          const raw = String(event.data?.path?.text ?? "")
          matches.push({
            path: raw.replace(/^\.\//, ""),
            line: Number(event.data?.line_number ?? 0),
            text: String(event.data?.lines?.text ?? "").replace(/\r?\n$/, "").slice(0, limits.lineChars)
          })
        }
        return { root: input.root, matches, filesSearched: files.size, truncated }
      })
    return { kind: "native" as const, search }
  })
)
