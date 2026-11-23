import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import fc from "fast-check"
import { Cause, Effect, Exit, Fiber, FileSystem, Layer, Option, PlatformError, Redacted, Stream } from "effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as ChildProcess from "effect/process/ChildProcess"
import { ChildProcessSpawner, make as makeSpawner } from "effect/process/ChildProcessSpawner"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { Capability, ChildProcess as ExperimentalChildProcess, FileSystem as ExperimentalFileSystem } from "vibelang-runtime/experimental"
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { anyPattern, modelEvaluate, modelMatches } from "./fixtures/capability-model.ts"

const command = "bun test tests/capability-guard.test.ts"

// A workspace and a directory beside it, with a secret the workspace must
// not reach. Both are real paths, as the guard asks about real paths.
let base = ""
let root = ""
let outside = ""
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-capability-")))
  root = join(base, "workspace")
  outside = join(base, "outside")
  mkdirSync(join(root, "docs"), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(root, "README.md"), "hello")
  writeFileSync(join(root, "docs", "guide.md"), "guide")
  writeFileSync(join(outside, "secret.txt"), "secret")
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

type Platform =
  | FileSystem.FileSystem
  | ChildProcessSpawner
  | HttpClient.HttpClient
  | ExperimentalFileSystem.FileSystem
  | ExperimentalChildProcess.ChildProcess
const platform = Layer.mergeAll(NodeServices.layer, ExperimentalNodeServices.layer, FetchHttpClient.layer)

// Runs a program under a guard, the guard under the real platform services
// or under the ones a test gives it.
const guarded = <A, E>(
  options: Capability.GuardOptions,
  program: Effect.Effect<A, E, Platform>,
  under: Layer.Layer<Platform> = platform
) =>
  Effect.runPromise(
    Effect.scoped(Effect.provide(Effect.provide(program, Capability.guard(options)), under)) as Effect.Effect<A, E>
  )

// The platform with a file system that refuses to list one directory, as
// the operating system refuses a directory the user may not read. The fault
// is injected, because a superuser is refused by no file mode.
const unlistable = (directory: string): Layer.Layer<Platform> =>
  Layer.provideMerge(
    Layer.effect(
      FileSystem.FileSystem,
      Effect.map(Effect.service(FileSystem.FileSystem), (fs): FileSystem.FileSystem => {
        const refuse = <A>(method: string, path: string, listed: Effect.Effect<A, PlatformError.PlatformError>) =>
          path === directory
            ? Effect.fail(PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method,
              pathOrDescriptor: path,
              cause: new Error("EACCES")
            }))
            : listed
        return {
          ...fs,
          readDirectory: (path, options) => refuse("readDirectory", path, fs.readDirectory(path, options)),
          readDirectoryEntries: (path) => refuse("readDirectoryEntries", path, fs.readDirectoryEntries(path))
        }
      })
    ),
    platform
  )

const fileSystem = Effect.service(FileSystem.FileSystem)
const refusal = (error: PlatformError.PlatformError | HttpClientError.HttpClientError) => ({
  required: Option.getOrUndefined(Capability.required(error)),
  denied: Option.getOrUndefined(Capability.denied(error))
})

test("VIP-58's example: the read succeeds and the write fails, because no rule allows fs:write", async () => {
  const result = await guarded({ allow: [`fs:read:${root}/**`], workspace: root }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const readme = yield* fs.readFileString(join(root, "README.md"))
    const error = yield* Effect.flip(fs.writeFileString(join(root, "out.txt"), readme))
    return { readme, error }
  }))
  expect(result.readme).toBe("hello")
  expect(PlatformError.isPlatformError(result.error)).toBe(true)
  expect(result.error.reason._tag).toBe("PermissionDenied")
  expect(refusal(result.error)).toEqual({
    required: new Capability.PermissionRequired({
      requestId: "permission-1",
      capability: Capability.make("fs:write", join(root, "out.txt")),
      tier: "compensable"
    }),
    denied: undefined
  })
  expect(existsSync(join(root, "out.txt"))).toBe(false)
})

test("a deny vetoes an allowed write, and an allowed write reaches the disk", async () => {
  const result = await guarded({ allow: [`fs:*:${root}/**`], deny: [`fs:*:${root}/.env`] }, Effect.gen(function*() {
    const fs = yield* fileSystem
    yield* fs.writeFileString(join(root, "out.txt"), "written")
    return {
      env: yield* Effect.flip(fs.writeFileString(join(root, ".env"), "TOKEN=1")),
      read: yield* Effect.flip(fs.readFileString(join(root, ".env")))
    }
  }))
  expect(readFileSync(join(root, "out.txt"), "utf8")).toBe("written")
  expect(existsSync(join(root, ".env"))).toBe(false)
  expect(refusal(result.env).denied?.reason).toBe("denied by permission policy")
  expect(refusal(result.read).denied?.capability).toEqual(Capability.make("fs:read", join(root, ".env")))
})

test("a path is asked about as what it resolves to, not as what it was written as", async () => {
  symlinkSync(outside, join(root, "link"))
  symlinkSync(join(outside, "new.txt"), join(root, "dangling"))
  const result = await guarded({ allow: [`fs:*:${root}/**`] }, Effect.gen(function*() {
    const fs = yield* fileSystem
    return {
      // The text is inside the workspace. The file is not.
      throughLink: yield* Effect.flip(fs.readFileString(join(root, "link", "secret.txt"))),
      writeThroughLink: yield* Effect.flip(fs.writeFileString(join(root, "link", "planted.txt"), "x")),
      dotDot: yield* Effect.flip(fs.readFileString(join(root, "docs") + "/../../outside/secret.txt")),
      relative: yield* Effect.flip(fs.readFileString(posix.relative(process.cwd(), join(outside, "secret.txt")))),
      // A link whose target is missing would create the target.
      dangling: yield* Effect.flip(fs.writeFileString(join(root, "dangling"), "x")),
      // Dot segments that stay inside are folded before the question.
      inside: yield* fs.readFileString(join(root, "docs") + "/./../README.md")
    }
  }))
  expect(refusal(result.throughLink).required?.capability).toEqual(Capability.make("fs:read", join(outside, "secret.txt")))
  expect(refusal(result.writeThroughLink).required?.capability).toEqual(Capability.make("fs:write", join(outside, "planted.txt")))
  expect(refusal(result.dotDot).required?.capability).toEqual(Capability.make("fs:read", join(outside, "secret.txt")))
  expect(refusal(result.relative).required?.capability).toEqual(Capability.make("fs:read", join(outside, "secret.txt")))
  expect(refusal(result.dangling).denied).toEqual(
    new Capability.PermissionDenied({
      capability: Capability.make("fs:write", join(root, "dangling")),
      reason: "the path holds a symbolic link that does not resolve"
    })
  )
  expect(result.inside).toBe("hello")
  expect(existsSync(join(outside, "planted.txt"))).toBe(false)
  expect(existsSync(join(outside, "new.txt"))).toBe(false)
})

