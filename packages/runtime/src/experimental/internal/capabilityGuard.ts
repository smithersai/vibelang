/**
 * The checked versions of the platform services: each operation is turned
 * into a capability, the kernel is asked, and only then does the operation
 * reach the service underneath.
 *
 * @internal
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as EffectFileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as UrlParams from "effect/http/UrlParams"
import type * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type { Action } from "./capability.js"

/**
 * What a checked service says about the operation it asks for.
 */
export interface Asking {
  /** The operation covers everything under the resource. */
  readonly tree?: boolean | undefined
  /** `false` when a secret in the resource is shown as a placeholder. */
  readonly exact?: boolean | undefined
}

/**
 * What a checked service needs from the kernel. `Refusal` is the kernel's
 * structured failure.
 */
export interface Kernel<Refusal> {
  /** Asks every store this service answers to. */
  readonly check: (action: Action, resource: string, asking?: Asking) => Effect.Effect<void, Refusal>
  /** A refusal the service itself decides, before any store is asked. */
  readonly denied: (action: Action, resource: string, reason: string) => Refusal
  /**
   * The refusal of a store whose policy denies the operation outright, or
   * none. It asks nobody and parks nothing.
   */
  readonly vetoed: (action: Action, resource: string) => Refusal | undefined
  readonly message: (refusal: Refusal) => string
  readonly platformError: (options: {
    readonly module: string
    readonly method: string
    readonly pathOrDescriptor: string
    readonly error: Refusal
  }) => PlatformError.PlatformError
}

// Which stores a checked service already asks, itself and through the
// services under it. Keyed by the service and private to this module.
const asked = new WeakMap<object, ReadonlySet<unknown>>()
const nobody: ReadonlySet<unknown> = new Set()

export const askedBy = (service: object): ReadonlySet<unknown> => asked.get(service) ?? nobody

export const withAsked = <S extends object>(service: S, stores: ReadonlySet<unknown>): S => {
  asked.set(service, stores)
  return service
}

type FileAction = "fs:read" | "fs:write"

/**
 * How a path is resolved: the unchecked reads of the file system at the
 * bottom. A guard built inside another guard resolves with these, so
 * working out what a path names does not itself ask the outer guard to read
 * every directory above it. The operation is still asked of both guards.
 */
export interface Resolver {
  readonly realPath: EffectFileSystem.FileSystem["realPath"]
  readonly readLink: EffectFileSystem.FileSystem["readLink"]
  readonly stat: EffectFileSystem.FileSystem["stat"]
  readonly lstat: EffectFileSystem.FileSystem["lstat"]
}

// Keyed by the checked service, and private to this module: holding a
// checked service gives no way to reach the unchecked reads under it.
const resolvers = new WeakMap<object, Resolver>()

export const resolverOf = (fs: EffectFileSystem.FileSystem): Resolver =>
  resolvers.get(fs) ?? { realPath: fs.realPath, readLink: fs.readLink, stat: fs.stat, lstat: fs.lstat }

export const withResolver = <F extends EffectFileSystem.FileSystem>(checked: F, resolver: Resolver): F => {
  resolvers.set(checked, resolver)
  return checked
}

// The refusals of one `glob`. Effect's `glob` skips a directory it may not
// read, which is right for the operating system's refusal and wrong for the
// kernel's: a caller must not take a partial answer for a whole one.
const GlobRefusals = Context.Reference<Array<PlatformError.PlatformError> | undefined>(
  "vibelang/experimental/Capability/GlobRefusals",
  { defaultValue: () => undefined }
)

type Primitives = Parameters<typeof EffectFileSystem.make>[0]

/**
 * A `FileSystem` over checked primitives. Every other member is derived
 * from them, so it is checked too.
 */
export const fileSystem = (primitives: Primitives): EffectFileSystem.FileSystem => {
  const made = EffectFileSystem.make(primitives)
  return {
    ...made,
    glob: (pattern, options) =>
      Effect.suspend(() => {
        const refusals: Array<PlatformError.PlatformError> = []
        return Effect.flatMap(
          Effect.provideService(made.glob(pattern, options), GlobRefusals, refusals),
          (found) => refusals.length === 0 ? Effect.succeed(found) : Effect.fail(refusals[0]!)
        )
      })
  }
}

const separator = /[/\\\0]/

/**
 * The primitives of a checked `FileSystem`.
 *
 * A path is resolved before the kernel is asked: it is made absolute, its
 * `.` and `..` segments are folded, and the symbolic links of every part
 * that exists are followed. The operation then runs on the resolved path,
 * so what was asked is what is touched. An operation on a link itself, such
 * as `remove`, resolves the directory and keeps the last name.
 */
export const fileSystemPrimitives = <Refusal, F extends EffectFileSystem.FileSystem>(
  fs: F,
  resolver: Resolver,
  path: Path.Path,
  kernel: Kernel<Refusal>,
  temporaryDirectory: Option.Option<Effect.Effect<string>>
): Primitives & Pick<F, "access" | "open"> => {
  const refuse = (action: FileAction, method: string, resource: string, reason: string) =>
    kernel.platformError({ module: "FileSystem", method, pathOrDescriptor: resource, error: kernel.denied(action, resource, reason) })

  const ask = (action: FileAction, method: string, resource: string, asking?: Asking) =>
    Effect.mapError(
      kernel.check(action, resource, asking),
      (error) => kernel.platformError({ module: "FileSystem", method, pathOrDescriptor: resource, error })
    )

  // A directory a `glob` was not allowed to list makes its answer partial,
  // so the kernel's refusal is kept for the `glob` to fail with. Only the
  // kernel's: a directory the operating system will not list, or that is
  // not there, is skipped as it is without a guard. A refusal to look at
  // one entry, such as a link that leads out of the tree, is not kept
  // either: the walk does not follow links.
  const kept = <A>(asked: Effect.Effect<A, PlatformError.PlatformError>) =>
    Effect.tapError(asked, (error) => Effect.map(Effect.service(GlobRefusals), (refusals) => void refusals?.push(error)))

  // A tree is asked about twice: its top path, and `<path>/**` for what is
  // inside it. An allow, a ceiling or a person's answer for the directory
  // alone does not reach its contents, and a request for the contents says
  // so in its own text.
  const contents = (resolved: string): string => `${resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`}**`

  const askAbout = (action: FileAction, method: string, resolved: string, asking: Asking | undefined) =>
    asking?.tree === true
      ? Effect.andThen(ask(action, method, resolved, asking), ask(action, method, contents(resolved)))
      : ask(action, method, resolved, asking)

  // The members every `FileSystem` has, typed without the caller's extras.
  const base: EffectFileSystem.FileSystem = fs

  const missing = (current: string): Effect.Effect<Option.Option<string>, PlatformError.PlatformError> =>
    Effect.flatMap(Effect.result(resolver.realPath(current)), (result) =>
      Result.isSuccess(result)
        ? Effect.succeed(Option.some(result.success))
        : result.failure.reason._tag === "NotFound"
        ? Effect.succeed(Option.none())
        : Effect.fail(result.failure))

  // A deny that selects a path as it was written refuses the operation
  // before anything is resolved. So a deny holds for the name its author
  // wrote, whatever that name links to, and an operation refused this way
  // tells nothing about what is on the disk under a denied tree.
  const refuseWritten = (
    actions: ReadonlyArray<FileAction>,
    method: string,
    input: string
  ): Effect.Effect<void, PlatformError.PlatformError> =>
    Effect.suspend(() => {
      const written = path.resolve(input)
      for (const action of actions) {
        const error = kernel.vetoed(action, written)
        if (error !== undefined) {
          return Effect.fail(kernel.platformError({ module: "FileSystem", method, pathOrDescriptor: written, error }))
        }
      }
      return Effect.void
    })

  const resolve = (
    action: FileAction,
    method: string,
    input: string,
    follow: boolean
  ): Effect.Effect<string, PlatformError.PlatformError> =>
    Effect.gen(function*() {
      const absolute = path.resolve(input)
      if (!follow) {
        const parent = path.dirname(absolute)
        if (parent === absolute) return absolute
        return path.join(yield* resolve(action, method, parent, true), path.basename(absolute))
      }
      const tail: Array<string> = []
      let current = absolute
      while (true) {
        const real = yield* missing(current)
        if (Option.isSome(real)) return tail.length === 0 ? real.value : path.join(real.value, ...tail)
        // The name does not resolve. If it is a link, its target is missing
        // or it loops: writing through it would create a file somewhere the
        // kernel was never asked about. Reading through it finds nothing,
        // so a read is asked about the link's own place and left to fail.
        if (action === "fs:write") {
          const link = yield* Effect.result(resolver.readLink(current))
          if (Result.isSuccess(link)) {
            return yield* Effect.fail(refuse(action, method, current, "the path holds a symbolic link that does not resolve"))
          }
        }
        const parent = path.dirname(current)
        if (parent === current) return absolute
        tail.unshift(path.basename(current))
        current = parent
      }
    })

  type Target = readonly [action: FileAction, input: string, follow: boolean, asking?: Asking | undefined]

  // Only a directory is a tree. A file, a name that does not exist yet, and
  // a link an operation acts on as a link are each one path. What cannot be
  // read is taken for a tree.
  const asTree = (target: Target, resolved: string): Effect.Effect<Asking | undefined> =>
    target[3]?.tree !== true
      ? Effect.succeed(target[3])
      : Effect.match(target[2] ? resolver.stat(resolved) : resolver.lstat(resolved), {
        onFailure: (error): Asking | undefined => error.reason._tag === "NotFound" ? undefined : target[3],
        onSuccess: (info): Asking | undefined => info.type === "Directory" ? target[3] : undefined
      })

  // The service underneath is not called, even to build its Effect, until
  // the kernel has allowed the operation.
  const one = <A, R>(
    method: string,
    target: Target,
    use: (resolved: string) => Effect.Effect<A, PlatformError.PlatformError, R>,
    listing = false
  ): Effect.Effect<A, PlatformError.PlatformError, R> => {
    const written = refuseWritten([target[0]], method, target[1])
    return Effect.flatMap(
      Effect.andThen(listing ? kept(written) : written, resolve(target[0], method, target[1], target[2])),
      (resolved) => {
        const asked = Effect.flatMap(asTree(target, resolved), (asking) => askAbout(target[0], method, resolved, asking))
        return Effect.flatMap(listing ? kept(asked) : asked, () => use(resolved))
      }
    )
  }

  // An operation from one path to another. When the first is a tree, the
  // second will hold the same tree, whether or not it exists yet. `also`
  // asks a further action about the first path, as the same kind of thing.
  const several = <A>(
    method: string,
    first: Target,
    second: Target,
    use: (first: string, second: string) => Effect.Effect<A, PlatformError.PlatformError>,
    also: ReadonlyArray<FileAction> = []
  ): Effect.Effect<A, PlatformError.PlatformError> =>
    Effect.gen(function*() {
      yield* refuseWritten([first[0], ...also], method, first[1])
      yield* refuseWritten([second[0]], method, second[1])
      const from = yield* resolve(first[0], method, first[1], first[2])
      const to = yield* resolve(second[0], method, second[1], second[2])
      const moving = yield* asTree(first, from)
      for (const action of [first[0], ...also]) yield* askAbout(action, method, from, moving)
      yield* askAbout(second[0], method, to, moving?.tree === true ? moving : yield* asTree(second, to))
      return yield* use(from, to)
    })

  const read = <A, R>(method: string, input: string, use: (resolved: string) => Effect.Effect<A, PlatformError.PlatformError, R>) =>
    one(method, ["fs:read", input, true], use)
  const write = <A, R>(method: string, input: string, use: (resolved: string) => Effect.Effect<A, PlatformError.PlatformError, R>) =>
    one(method, ["fs:write", input, true], use)

  const tree: Asking = { tree: true }

  // A temporary name is chosen by the host, so the kernel is asked about a
  // template of it, as `mktemp` writes one: `<directory>/<prefix>XXXXXX`.
  // The host joins the prefix onto the directory and the suffix onto the
  // file, so either could carry the name out of the directory: one that
  // holds a separator, and a prefix that is a dot segment, is refused.
  const temporary = <
    A,
    R,
    O extends { readonly directory?: string | undefined; readonly prefix?: string | undefined; readonly suffix?: string | undefined }
  >(
    method: string,
    options: O | undefined,
    use: (options: O) => Effect.Effect<A, PlatformError.PlatformError, R>,
    file = false
  ): Effect.Effect<A, PlatformError.PlatformError, R> =>
    Effect.gen(function*() {
      const prefix = options?.prefix ?? ""
      const suffix = options?.suffix ?? ""
      if (separator.test(prefix) || separator.test(suffix) || prefix === "." || prefix === "..") {
        return yield* Effect.fail(
          refuse(
            "fs:write",
            method,
            `${options?.directory ?? ""}${path.sep}${prefix}XXXXXX${suffix}`,
            "a temporary name's prefix and suffix must not hold a path separator or be a dot segment"
          )
        )
      }
      const requested = options?.directory
      if (requested === undefined && Option.isNone(temporaryDirectory)) {
        return yield* Effect.fail(
          refuse("fs:write", method, "", "the temporary directory is unknown here: pass `directory`, or provide `Experimental.Process`")
        )
      }
      const directory = yield* resolve(
        "fs:write",
        method,
        requested ?? (yield* Option.getOrThrow(temporaryDirectory)),
        true
      )
      const inside = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`
      // A temporary directory is `<prefix>XXXXXX`. A temporary file is a
      // new directory of that name and a file inside it that ends in the
      // suffix, so both are asked about.
      yield* ask("fs:write", method, `${inside}${prefix}XXXXXX`)
      if (file) yield* ask("fs:write", method, `${inside}${prefix}XXXXXX${path.sep}XXXXXXXXXXXX${suffix}`)
      return yield* use({ ...options, directory } as O)
    })

  // A flag outside the platform's list, which only a cast can pass, is
  // taken to read and to write.
  const openActions = (flag: EffectFileSystem.OpenFlag | undefined): ReadonlyArray<FileAction> =>
    flag === undefined || flag === "r"
      ? ["fs:read"]
      : flag === "w" || flag === "wx" || flag === "a" || flag === "ax"
      ? ["fs:write"]
      : ["fs:read", "fs:write"]

  // A recursive listing is walked here, one directory at a time, and does
  // not descend through a symbolic link. The platform's own walk follows
  // one, and would list a directory the kernel was never asked about. A
  // link is listed as a name, as a `glob` lists it.
  const walk = (directory: string, prefix: string): Effect.Effect<Array<string>, PlatformError.PlatformError> =>
    Effect.flatMap(base.readDirectory(directory), (names) =>
      Effect.map(
        Effect.forEach(names, (name) => {
          const shown = prefix === "" ? name : `${prefix}${path.sep}${name}`
          const entry = path.join(directory, name)
          return Effect.flatMap(Effect.result(resolver.lstat(entry)), (info) =>
            Result.isSuccess(info) && info.success.type === "Directory"
              ? Effect.map(walk(entry, shown), (inside) => [shown, ...inside])
              : Effect.succeed([shown]))
        }),
        (lists) => lists.flat()
      ))

  const open: F["open"] = ((input: string, options?: Parameters<F["open"]>[1]) =>
    Effect.gen(function*() {
      const actions = openActions(options?.flag)
      yield* refuseWritten(actions, "open", input)
      const resolved = yield* resolve(
        actions.includes("fs:write") ? "fs:write" : "fs:read",
        "open",
        input,
        options?.noFollow !== true
      )
      for (const action of actions) yield* ask(action, "open", resolved)
      const file = yield* fs.open(resolved, options)
      // A handle that can change the file's mode can do so however it was
      // opened, so that member asks to write.
      const chmod = (file as { readonly chmod?: unknown }).chmod
      if (typeof chmod !== "function") return file
      return Object.create(Object.getPrototypeOf(file), {
        ...Object.getOwnPropertyDescriptors(file),
        chmod: {
          enumerable: true,
          value: (mode: number) =>
            Effect.flatMap(ask("fs:write", "chmod", resolved), () =>
              chmod.call(file, mode) as Effect.Effect<void, PlatformError.PlatformError>)
        }
      })
    })) as F["open"]

  const access: F["access"] = ((input: string, options?: Parameters<F["access"]>[1]) =>
    read("access", input, (resolved) => fs.access(resolved, options))) as F["access"]

  return {
    access,
    // A copy reads everything under its source and writes everything under
    // its destination.
    copy: (from, to, options) =>
      several("copy", ["fs:read", from, true, tree], ["fs:write", to, true, tree], (left, right) => base.copy(left, right, options)),
    copyFile: (from, to) =>
      several("copyFile", ["fs:read", from, true], ["fs:write", to, true], (left, right) => base.copyFile(left, right)),
    chmod: (input, mode) => write("chmod", input, (resolved) => base.chmod(resolved, mode)),
    chown: (input, uid, gid) => write("chown", input, (resolved) => base.chown(resolved, uid, gid)),
    // A hard link is a second name for the same file: whoever may write the
    // new name may write the old file. So the source is asked for write too.
    link: (from, to) =>
      several("link", ["fs:read", from, true], ["fs:write", to, false], (left, right) => base.link(left, right), ["fs:write"]),
    lstat: (input) => one("lstat", ["fs:read", input, false], (resolved) => base.lstat(resolved)),
    // A recursive makeDirectory creates every missing directory above the
    // one it names, so each of those is asked about first.
    makeDirectory: (input, options) =>
      Effect.gen(function*() {
        yield* refuseWritten(["fs:write"], "makeDirectory", input)
        const resolved = yield* resolve("fs:write", "makeDirectory", input, true)
        if (options?.recursive === true) {
          const created: Array<string> = []
          let parent = path.dirname(resolved)
          while (path.dirname(parent) !== parent && Option.isNone(yield* missing(parent))) {
            created.unshift(parent)
            parent = path.dirname(parent)
          }
          for (const directory of created) yield* ask("fs:write", "makeDirectory", directory)
        }
        yield* ask("fs:write", "makeDirectory", resolved)
        return yield* base.makeDirectory(resolved, options)
      }),
    makeTempDirectory: (options) => temporary("makeTempDirectory", options, (checked) => base.makeTempDirectory(checked)),
    makeTempDirectoryScoped: (options) =>
      temporary("makeTempDirectoryScoped", options, (checked): Effect.Effect<string, PlatformError.PlatformError, Scope.Scope> =>
        base.makeTempDirectoryScoped(checked)),
    makeTempFile: (options) => temporary("makeTempFile", options, (checked) => base.makeTempFile(checked), true),
    makeTempFileScoped: (options) =>
      temporary("makeTempFileScoped", options, (checked): Effect.Effect<string, PlatformError.PlatformError, Scope.Scope> =>
        base.makeTempFileScoped(checked), true),
    open,
    readDirectory: (input, options) =>
      one(
        "readDirectory",
        ["fs:read", input, true, options?.recursive === true ? tree : undefined],
        (resolved) => options?.recursive === true ? walk(resolved, "") : base.readDirectory(resolved, options),
        true
      ),
    readDirectoryEntries: (input) =>
      one("readDirectoryEntries", ["fs:read", input, true], (resolved) => base.readDirectoryEntries(resolved), true),
    readFile: (input) => read("readFile", input, (resolved) => base.readFile(resolved)),
    readLink: (input) => one("readLink", ["fs:read", input, false], (resolved) => base.readLink(resolved)),
    realPath: (input) => read("realPath", input, (resolved) => base.realPath(resolved)),
    remove: (input, options) =>
      one(
        "remove",
        ["fs:write", input, false, options?.recursive === true ? tree : undefined],
        (resolved) => base.remove(resolved, options)
      ),
    // A rename moves everything under the old name, and what it moves can
    // then be read at the new one: it reads what it moves.
    rename: (from, to) =>
      several(
        "rename",
        ["fs:write", from, false, tree],
        ["fs:write", to, false, tree],
        (left, right) => base.rename(left, right),
        ["fs:read"]
      ),
    stat: (input) => read("stat", input, (resolved) => base.stat(resolved)),
    // The link's own place is written. Its target is only text here: reading
    // through the link later is checked against where it leads.
    symlink: (target, input) => one("symlink", ["fs:write", input, false], (resolved) => base.symlink(target, resolved)),
    truncate: (input, length) => write("truncate", input, (resolved) => base.truncate(resolved, length)),
    utimes: (input, atime, mtime) => write("utimes", input, (resolved) => base.utimes(resolved, atime, mtime)),
    // A recursive watch reports every name under the directory.
    watch: (input, options) =>
      Stream.unwrap(one(
        "watch",
        ["fs:read", input, true, options?.recursive === true ? tree : undefined],
        (resolved) => Effect.succeed(base.watch(resolved, options))
      )),
    writeFile: (input, data, options) => write("writeFile", input, (resolved) => base.writeFile(resolved, data, options))
  }
}