test("every member is checked: derived ones, two-path ones, handles, links and temporary files", async () => {
  symlinkSync(outside, join(root, "link"))
  const secret = join(outside, "secret.txt")
  const result = await guarded({ allow: [`fs:*:${root}/**`, `fs:read:${root}`] }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const experimental = yield* Effect.service(ExperimentalFileSystem.FileSystem)
    const refusedAction = <A>(effect: Effect.Effect<A, PlatformError.PlatformError, never>) =>
      Effect.map(Effect.flip(effect), (error) => {
        const read = refusal(error)
        const capability = (read.required ?? read.denied)?.capability
        return capability === undefined ? `not a refusal: ${error.message}` : Capability.format(capability)
      })
    // A link is removed as a link: the question is about its own place.
    yield* fs.remove(join(root, "link"))
    const temporary = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: "tmp-" })
    yield* fs.copyFile(join(root, "README.md"), join(root, "copy.md"))
    const handle = yield* fs.open(join(root, "copy.md"), { flag: "r+" })
    yield* handle.writeAll(new TextEncoder().encode("HELLO"))
    return {
      temporary,
      listed: (yield* fs.readDirectory(root)).sort(),
      exists: yield* refusedAction(fs.exists(secret)),
      stat: yield* refusedAction(fs.stat(secret)),
      stream: yield* refusedAction(Stream.runCollect(fs.stream(secret))),
      sink: yield* refusedAction(Stream.run(Stream.make(new Uint8Array([1])), fs.sink(join(outside, "sunk.txt")))),
      glob: yield* refusedAction(fs.glob("*", { root: outside })),
      copyOut: yield* refusedAction(fs.copyFile(join(root, "README.md"), join(outside, "copied.md"))),
      copyIn: yield* refusedAction(fs.copyFile(secret, join(root, "stolen.txt"))),
      rename: yield* refusedAction(fs.rename(join(root, "README.md"), join(outside, "moved.md"))),
      remove: yield* refusedAction(fs.remove(secret)),
      symlink: yield* refusedAction(fs.symlink(secret, join(outside, "alias"))),
      openRead: yield* refusedAction(Effect.scoped(fs.open(secret))),
      openWrite: yield* refusedAction(Effect.scoped(fs.open(join(outside, "opened.txt"), { flag: "w" }))),
      makeDirectory: yield* refusedAction(fs.makeDirectory(join(outside, "made"), { recursive: true })),
      chmod: yield* refusedAction(fs.chmod(secret, 0o777)),
      truncate: yield* refusedAction(fs.truncate(secret)),
      temporaryOutside: yield* refusedAction(Effect.scoped(fs.makeTempFileScoped({ directory: outside, prefix: "t-" }))),
      temporaryDefault: yield* refusedAction(Effect.scoped(fs.makeTempDirectoryScoped({ prefix: "t-" }))),
      // The experimental FileSystem is a second key to the same disk.
      experimentalAccess: yield* refusedAction(experimental.access(secret, { executable: true })),
      experimentalOpen: yield* refusedAction(Effect.scoped(experimental.open(secret, { nonBlocking: true })))
    }
  }))
  expect(result.temporary.startsWith(join(root, "tmp-"))).toBe(true)
  expect(result.listed).toContain("copy.md")
  expect(result.listed).not.toContain("link")
  expect(readFileSync(join(root, "copy.md"), "utf8")).toBe("HELLO")
  // Removing the link left what it pointed at.
  expect(readFileSync(secret, "utf8")).toBe("secret")
  expect(result).toMatchObject({
    exists: `fs:read:${secret}`,
    stat: `fs:read:${secret}`,
    stream: `fs:read:${secret}`,
    sink: `fs:write:${join(outside, "sunk.txt")}`,
    glob: `fs:read:${outside}`,
    copyOut: `fs:write:${join(outside, "copied.md")}`,
    copyIn: `fs:read:${secret}`,
    rename: `fs:write:${join(outside, "moved.md")}`,
    remove: `fs:write:${secret}`,
    symlink: `fs:write:${join(outside, "alias")}`,
    openRead: `fs:read:${secret}`,
    openWrite: `fs:write:${join(outside, "opened.txt")}`,
    makeDirectory: `fs:write:${join(outside, "made")}`,
    chmod: `fs:write:${secret}`,
    truncate: `fs:write:${secret}`,
    temporaryOutside: `fs:write:${join(outside, "t-XXXXXX")}`,
    temporaryDefault: `fs:write:${join(realpathSync(tmpdir()), "t-XXXXXX")}`,
    experimentalAccess: `fs:read:${secret}`,
    experimentalOpen: `fs:read:${secret}`
  })
  expect(readFileSync(secret, "utf8")).toBe("secret")
  for (const name of ["sunk.txt", "copied.md", "moved.md", "alias", "opened.txt", "made"]) {
    expect(existsSync(join(outside, name))).toBe(false)
  }
  expect(existsSync(join(root, "stolen.txt"))).toBe(false)
  expect(lstatSync(join(root, "README.md")).isFile()).toBe(true)
})

test("an attended guard parks an operation until it is answered, and a ceiling still bounds it", async () => {
  const result = await guarded({ allow: [], workspace: root, attended: true }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const writing = yield* Effect.forkChild(fs.writeFileString(join(root, "asked.txt"), "asked"))
    let requests = yield* Capability.pending
    while (requests.length === 0) {
      yield* Effect.yieldNow
      requests = yield* Capability.pending
    }
    const before = existsSync(join(root, "asked.txt"))
    yield* Capability.reply(requests[0]!.requestId, "run")
    yield* Fiber.join(writing)
    const narrowed = yield* Effect.flip(
      Capability.attenuate(["fs:read:**"])(fs.writeFileString(join(root, "asked.txt"), "again"))
    )
    return { requests, before, narrowed }
  }))
  expect(result.requests).toEqual([{ requestId: "permission-1", capability: Capability.make("fs:write", join(root, "asked.txt")), tier: "compensable" }])
  expect(result.before).toBe(false)
  expect(readFileSync(join(root, "asked.txt"), "utf8")).toBe("asked")
  expect(refusal(result.narrowed).denied?.reason).toBe("outside capability ceiling")
})

test("a guard inside a guard only narrows, for services and for explicit checks", async () => {
  const result = await guarded({ allow: [`fs:*:${root}/**`, "model:call:small"], deny: [`fs:*:${root}/docs/**`] }, Effect.gen(function*() {
    const inner = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.provide(effect, Capability.guard({ allow: ["*"] }))
    const narrow = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.provide(effect, Capability.guard({ allow: [`fs:read:${root}/README.md`] }))
    const fs = fileSystem
    return {
      // The inner guard allows everything. The outer one still decides.
      outerDeny: yield* inner(Effect.flip(Effect.flatMap(fs, (service) => service.readFileString(join(root, "docs", "guide.md"))))),
      outerAsk: yield* inner(Effect.flip(Effect.flatMap(fs, (service) => service.readFileString(join(outside, "secret.txt"))))),
      innerAllowed: yield* inner(Effect.flatMap(fs, (service) => service.readFileString(join(root, "README.md")))),
      // The outer guard allows the write. The inner one does not.
      innerAsk: yield* narrow(Effect.flip(Effect.flatMap(fs, (service) => service.writeFileString(join(root, "out.txt"), "x")))),
      explicitOuter: yield* inner(Effect.flip(Capability.check("model:call:large"))),
      explicitBoth: yield* inner(Effect.exit(Capability.check("model:call:small"))),
      explicitInner: yield* narrow(Effect.flip(Capability.check("model:call:small")))
    }
  }))
  expect(refusal(result.outerDeny).denied?.reason).toBe("denied by permission policy")
  expect(refusal(result.outerAsk).required?.capability).toEqual(Capability.make("fs:read", join(outside, "secret.txt")))
  expect(result.innerAllowed).toBe("hello")
  expect(refusal(result.innerAsk).required?.capability).toEqual(Capability.make("fs:write", join(root, "out.txt")))
  expect(existsSync(join(root, "out.txt"))).toBe(false)
  expect(result.explicitOuter._tag).toBe("PermissionRequired")
  expect(Exit.isSuccess(result.explicitBoth)).toBe(true)
  expect(result.explicitInner._tag).toBe("PermissionRequired")
})

test("a faulty file system fails closed, and its own failures are not refusals", async () => {
  const calls: Array<string> = []
  const broken = (failure: "resolve" | "write") =>
    Layer.succeed(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        realPath: (path) =>
          failure === "resolve"
            ? Effect.fail(PlatformError.systemError({ _tag: "Unknown", module: "FileSystem", method: "realPath", pathOrDescriptor: path }))
            : Effect.succeed(path),
        writeFile: (path) => {
          calls.push(path)
          return Effect.fail(PlatformError.systemError({ _tag: "WouldBlock", module: "FileSystem", method: "writeFile", pathOrDescriptor: path }))
        }
      })
    )
  const write = Effect.flatMap(fileSystem, (fs) => fs.writeFileString("/disk/out.txt", "x"))
  const under = (failure: "resolve" | "write") =>
    Effect.runPromise(Effect.flip(Effect.provide(Effect.provide(write, Capability.guard({ allow: ["*"] })), broken(failure))))

  // The disk cannot say what the path is, so the kernel is never asked and
  // nothing is written.
  const unresolved = await under("resolve")
  expect(unresolved.reason._tag).toBe("Unknown")
  expect(calls).toEqual([])
  // The write was allowed and the disk failed it: the caller sees the
  // disk's failure, which reads back as no refusal.
  const failed = await under("write")
  expect(failed.reason._tag).toBe("WouldBlock")
  expect(calls).toEqual(["/disk/out.txt"])
  expect(refusal(failed)).toEqual({ required: undefined, denied: undefined })
})

test("a guard with nothing to guard is a defect", async () => {
  const exit = await Effect.runPromiseExit(Effect.provide(Effect.void, Capability.guard({ allow: ["*"] })))
  expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  expect(Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "").toContain("found no FileSystem, HttpClient or ChildProcessSpawner to guard")
  // Merged beside the platform layer it would guard nothing: the same defect.
  const beside = await Effect.runPromiseExit(
    Effect.provide(Effect.void, Layer.mergeAll(Capability.guard({ allow: ["*"] }), Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({}))))
  )
  expect(Exit.isFailure(beside) && Cause.hasDies(beside.cause)).toBe(true)
  // Provided over the platform layer, as a layer, it guards.
  const over = await Effect.runPromise(Effect.provide(
    Effect.flip(Effect.flatMap(fileSystem, (fs) => fs.readFile("/disk/a"))),
    Layer.provideMerge(Capability.guard({ allow: [] }), Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({ realPath: Effect.succeed })))
  ))
  expect(refusal(over).required?.capability).toEqual(Capability.make("fs:read", "/disk/a"))
})

// A local server that records what reached it.
let server: ReturnType<typeof Bun.serve>
const hits: Array<string> = []
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      const url = new URL(request.url)
      hits.push(`${request.method} ${url.pathname}${url.search}`)
      if (url.pathname === "/redirect-secret") return Response.redirect(`${url.origin}/secret`, 302)
      if (url.pathname === "/redirect-ok") return Response.redirect(`${url.origin}/ok?via=redirect`, 302)
      return new Response(`${request.method} ${url.pathname}`)
    }
  })
})
afterAll(() => {
  server.stop(true)
})

test("an HTTP request asks about its URL and method, and so does every redirect hop", async () => {
  hits.length = 0
  const origin = `http://127.0.0.1:${server.port}`
  const allow: Array<Capability.PatternText> = [
    `net:get:${origin}/ok`,
    `net:get:${origin}/ok?via=redirect`,
    `net:get:${origin}/redirect-*`,
    `net:post:${origin}/submit`
  ]
  const result = await guarded({ allow }, Effect.gen(function*() {
    const client = yield* Effect.service(HttpClient.HttpClient)
    const text = (request: HttpClientRequest.HttpClientRequest) => Effect.flatMap(client.execute(request), (response) => response.text)
    return {
      ok: yield* text(HttpClientRequest.get(`${origin}/ok`)),
      // The query is part of what is asked.
      query: yield* Effect.flip(text(HttpClientRequest.setUrlParam(HttpClientRequest.get(`${origin}/ok`), "q", "1"))),
      post: yield* text(HttpClientRequest.post(`${origin}/submit`)),
      followed: yield* text(HttpClientRequest.get(`${origin}/redirect-ok`)),
      secret: yield* Effect.flip(text(HttpClientRequest.get(`${origin}/secret`))),
      // GET is allowed here. POST is another action.
      wrongMethod: yield* Effect.flip(text(HttpClientRequest.post(`${origin}/ok`))),
      // The first hop is allowed. Where it leads is not.
      hop: yield* Effect.flip(text(HttpClientRequest.get(`${origin}/redirect-secret`))),
      // The text before the @ is user info, not the host.
      userInfo: yield* Effect.flip(text(HttpClientRequest.get(`http://127.0.0.1:${server.port}@localhost:${server.port}/ok`))),
      relative: yield* Effect.flip(text(HttpClientRequest.get("/ok")))
    }
  }))
  expect(result.ok).toBe("GET /ok")
  expect(refusal(result.query).required?.capability).toEqual(Capability.make("net:get", `${origin}/ok?q=1`))
  expect(result.post).toBe("POST /submit")
  expect(result.followed).toBe("GET /ok")
  expect(result.secret.reason._tag).toBe("TransportError")
  expect(refusal(result.secret).required?.capability).toEqual(Capability.make("net:get", `${origin}/secret`))
  expect(refusal(result.wrongMethod).required?.capability).toEqual(Capability.make("net:post", `${origin}/ok`))
  expect(refusal(result.hop).required?.capability).toEqual(Capability.make("net:get", `${origin}/secret`))
  expect(refusal(result.userInfo).required?.capability).toEqual(Capability.make("net:get", `http://localhost:${server.port}/ok`))
  expect(refusal(result.relative).denied?.reason).toBe("the request needs an absolute http or https URL with a host")
  // Nothing refused reached the server.
  expect(hits).toEqual(["GET /ok", "POST /submit", "GET /redirect-ok", "GET /ok?via=redirect", "GET /redirect-secret"])
})

test("a faulty HTTP client's failure passes through and is not a refusal", async () => {
  const down = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, description: "connection reset" }) }))
    )
  )
  const error = await Effect.runPromise(Effect.flip(Effect.provide(
    Effect.provide(Effect.flatMap(Effect.service(HttpClient.HttpClient), (client) => client.get("https://example.com/")), Capability.guard({ allow: ["net:get:https://example.com/"] })),
    down
  )))
  expect(error.reason._tag).toBe("TransportError")
  expect(refusal(error)).toEqual({ required: undefined, denied: undefined })
})