/**
 * The text a request's destination is asked about: scheme, host, port, path
 * and query. The host is lower case with no trailing dot. User info and the
 * fragment are left out, so `https://api.example.com@evil.example/` is asked
 * about as `https://evil.example/`. A `Redacted` query parameter is a
 * secret: it is shown as a placeholder, and `exact` is then `false`.
 *
 * Only an `http:` or `https:` URL has one. Some platforms' `fetch` reads a
 * local file for `file://host/path`, which is not a network request, and a
 * `net` grant must not read a file.
 */
export const urlResource = (
  request: HttpClientRequest.HttpClientRequest
): { readonly resource: string; readonly exact: boolean } | undefined => {
  const secret = request.urlParams.params.some(([, value]) => typeof value !== "string")
  const shown = secret
    ? HttpClientRequest.makeWith(
      request.method,
      request.url,
      UrlParams.make(request.urlParams.params.map(([name, value]) => [name, typeof value === "string" ? value : "<redacted>"])),
      request.hash,
      request.headers,
      request.body
    )
    : request
  const parsed = HttpClientRequest.toUrl(shown)
  if (Option.isNone(parsed)) return undefined
  const url = parsed.value
  if (url.host === "" || (url.protocol !== "http:" && url.protocol !== "https:")) return undefined
  const hostname = url.hostname.toLowerCase().replace(/(.)\.$/, "$1")
  return {
    // Escapes are left as the request has them. The matcher reads a
    // pattern and a resource one way, once.
    resource: `${url.protocol}//${hostname}${url.port === "" ? "" : `:${url.port}`}${url.pathname}${url.search}`,
    exact: !secret
  }
}