test("a command asks about its whole command line, and a pipeline about every stage", async () => {
  const spawned: Array<string> = []
  // The real spawner, counting what reaches it.
  const counting = Layer.effect(
    ChildProcessSpawner,
    Effect.map(Effect.service(ChildProcessSpawner), (spawner) =>
      makeSpawner((command) => {
        spawned.push(command._tag === "StandardCommand" ? command.command : "pipeline")
        return spawner.spawn(command)
      }))
  ).pipe(Layer.provideMerge(NodeServices.layer))
  const run = <A, E>(options: Capability.GuardOptions, program: Effect.Effect<A, E, ChildProcessSpawner>) =>
    Effect.runPromise(Effect.scoped(Effect.provide(Effect.provide(program, Capability.guard(options)), counting)))
  // With no file system under the guard, a directory cannot be shown to be
  // inside the workspace, so it stays in the request.
  const unresolved = await Effect.runPromise(Effect.scoped(Effect.provide(
    Effect.provide(
      Effect.flip(Effect.flatMap(Effect.service(ChildProcessSpawner), (spawner) => spawner.string(ChildProcess.make("echo", ["hi"], { cwd: root })))),
      Capability.guard({ allow: ["proc:spawn:echo *"], workspace: root })
    ),
    Layer.effect(ChildProcessSpawner, Effect.service(ChildProcessSpawner)).pipe(Layer.provide(NodeServices.layer))
  )))
  expect(refusal(unresolved).required?.capability.resource).toBe(`cwd ${root} -- echo hi`)
  const asked = (effect: Effect.Effect<unknown, PlatformError.PlatformError, ChildProcessSpawner>) =>
    Effect.map(Effect.flip(effect), (error) => refusal(error).required?.capability.resource ?? `not a refusal: ${error.message}`)

  symlinkSync(outside, join(root, "link"))
  const result = await run({ allow: ["proc:spawn:echo *", "proc:spawn:cat"], workspace: root }, Effect.gen(function*() {
    const spawner = yield* Effect.service(ChildProcessSpawner)
    return {
      echo: yield* spawner.string(ChildProcess.make("echo", ["hello"], { cwd: root })),
      piped: yield* spawner.string(ChildProcess.pipeTo(ChildProcess.make("echo", ["piped"], { cwd: root }), ChildProcess.make("cat", { cwd: root }))),
      inWorkspace: yield* spawner.string(ChildProcess.make("echo", ["here"], { cwd: join(root, "docs") })),
      shell: yield* asked(spawner.string(ChildProcess.make("sh", ["-c", "echo pwned; rm -rf /"], { cwd: root }))),
      shellOption: yield* asked(spawner.string(ChildProcess.make("echo", ["hi;", "id"], { shell: true, cwd: root }))),
      // An environment that replaces, extends or removes is part of the request.
      replaced: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"], { cwd: root, env: { NODE_OPTIONS: "--require ./x.js" } }))),
      extended: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"], { cwd: root, env: { B: "2", A: "1" }, extendEnv: true }))),
      removed: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"], { cwd: root, env: { HTTPS_PROXY: undefined, A: "1" }, extendEnv: true }))),
      emptied: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"], { cwd: root, env: {} }))),
      // Where a command runs is part of the request when it is not the workspace.
      elsewhere: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"], { cwd: outside }))),
      throughLink: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"], { cwd: join(root, "link") }))),
      relative: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"], { cwd: "." }))),
      inherited: yield* asked(spawner.string(ChildProcess.make("echo", ["hi"]))),
      secretWord: yield* asked(spawner.string(ChildProcess.make("curl", ["-H", Redacted.make("Authorization: Bearer t0ken"), "<redacted>"], { cwd: root }))),
      // One refused stage stops the whole pipeline before any stage starts.
      pipeline: yield* asked(spawner.string(ChildProcess.pipeTo(ChildProcess.make("echo", ["x"], { cwd: root }), ChildProcess.make("tee", [join(outside, "t")], { cwd: root }))))
    }
  }))
  expect(result.echo.trim()).toBe("hello")
  expect(result.piped.trim()).toBe("piped")
  expect(result.inWorkspace.trim()).toBe("here")
  expect(result.shell).toBe("sh -c 'echo pwned; rm -rf /'")
  expect(result.shellOption).toBe("sh -c 'echo hi; id'")
  expect(result.replaced).toBe("env -i NODE_OPTIONS -- echo hi")
  expect(result.extended).toBe("env A B -- echo hi")
  expect(result.removed).toBe("env -u HTTPS_PROXY A -- echo hi")
  expect(result.emptied).toBe("env -i -- echo hi")
  expect(result.elsewhere).toBe(`cwd ${outside} -- echo hi`)
  expect(result.throughLink).toBe(`cwd ${outside} -- echo hi`)
  expect(result.relative).toBe(`cwd ${realpathSync(process.cwd())} -- echo hi`)
  expect(result.inherited).toBe(`cwd ${realpathSync(process.cwd())} -- echo hi`)
  // The secret is a bare placeholder. The same text as an argument is quoted.
  expect(result.secretWord).toBe("curl -H <redacted> '<redacted>'")
  expect(result.pipeline).toBe(`tee ${join(outside, "t")}`)
  expect(spawned).toEqual(["echo", "pipeline", "echo"])
  expect(existsSync(join(outside, "t"))).toBe(false)
})

test("a write reaches the disk exactly when the policy allows the path it resolves to", async () => {
  const segment = fc.constantFrom("a", "b", "..", ".", "a b")
  await checkProperty(fc, {
    name: "capability-guard-file-system",
    rule: "VIP-58: the kernel authorizes a path after resolving it, and a deny anywhere vetoes",
    command,
    arbitrary: fc.record({
      allow: fc.array(anyPattern, { maxLength: 4 }),
      deny: fc.array(anyPattern, { maxLength: 2 }),
      segments: fc.array(segment, { minLength: 1, maxLength: 5 }),
      absolute: fc.boolean()
    }),
    numRuns: 1000,
    check: async ({ allow, deny, segments, absolute }: {
      allow: Array<Capability.Pattern>
      deny: Array<Capability.Pattern>
      segments: Array<string>
      absolute: boolean
    }) => {
      const written: Array<string> = []
      // A disk with no links, where every path is its own real path.
      const disk = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          realPath: Effect.succeed,
          writeFile: (path) => Effect.sync(() => void written.push(path))
        })
      )
      const input = `${absolute ? "/" : ""}${segments.join("/")}`
      const resolved = posix.resolve(input)
      const exit = await Effect.runPromiseExit(Effect.provide(
        Effect.provide(Effect.flatMap(fileSystem, (fs) => fs.writeFileString(input, "x")), Capability.guard({ allow, deny })),
        disk
      ))
      const expected = modelEvaluate({ allow, deny }, Capability.make("fs:write", resolved), [])
      expect(Exit.isSuccess(exit)).toBe(expected === "allow")
      // What was asked is what was touched: the resolved path or nothing.
      expect(written).toEqual(expected === "allow" ? [resolved] : [])
      if (Exit.isFailure(exit)) {
        const read = refusal(Cause.squash(exit.cause) as PlatformError.PlatformError)
        expect((expected === "deny" ? read.denied : read.required)?.capability).toEqual(Capability.make("fs:write", resolved))
      }
    }
  })
}, 60000)

test("a temporary name cannot leave its directory, and its suffix is part of the question", async () => {
  mkdirSync(join(root, "sandbox"))
  symlinkSync(outside, join(root, "sandbox", "l"))
  const result = await guarded({ allow: [`fs:write:${root}/**`], deny: [`fs:write:${root}/*.key`] }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const reason = <A>(effect: Effect.Effect<A, PlatformError.PlatformError, never>) =>
      Effect.map(Effect.flip(effect), (error) => refusal(error).denied?.reason ?? `not a denial: ${error.message}`)
    const sandbox = join(root, "sandbox")
    return {
      file: yield* fs.makeTempFile({ directory: sandbox, prefix: "t-", suffix: ".txt" }),
      // The host joins the suffix onto the file's path and the prefix onto the directory's.
      suffixEscapes: yield* reason(fs.makeTempFile({ directory: sandbox, suffix: "/../../../outside/planted" })),
      scopedSuffix: yield* reason(Effect.scoped(fs.makeTempFileScoped({ directory: sandbox, suffix: "/../x" }))),
      prefixParent: yield* reason(fs.makeTempDirectory({ directory: sandbox, prefix: ".." })),
      prefixSelf: yield* reason(fs.makeTempDirectory({ directory: sandbox, prefix: "." })),
      prefixThroughLink: yield* reason(fs.makeTempFile({ directory: sandbox, prefix: "l/x" })),
      // A deny on a suffix sees the suffix.
      deniedSuffix: yield* reason(fs.makeTempFile({ directory: root, prefix: "id-", suffix: ".key" }))
    }
  }))
  expect(result.file.startsWith(join(root, "sandbox", "t-"))).toBe(true)
  expect(result.file.endsWith(".txt")).toBe(true)
  const separator = "a temporary name's prefix and suffix must not hold a path separator or be a dot segment"
  expect(result.suffixEscapes).toBe(separator)
  expect(result.scopedSuffix).toBe(separator)
  expect(result.prefixParent).toBe(separator)
  expect(result.prefixSelf).toBe(separator)
  expect(result.prefixThroughLink).toBe(separator)
  expect(result.deniedSuffix).toBe("denied by permission policy")
  expect(existsSync(join(outside, "planted"))).toBe(false)
  expect(existsSync(outside)).toBe(true)
  expect(existsSync(root)).toBe(true)
})

test("a guard inside a grant store still obeys the store, and every store is asked once", async () => {
  const write = (file: string) => Effect.flatMap(fileSystem, (fs) => fs.writeFileString(file, "x"))
  const inner = Capability.guard({ allow: ["*"] })
  // A plain store with a deny, and a guard inside it that allows everything.
  const outerDeny = await Effect.runPromise(Effect.scoped(Effect.provide(
    Effect.provide(Effect.flip(Effect.provide(write(join(root, "docs", "x.md")), inner)), Capability.grantStore({ allow: ["*"], deny: [`fs:write:${root}/docs/**`] })),
    platform
  )) as Effect.Effect<PlatformError.PlatformError>)
  expect(refusal(outerDeny).denied?.reason).toBe("denied by permission policy")
  expect(existsSync(join(root, "docs", "x.md"))).toBe(false)

  // A host's own store, installed with the service key, is asked too.
  const asked: Array<string> = []
  const host = Layer.succeed(Capability.GrantStore, {
    check: (capability) =>
      Effect.sync(() => void asked.push(typeof capability === "string" ? capability : Capability.format(capability))),
    pending: Effect.succeed([]),
    reply: () => Effect.succeed(false)
  })
  await Effect.runPromise(Effect.scoped(Effect.provide(Effect.provide(Effect.provide(write(join(root, "a.txt")), inner), host), platform)) as Effect.Effect<void>)
  expect(asked).toEqual([`fs:write:${join(root, "a.txt")}`])

  // An attended guard outside, a guard inside: one operation is one question.
  const once = await Effect.runPromise(Effect.scoped(Effect.provide(
    Effect.provide(
      Effect.gen(function*() {
        const writing = yield* Effect.forkChild(Effect.provide(write(join(root, "b.txt")), inner))
        let requests = yield* Capability.pending
        while (requests.length === 0) {
          yield* Effect.yieldNow
          requests = yield* Capability.pending
        }
        yield* Capability.reply(requests[0]!.requestId, "once")
        yield* Fiber.join(writing)
        return { requests: requests.length, left: (yield* Capability.pending).length }
      }),
      Capability.guard({ allow: [], attended: true })
    ),
    platform
  )) as Effect.Effect<{ requests: number; left: number }>)
  expect(once).toEqual({ requests: 1, left: 0 })
  expect(existsSync(join(root, "b.txt"))).toBe(true)
})

test("a hard link needs write on its source, and a whole-tree operation obeys a deny inside the tree", async () => {
  const result = await guarded({
    allow: [`fs:*:${root}/**`, `fs:read:${root}`, `fs:read:${outside}/*`],
    deny: [`fs:write:${root}/docs/**`, `fs:read:${root}/private/key`]
  }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const refused = <A>(effect: Effect.Effect<A, PlatformError.PlatformError, never>) =>
      Effect.map(Effect.flip(effect), (error) => {
        const read = refusal(error)
        return read.denied !== undefined
          ? `${Capability.format(read.denied.capability)}: ${read.denied.reason}`
          : read.required !== undefined
          ? `ask ${Capability.format(read.required.capability)}`
          : `not a refusal: ${error.message}`
      })
    yield* fs.makeDirectory(join(root, "private"))
    yield* fs.writeFileString(join(root, "private", "key"), "k")
    yield* fs.makeDirectory(join(root, "tmp"))
    yield* fs.writeFileString(join(root, "tmp", "a"), "a")
    const tree = "a deny in the policy selects something inside this tree"
    return {
      tree,
      // A second name for a file is a way to write it.
      link: yield* refused(fs.link(join(outside, "secret.txt"), join(root, "alias"))),
      removeTree: yield* refused(fs.remove(join(root, "docs"), { recursive: true })),
      removeAbove: yield* refused(fs.remove(root, { recursive: true })),
      renameTree: yield* refused(fs.rename(join(root, "docs"), join(root, "moved"))),
      copyTree: yield* refused(fs.copy(join(root, "private"), join(root, "copied"))),
      listTree: yield* refused(fs.readDirectory(root, { recursive: true })),
      // A tree no deny reaches, and one level of a directory, are ordinary operations.
      removed: yield* Effect.as(fs.remove(join(root, "tmp"), { recursive: true }), "removed"),
      listed: (yield* fs.readDirectory(root)).sort()
    }
  }))
  expect(result.link).toBe(`ask fs:write:${join(outside, "secret.txt")}`)
  expect(result.removeTree).toBe(`fs:write:${join(root, "docs")}: ${result.tree}`)
  expect(result.removeAbove).toBe(`fs:write:${root}: ${result.tree}`)
  expect(result.renameTree).toBe(`fs:write:${join(root, "docs")}: ${result.tree}`)
  expect(result.copyTree).toBe(`fs:read:${join(root, "private")}: ${result.tree}`)
  expect(result.listTree).toBe(`fs:read:${root}: ${result.tree}`)
  expect(result.removed).toBe("removed")
  expect(result.listed).toEqual(["README.md", "docs", "private"])
  expect(existsSync(join(root, "docs", "guide.md"))).toBe(true)
  expect(existsSync(join(root, "alias"))).toBe(false)
  expect(existsSync(join(root, "copied"))).toBe(false)
})