// The members of a `RequestInit` the Fetch standard defines. A platform's
// own members can send a request somewhere its URL does not say: Bun reads
// `proxy` and `unix`, and undici reads `dispatcher`.
const fetchMembers: ReadonlySet<string> = new Set([
  "body",
  "cache",
  "credentials",
  "duplex",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "priority",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "window"
])

const foreignMembers = (init: globalThis.RequestInit | undefined): ReadonlyArray<string> =>
  init === undefined
    ? []
    : Object.keys(init).filter((name) => !fetchMembers.has(name) && (init as Record<string, unknown>)[name] !== undefined).sort()

/**
 * A checked `HttpClient`. A `GET` or `HEAD` asks `net:get`, and every other
 * method asks `net:post`. The client underneath is told not to follow
 * redirects, and this one follows them itself, so every hop is asked about
 * before it is requested.
 */
export const httpClient = <Refusal>(client: HttpClient.HttpClient, kernel: Kernel<Refusal>): HttpClient.HttpClient => {
  const transport = (request: HttpClientRequest.HttpClientRequest, error: Refusal) =>
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request, description: kernel.message(error), cause: error })
    })
  const guarded = HttpClient.transform(client, (effect, request) => {
    const action: Action = request.method === "GET" || request.method === "HEAD" ? "net:get" : "net:post"
    const destination = urlResource(request)
    if (destination === undefined) {
      return Effect.fail(
        transport(request, kernel.denied(action, request.url, "the request needs an absolute http or https URL with a host"))
      )
    }
    return Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (provided) => {
      // The caller's `RequestInit` is read once, here: what is checked is
      // what the client underneath is given.
      const init = { ...Option.getOrUndefined(provided) }
      const foreign = foreignMembers(init)
      if (foreign.length > 0) {
        return Effect.fail(
          transport(
            request,
            kernel.denied(
              action,
              destination.resource,
              `the request's RequestInit holds ${foreign.join(", ")}: a member outside the Fetch standard can send a request to another endpoint`
            )
          )
        )
      }
      return Effect.andThen(
        Effect.mapError(
          kernel.check(action, destination.resource, { exact: destination.exact }),
          (error) => transport(request, error)
        ),
        Effect.provideService(effect, FetchHttpClient.RequestInit, { ...init, redirect: "manual" })
      )
    })
  })
  const followed = HttpClient.followRedirects(guarded)
  // A caller that asked for redirects to be an error gets one, as from the
  // client underneath, which is told `manual` and so would not raise it.
  const refusedRedirect = HttpClient.transformResponse(guarded, (response) =>
    Effect.flatMap(response, (received) =>
      received.status >= 300 && received.status < 400 && received.headers.location !== undefined
        ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request: received.request,
              description: "the response is a redirect, and the request asked for a redirect to be an error"
            })
          })
        )
        : Effect.succeed(received)))
  // A caller that asked for manual redirects gets each response as it is.
  return HttpClient.makeWith(
    (request) =>
      Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (init) => {
        const redirect = Option.isSome(init) ? init.value.redirect : undefined
        return redirect === "manual"
          ? guarded.postprocess(request)
          : redirect === "error"
          ? refusedRedirect.postprocess(request)
          : followed.postprocess(request)
      }),
    guarded.preprocess
  )
}