test("a glob does not hide a refusal, and a secret word is never a standing grant", async () => {
  mkdirSync(join(root, "private"))
  writeFileSync(join(root, "private", "notes.md"), "n")
  const globbed = await guarded({ allow: [`fs:read:${root}`, `fs:read:${root}/docs*`] }, Effect.gen(function*() {
    const fs = yield* fileSystem
    return {
      partial: yield* Effect.flip(fs.glob("**/*.md", { root })),
      whole: (yield* fs.glob("*.md", { root: join(root, "docs") })).length
    }
  }))
  expect(refusal(globbed.partial).required?.capability).toEqual(Capability.make("fs:read", join(root, "private")))
  expect(globbed.whole).toBe(1)

  const spawned = await guarded({ allow: [], workspace: root, attended: true }, Effect.gen(function*() {
    const spawner = yield* Effect.service(ChildProcessSpawner)
    const answer = (secret: string) =>
      Effect.gen(function*() {
        const running = yield* Effect.forkChild(spawner.string(ChildProcess.make("echo", [Redacted.make(secret)], { cwd: root })))
        let requests = yield* Capability.pending
        while (requests.length === 0) {
          yield* Effect.yieldNow
          requests = yield* Capability.pending
        }
        yield* Capability.reply(requests[0]!.requestId, "run")
        return { asked: requests[0]!.capability.resource, output: (yield* Fiber.join(running)).trim() }
      })
    // Two different secrets render the same, so the second must ask again.
    return [yield* answer("first"), yield* answer("second")]
  }))
  expect(spawned).toEqual([{ asked: "echo <redacted>", output: "first" }, { asked: "echo <redacted>", output: "second" }])
})

test("an escaped URL meets a deny written plainly, and a secret parameter stays out of the question", async () => {
  hits.length = 0
  const origin = `http://127.0.0.1:${server.port}`
  const result = await guarded({ allow: [`net:get:${origin}/**`], deny: [`net:get:${origin}/secret*`] }, Effect.gen(function*() {
    const client = yield* Effect.service(HttpClient.HttpClient)
    const text = (request: HttpClientRequest.HttpClientRequest) => Effect.flatMap(client.execute(request), (response) => response.text)
    return {
      // %73 is "s": the server would serve /secret.
      encoded: yield* Effect.flip(text(HttpClientRequest.get(`${origin}/%73ecret`))),
      token: yield* Effect.flip(text(HttpClientRequest.setUrlParam(HttpClientRequest.get(`${origin}/secret`), "token", Redacted.make("s3cr3t-value"))))
    }
  }))
  // The question shows the URL as it was written. The deny reads it as the server will.
  expect(refusal(result.encoded).denied).toEqual(
    new Capability.PermissionDenied({ capability: Capability.make("net:get", `${origin}/%73ecret`), reason: "denied by permission policy" })
  )
  const token = refusal(result.token).denied
  expect(token?.capability.resource).toBe(`${origin}/secret?token=%3Credacted%3E`)
  expect(JSON.stringify([token?.capability, token?.message, result.token.message])).not.toContain("s3cr3t-value")
  expect(hits).toEqual([])
})

test("only a directory is a tree: a file is renamed, copied and removed as one path", async () => {
  mkdirSync(join(root, "build"))
  writeFileSync(join(root, "build", "out.tmp"), "built")
  symlinkSync(join(root, "docs"), join(root, "docs-link"))
  // A deny that could be inside any directory under the workspace.
  const result = await guarded({ allow: [`fs:*:${root}/**`], deny: [`fs:write:${root}/**/*.lock`, `fs:read:${root}/**/*.pem`] }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const reason = <A>(effect: Effect.Effect<A, PlatformError.PlatformError, never>) =>
      Effect.map(Effect.flip(effect), (error) => refusal(error).denied?.reason ?? `not a denial: ${error.message}`)
    // The usual way to write a file whole: write beside it, then rename.
    yield* fs.rename(join(root, "build", "out.tmp"), join(root, "build", "out.js"))
    yield* fs.copy(join(root, "build", "out.js"), join(root, "build", "copy.js"))
    yield* fs.remove(join(root, "build", "copy.js"), { recursive: true })
    // A link to a directory is removed as a link, not as the tree behind it.
    yield* fs.remove(join(root, "docs-link"), { recursive: true })
    return {
      // A directory could hold a file the deny selects.
      removeDirectory: yield* reason(fs.remove(join(root, "build"), { recursive: true })),
      renameDirectory: yield* reason(fs.rename(join(root, "build"), join(root, "dist"))),
      copyDirectory: yield* reason(fs.copy(join(root, "docs"), join(root, "docs-copy"))),
      // The file itself is still asked about.
      deniedFile: yield* reason(fs.rename(join(root, "build", "out.js"), join(root, "build", "yarn.lock")))
    }
  }))
  const tree = "a deny in the policy selects something inside this tree"
  expect(result).toEqual({ removeDirectory: tree, renameDirectory: tree, copyDirectory: tree, deniedFile: "denied by permission policy" })
  expect(readFileSync(join(root, "build", "out.js"), "utf8")).toBe("built")
  expect(existsSync(join(root, "build", "copy.js"))).toBe(false)
  expect(existsSync(join(root, "docs-link"))).toBe(false)
  expect(existsSync(join(root, "docs", "guide.md"))).toBe(true)
})

test("a whole-tree operation never passes a deny that selects a path inside the tree", async () => {
  const name = fc.constantFrom("a", "b", "ab")
  await checkProperty(fc, {
    name: "capability-guard-tree-deny",
    rule: "VIP-58: a deny anywhere vetoes, for a recursive remove as for a single path",
    command,
    arbitrary: fc.record({
      deny: fc.array(anyPattern, { minLength: 1, maxLength: 3 }),
      directory: fc.array(name, { minLength: 1, maxLength: 3 }),
      inside: fc.array(name, { minLength: 1, maxLength: 3 })
    }),
    numRuns: 1500,
    check: async ({ deny, directory, inside }: { deny: Array<Capability.Pattern>; directory: Array<string>; inside: Array<string> }) => {
      const removed: Array<string> = []
      // A disk where every path is its own real path and a directory.
      const disk = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          realPath: Effect.succeed,
          lstat: () => Effect.succeed({ type: "Directory" } as FileSystem.File.Info),
          stat: () => Effect.succeed({ type: "Directory" } as FileSystem.File.Info),
          remove: (path) => Effect.sync(() => void removed.push(path))
        })
      )
      const tree = `/${directory.join("/")}`
      const descendant = Capability.make("fs:write", `${tree}/${inside.join("/")}`)
      const exit = await Effect.runPromiseExit(Effect.provide(
        Effect.provide(Effect.flatMap(fileSystem, (fs) => fs.remove(tree, { recursive: true })), Capability.guard({ allow: ["*"], deny })),
        disk
      ))
      // If any deny selects a path under the directory, or the directory, the tree stays.
      const selected = deny.some((pattern) => modelMatches(pattern, descendant) || modelMatches(pattern, Capability.make("fs:write", tree)))
      if (selected) {
        expect(Exit.isFailure(exit)).toBe(true)
        expect(removed).toEqual([])
      }
      // And nothing is removed without the kernel's allow.
      expect(removed).toEqual(Exit.isSuccess(exit) ? [tree] : [])
    }
  })
}, 60000)

test("a directory carries its tree to the name it is copied or renamed to, and a rename reads what it moves", async () => {
  mkdirSync(join(root, "staging", "hooks"), { recursive: true })
  writeFileSync(join(root, "staging", "hooks", "run.sh"), "#!/bin/sh")
  mkdirSync(join(root, "private"))
  writeFileSync(join(root, "private", "key"), "k")
  writeFileSync(join(root, ".env"), "TOKEN=1")
  const result = await guarded({
    allow: [`fs:*:${root}/**`],
    deny: [`fs:write:${root}/deploy/hooks/*`, `fs:read:${root}/private/*`, `fs:read:${root}/.env`]
  }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const reason = <A>(effect: Effect.Effect<A, PlatformError.PlatformError, never>) =>
      Effect.map(Effect.flip(effect), (error) => {
        const read = refusal(error).denied
        return read === undefined ? `not a denial: ${error.message}` : `${Capability.format(read.capability)}: ${read.reason}`
      })
    return {
      // The destination does not exist yet. It will hold what the source holds.
      copyOnto: yield* reason(fs.copy(join(root, "staging"), join(root, "deploy"))),
      renameOnto: yield* reason(fs.rename(join(root, "staging"), join(root, "deploy"))),
      // Moving what may not be read to where it may be read is a read.
      renameUnreadableTree: yield* reason(fs.rename(join(root, "private"), join(root, "public"))),
      renameUnreadableFile: yield* reason(fs.rename(join(root, ".env"), join(root, "env.txt")))
    }
  }))
  const tree = "a deny in the policy selects something inside this tree"
  expect(result).toEqual({
    copyOnto: `fs:write:${join(root, "deploy")}: ${tree}`,
    renameOnto: `fs:write:${join(root, "deploy")}: ${tree}`,
    renameUnreadableTree: `fs:read:${join(root, "private")}: ${tree}`,
    renameUnreadableFile: `fs:read:${join(root, ".env")}: denied by permission policy`
  })
  expect(existsSync(join(root, "deploy"))).toBe(false)
  expect(existsSync(join(root, "public"))).toBe(false)
  expect(existsSync(join(root, "env.txt"))).toBe(false)
  expect(existsSync(join(root, "staging", "hooks", "run.sh"))).toBe(true)

  // A deny whose literal start changes length when its case is folded.
  const removed: Array<string> = []
  const disk = Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.makeNoop({
      realPath: Effect.succeed,
      lstat: () => Effect.succeed({ type: "Directory" } as FileSystem.File.Info),
      remove: (path) => Effect.sync(() => void removed.push(path))
    })
  )
  const folded = await Effect.runPromise(Effect.flip(Effect.provide(
    Effect.provide(
      Effect.flatMap(fileSystem, (fs) => fs.remove("/ws/İİİİİdir", { recursive: true })),
      Capability.guard({ allow: ["*"], deny: ["fs:write:/ws/İİİİİ*.key"] })
    ),
    disk
  )))
  expect(refusal(folded).denied?.reason).toBe(tree)
  expect(removed).toEqual([])
})

test("ordinary operations stay ordinary: a link out of the tree in a glob, a dangling link read, a dotted directory name", async () => {
  symlinkSync(outside, join(root, "vendor"))
  symlinkSync(join(root, "gone.txt"), join(root, "dangling"))
  mkdirSync(join(root, "..cache"))
  mkdirSync(join(root, "locked"))
  writeFileSync(join(root, "locked", "notes.md"), "n")
  const result = await guarded({ allow: [`fs:read:${root}/**`, `fs:read:${root}`, "proc:spawn:echo *"], deny: [`fs:read:${root}/locked`], workspace: root }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const spawner = yield* Effect.service(ChildProcessSpawner)
    return {
      // The walk does not follow the link, so not being allowed to read where it leads is no refusal of the glob.
      globbed: (yield* fs.glob("**/*.md", { root: join(root, "docs") })).length,
      // A directory under the root that may not be listed still fails the glob.
      refusedGlob: yield* Effect.flip(fs.glob("**/*.md", { root })),
      // Reading through a link to nothing finds nothing. Writing through it is still refused.
      exists: yield* fs.exists(join(root, "dangling")),
      read: (yield* Effect.flip(fs.readFileString(join(root, "dangling")))).reason._tag,
      // A name that starts with two dots is a name.
      dotted: (yield* spawner.string(ChildProcess.make("echo", ["hi"], { cwd: join(root, "..cache") }))).trim()
    }
  }))
  expect(result.globbed).toBe(1)
  expect(refusal(result.refusedGlob).denied?.capability).toEqual(Capability.make("fs:read", join(root, "locked")))
  expect(result.exists).toBe(false)
  expect(result.read).toBe("NotFound")
  expect(result.dotted).toBe("hi")
})

test("the experimental process runner is a spawn too, and a variable named like a flag is not a flag", async () => {
  const result = await guarded({ allow: ["proc:spawn:true"], workspace: root }, Effect.gen(function*() {
    const runner = yield* Effect.service(ExperimentalChildProcess.ChildProcess)
    const spawner = yield* Effect.service(ChildProcessSpawner)
    const flags = yield* Effect.flip(
      spawner.string(ChildProcess.make("npm", ["test"], { cwd: root, extendEnv: true, env: { "-u": "", NODE_OPTIONS: "--require /tmp/x.js" } }))
    )
    return {
      allowed: yield* runner.runInherited("true", [], { cwd: root }),
      refused: yield* Effect.flip(runner.runInherited("sh", ["-c", "exit 3"], { cwd: root })),
      elsewhere: yield* Effect.flip(runner.runInherited("true", [], { cwd: outside })),
      flags: refusal(flags).required?.capability.resource
    }
  }))
  expect(result.allowed).toBe(0)
  expect(result.refused).toEqual(new Capability.PermissionRequired({ requestId: "permission-2", capability: Capability.make("proc:spawn", "sh -c 'exit 3'"), tier: "irreversible" }))
  expect((result.elsewhere as Capability.PermissionRequired).capability.resource).toBe(`cwd ${outside} -- true`)
  expect(result.flags).toBe("env '-u' NODE_OPTIONS -- npm test")
})