const safeWord = /^[A-Za-z0-9_@%+=:,./-]+$/

const quote = (token: string): string => token !== "" && safeWord.test(token) ? token : `'${token.replaceAll("'", `'\\''`)}'`

const shellControl = /[;&|`$<>()\n\r]/
const harmlessRedirect = /(^|\s)(?:\d*>&\d+|\d*>[ \t]*\/dev\/null)(?=\s|$)/g

/**
 * What decides how one command runs.
 */
export interface CommandLine {
  readonly command: string
  readonly args: ReadonlyArray<ChildProcess.StandardCommand["args"][number]>
  readonly shell?: boolean | string | undefined
  readonly env?: Record<string, unknown> | undefined
  readonly extendEnv?: boolean | undefined
}

const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/

// A variable's name as a word of the request. A name `env` would read as
// one of its flags, such as `-u`, is quoted, so it can only be a name.
const variable = (name: string): string => variableName.test(name) ? name : `'${name.replaceAll("'", `'\\''`)}'`

/**
 * The text one command is asked about: its command line, quoted as a POSIX
 * shell would need, behind what changes how it runs.
 *
 * - `env` and the names it sets: `env A B -- `. An environment that replaces
 *   the inherited one is `env -i`, and a name it removes is `-u NAME`.
 * - `cwd DIR -- ` for a working directory outside the workspace.
 *
 * So a grant for `npm *` does not cover `env NODE_OPTIONS -- npm test`. A
 * command run through a shell is shown as the shell sees it. A `Redacted`
 * word is a secret: it is shown as the bare placeholder `<redacted>`, which
 * a quoted argument can never spell, and `exact` is then `false`.
 */
export const commandResource = (
  command: CommandLine,
  directory: string | undefined
): { readonly resource: string; readonly exact: boolean } => {
  type Word = CommandLine["args"][number]
  const exact = command.args.every((value) => typeof value === "string")
  const shell = command.shell
  const plain = (value: Word): string => typeof value === "string" ? value : "<redacted>"
  const quoted = (value: Word): string => typeof value === "string" ? quote(value) : "<redacted>"
  const raw = [command.command, ...command.args.map(plain)].join(" ")
  const line = shell === undefined || shell === false
    ? [quote(command.command), ...command.args.map(quoted)].join(" ")
    : shell === true
    ? shellControl.test(raw.replace(harmlessRedirect, "$1")) ? `sh -c ${quote(raw)}` : raw
    : `${quote(shell)} -c ${quote(raw)}`
  const environment = command.env
  const entries = Object.entries(environment ?? {})
  const set = entries.filter(([, value]) => value !== undefined).map(([name]) => variable(name)).sort()
  const removed = entries.filter(([, value]) => value === undefined).map(([name]) => `-u ${variable(name)}`).sort()
  const replaces = environment !== undefined && command.extendEnv !== true
  const words = [...(replaces ? ["-i"] : removed), ...set]
  const withEnvironment = words.length === 0 ? line : `env ${words.join(" ")} -- ${line}`
  return {
    resource: directory === undefined ? withEnvironment : `cwd ${quote(directory)} -- ${withEnvironment}`,
    exact
  }
}

// A copy of a command that its caller can no longer change. A request
// shows a person one command line, and may wait a long time for an answer:
// the command that then runs is the one that was shown.
const snapshot = <C extends ChildProcess.Command>(command: C): C => {
  const copy: C = Object.assign(Object.create(Object.getPrototypeOf(command)), command)
  if (command._tag === "StandardCommand") {
    const environment = command.options.env
    return Object.assign(copy, {
      args: Object.freeze([...command.args]),
      options: Object.freeze({
        ...command.options,
        ...(environment === undefined ? {} : { env: Object.freeze({ ...environment }) })
      })
    })
  }
  return Object.assign(copy, {
    left: snapshot(command.left),
    right: snapshot(command.right),
    options: Object.freeze({ ...command.options })
  })
}

const stages = (command: ChildProcess.Command): ReadonlyArray<ChildProcess.StandardCommand> =>
  command._tag === "StandardCommand" ? [command] : [...stages(command.left), ...stages(command.right)]

/**
 * Where a guard's commands run, and how it finds out.
 */
export interface Where {
  readonly path: Path.Path
  readonly workspace: string | undefined
  readonly realPath: Option.Option<Resolver["realPath"]>
}

// The directory a command's request names, or none when the command runs
// inside the workspace. The directory is the one the process will really be
// in: a relative one is taken from the program's own directory, as a
// spawner takes it, and symbolic links are followed. A directory that
// cannot be resolved stays in the request. With no workspace, a command
// that names no directory is asked about without one.
const location = (where: Where, named: string | undefined): Effect.Effect<string | undefined> => {
  if (named === undefined && where.workspace === undefined) return Effect.succeed(undefined)
  const workspace = where.workspace
  const inside = (directory: string): boolean => {
    if (workspace === undefined) return false
    const relative = where.path.relative(workspace, directory)
    return relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${where.path.sep}`) && !where.path.isAbsolute(relative))
  }
  const lexical = where.path.resolve(named ?? ".")
  // With no file system to follow links with, a directory cannot be shown
  // to be inside the workspace, so it stays in the request.
  if (Option.isNone(where.realPath)) return Effect.succeed(lexical)
  return Effect.match(where.realPath.value(lexical), {
    onFailure: () => lexical,
    onSuccess: (directory) => inside(directory) ? undefined : directory
  })
}