test("a whole-tree operation needs the tree, not only its top path: under a ceiling, an allow and a grant", async () => {
  const docs = join(root, "docs")
  const result = await guarded({ allow: [`fs:write:${root}/**`, `fs:read:${docs}`, `fs:read:${root}/README.md`], workspace: root }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const asked = <A>(effect: Effect.Effect<A, PlatformError.PlatformError, never>) =>
      Effect.map(Effect.flip(effect), (error) => {
        const read = refusal(error)
        return read.denied !== undefined
          ? `${Capability.format(read.denied.capability)}: ${read.denied.reason}`
          : read.required !== undefined
          ? `ask ${Capability.format(read.required.capability)}`
          : `not a refusal: ${error.message}`
      })
    return {
      // The ceiling names the directory. What is inside it is outside the ceiling.
      ceiling: yield* asked(Capability.attenuate([`fs:write:${docs}`])(fs.remove(docs, { recursive: true }))),
      // The allow names the directory. Reading what is inside it was never allowed.
      allow: yield* asked(fs.copy(docs, join(root, "copy"))),
      list: yield* asked(fs.readDirectory(docs, { recursive: true })),
      watch: yield* asked(Stream.runHead(fs.watch(docs, { recursive: true }))),
      // One level of the directory is one path.
      level: (yield* fs.readDirectory(docs)).length,
      // A file is still one path.
      file: yield* Effect.as(fs.copy(join(root, "README.md"), join(root, "README.copy.md")), "copied")
    }
  }))
  expect(result).toEqual({
    ceiling: `fs:write:${docs}/**: outside capability ceiling`,
    allow: `ask fs:read:${docs}/**`,
    list: `ask fs:read:${docs}/**`,
    watch: `ask fs:read:${docs}/**`,
    level: 1,
    file: "copied"
  })
  expect(existsSync(join(docs, "guide.md"))).toBe(true)
  expect(existsSync(join(root, "copy"))).toBe(false)

  // A person who allowed making a directory did not allow removing a tree.
  const attended = await guarded({ allow: [], workspace: root, attended: true }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const answer = (count: number) =>
      Effect.gen(function*() {
        let requests = yield* Capability.pending
        while (requests.length < count) {
          yield* Effect.yieldNow
          requests = yield* Capability.pending
        }
        return requests
      })
    const making = yield* Effect.forkChild(fs.makeDirectory(join(root, "out")))
    const made = yield* answer(1)
    yield* Capability.reply(made[0]!.requestId, "run")
    yield* Fiber.join(making)
    const removing = yield* Effect.forkChild(fs.remove(join(root, "out"), { recursive: true }))
    const tree = yield* answer(1)
    yield* Fiber.interrupt(removing)
    return { made: made.map((request) => request.capability.resource), tree: tree.map((request) => request.capability.resource) }
  }))
  expect(attended).toEqual({ made: [join(root, "out")], tree: [`${join(root, "out")}/**`] })
  expect(existsSync(join(root, "out"))).toBe(true)
})

test("what the host creates on the way is asked about too, and a handle does not outrank its open", async () => {
  mkdirSync(join(root, "data"))
  writeFileSync(join(root, "run.sh"), "#!/bin/sh")
  const result = await guarded({
    allow: [`fs:read:${root}/**`, `fs:write:${root}/data/*`, `fs:write:${root}/nested/**`, `fs:write:${root}/nested`],
    deny: [`fs:write:${root}/data/*/*`, `fs:write:${root}/nested/x`]
  }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const experimental = yield* Effect.service(ExperimentalFileSystem.FileSystem)
    const asked = <A>(effect: Effect.Effect<A, PlatformError.PlatformError, never>) =>
      Effect.map(Effect.flip(effect), (error) => {
        const read = refusal(error)
        const capability = (read.denied ?? read.required)?.capability
        return capability === undefined ? `not a refusal: ${error.message}` : Capability.format(capability)
      })
    // A temporary file is a new directory and a file inside it.
    const temporaryFile = yield* asked(fs.makeTempFile({ directory: join(root, "data"), prefix: "p", suffix: ".txt" }))
    const temporaryDirectory = yield* fs.makeTempDirectory({ directory: join(root, "data"), prefix: "p" })
    // A recursive makeDirectory creates every missing directory above the one named.
    const ancestors = yield* asked(fs.makeDirectory(join(root, "nested", "x", "y"), { recursive: true }))
    yield* fs.makeDirectory(join(root, "nested", "a", "b"), { recursive: true })
    // A handle opened to read may not change the file's mode.
    const handle = yield* experimental.open(join(root, "run.sh"), { flag: "r" })
    const mode = yield* asked(handle.chmod(0o777))
    const read = new TextDecoder().decode(Option.getOrThrow(yield* handle.readAlloc(64)))
    return { temporaryFile, temporaryDirectory, ancestors, mode, read }
  }))
  expect(result.temporaryFile).toBe(`fs:write:${join(root, "data", "pXXXXXX", "XXXXXXXXXXXX.txt")}`)
  expect(result.temporaryDirectory.startsWith(join(root, "data", "p"))).toBe(true)
  expect(result.ancestors).toBe(`fs:write:${join(root, "nested", "x")}`)
  expect(existsSync(join(root, "nested", "x"))).toBe(false)
  expect(existsSync(join(root, "nested", "a", "b"))).toBe(true)
  expect(result.mode).toBe(`fs:write:${join(root, "run.sh")}`)
  expect(result.read).toBe("#!/bin/sh")
  expect((statSync(join(root, "run.sh")).mode & 0o777).toString(8)).not.toBe("777")
})

test("a glob fails for the kernel's refusal only, and a request is sent as the caller wrote it", async () => {
  mkdirSync(join(root, "closed"))
  writeFileSync(join(root, "closed", "notes.md"), "n")
  hits.length = 0
  const origin = `http://127.0.0.1:${server.port}`
  {
    const result = await guarded({ allow: [`fs:read:${root}/**`, `fs:read:${root}`, `net:get:${origin}/admin`, `net:get:${origin}/redirect-ok`, `net:get:${origin}/ok?via=redirect`] }, Effect.gen(function*() {
      const fs = yield* fileSystem
      const client = yield* Effect.service(HttpClient.HttpClient)
      return {
        // The operating system's own refusal and a missing root are skipped, as without a guard.
        skipped: (yield* fs.glob("**/*.md", { root })).sort(),
        missing: yield* fs.glob("*.md", { root: join(root, "absent") }),
        // One literal percent sign and "61": the server reads "%61dmin", which is not "/admin".
        twice: yield* Effect.flip(client.get(`${origin}/%%36%31dmin`)),
        // A caller that asked for an error on a redirect gets one.
        redirect: yield* Effect.flip(Effect.provideService(client.get(`${origin}/redirect-ok`), FetchHttpClient.RequestInit, { redirect: "error" })),
        // The refusal the walk skipped is still the answer to a caller that lists the directory itself.
        listed: yield* Effect.flip(fs.readDirectory(join(root, "closed")))
      }
    }), unlistable(join(root, "closed")))
    expect(result.skipped).toEqual(["README.md", "docs/guide.md"])
    expect(result.listed.reason._tag).toBe("PermissionDenied")
    expect(refusal(result.listed)).toEqual({ required: undefined, denied: undefined })
    expect(result.missing).toEqual([])
    expect(refusal(result.twice).required?.capability.resource).toBe(`${origin}/%%36%31dmin`)
    expect(refusal(result.redirect)).toEqual({ required: undefined, denied: undefined })
    expect(result.redirect.reason._tag).toBe("TransportError")
    expect(hits).toEqual(["GET /redirect-ok"])
  }
})