/**
 * A checked `ChildProcessSpawner`. Every stage of a pipeline asks
 * `proc:spawn` before any stage starts.
 */
export const childProcessSpawner = <Refusal>(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  kernel: Kernel<Refusal>,
  where: Where
): ChildProcessSpawner.ChildProcessSpawner["Service"] =>
  ChildProcessSpawner.make((given) => {
    const command = snapshot(given)
    return Effect.flatMap(
      Effect.forEach(stages(command), (stage) =>
        Effect.flatMap(Effect.suspend(() => location(where, stage.options.cwd)), (directory) => {
          const request = commandResource({
            command: stage.command,
            args: stage.args,
            shell: stage.options.shell,
            env: stage.options.env,
            extendEnv: stage.options.extendEnv
          }, directory)
          return Effect.mapError(
            kernel.check("proc:spawn", request.resource, { exact: request.exact }),
            (error) => kernel.platformError({ module: "ChildProcessSpawner", method: "spawn", pathOrDescriptor: request.resource, error })
          )
        }), { discard: true }),
      () => spawner.spawn(command)
    )
  })

/**
 * A checked run of one command whose output goes to the program's own
 * terminal: it asks `proc:spawn` as a spawner does. Its failure type is
 * `Error`, so a refusal is the kernel's own error.
 */
export const inheritedRunner = <Refusal extends Error, Runner extends {
  readonly runInherited: (
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly cwd: string; readonly shell?: boolean | undefined }
  ) => Effect.Effect<number | null, Error>
}>(runner: Runner, kernel: Kernel<Refusal>, where: Where): Runner => ({
  ...runner,
  runInherited: (command, given, settings) => {
    // The caller's words and options are copied once: the command that
    // runs is the one that was asked about.
    const args = Object.freeze([...given])
    const options = Object.freeze({ ...settings })
    return Effect.flatMap(
      // Where the program is standing is read when the command runs.
      Effect.flatMap(Effect.suspend(() => location(where, options.cwd)), (directory) => {
        const request = commandResource({ command, args, shell: options.shell }, directory)
        return kernel.check("proc:spawn", request.resource, { exact: request.exact })
      }),
      () => runner.runInherited(command, args, options)
    )
  }
})
