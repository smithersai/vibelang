// The edges of VIP-58's kernel: the ways one path or one URL can be
// spelled, what a request may carry besides its URL, and how stores and
// guards combine when a layer is provided more than once.
import { afterEach, beforeEach, expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Fiber, FileSystem, Layer, Option } from "effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as ChildProcess from "effect/process/ChildProcess"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import fc from "fast-check"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Capability } from "vibelang-runtime/experimental"
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const command = "bun test tests/capability-edges.test.ts"

let base = ""
let root = ""
let outside = ""
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-capability-edges-")))
  root = join(base, "workspace")
  outside = join(base, "outside")
  mkdirSync(join(root, "docs"), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(root, "README.md"), "hello")
  writeFileSync(join(outside, "secret.txt"), "secret")
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const platform = Layer.mergeAll(NodeServices.layer, ExperimentalNodeServices.layer, FetchHttpClient.layer)
const guarded = <A, E>(options: Capability.GuardOptions, program: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    Effect.scoped(Effect.provide(Effect.provide(program, Capability.guard(options)), platform)) as Effect.Effect<A, E>
  )
const fileSystem = Effect.service(FileSystem.FileSystem)
const failed = <A>(effect: Effect.Effect<A, any, any>): Effect.Effect<boolean, never, any> =>
  Effect.match(effect, { onFailure: () => true, onSuccess: () => false })

test("`?` matches one character, whatever its code point", () => {
  const policy = { allow: ["fs:*:/ws/**"], deny: ["fs:*:/ws/?.key"] } as const
  expect(Capability.evaluate(policy, "fs:read:/ws/a.key")).toBe("deny")
  expect(Capability.evaluate(policy, "fs:read:/ws/é.key")).toBe("deny")
  // Two code units, one character.
  expect(Capability.evaluate(policy, "fs:read:/ws/\u{1F511}.key")).toBe("deny")
  // And it is one character, not two.
  expect(Capability.matches("fs:read:/ws/??.key", "fs:read:/ws/\u{1F511}.key")).toBe(false)
  expect(Capability.matches("fs:read:/ws/*?.key", "fs:read:/ws/a\u{1F511}.key")).toBe(true)
})

test("a path with an empty segment names the path without it", async () => {
  const policy = { allow: ["fs:*:/ws/**"], deny: ["fs:*:/ws/.env", "fs:*:/ws/secrets", "fs:*:/ws/secrets/**"] } as const
  // Control: the plain spelling, and a dot segment.
  expect(Capability.evaluate(policy, "fs:read:/ws/.env")).toBe("deny")
  expect(Capability.evaluate(policy, "fs:read:/ws/docs/../.env")).toBe("deny")
  const forms = ["fs:read:/ws//.env", "fs:write:/ws//secrets/key", "fs:read:/ws/secrets/", "fs:read://ws/.env"] as const
  expect(forms.map((form) => Capability.evaluate(policy, form))).toEqual(["deny", "deny", "deny", "deny"])
  // An allow must select both texts, and an ordinary directory spelled with
  // a trailing slash is still allowed.
  expect(Capability.evaluate(policy, "fs:read:/ws/docs/")).toBe("allow")
  expect(Capability.evaluate({ allow: ["fs:read:/ws/docs/"] }, "fs:read:/ws/docs/")).toBe("ask")
  expect(Capability.evaluate({ allow: ["fs:read:/"] }, "fs:read:/")).toBe("allow")
  const refused = await Effect.runPromise(Effect.scoped(Effect.provide(
    Effect.all([failed(Capability.check("fs:read:/ws//.env")), failed(Capability.check("fs:write:/ws//secrets/key"))]),
    Capability.grantStore({ allow: ["fs:*:/ws/**"], deny: ["fs:*:/ws/.env", "fs:*:/ws/secrets/**"], attended: false })
  )))
  expect(refused).toEqual([true, true])
})

test("extra slashes never turn a denied path into another answer", async () => {
  const name = fc.constantFrom("a", "b", "secrets", ".env")
  await checkProperty(fc, {
    name: "capability-path-empty-segment",
    rule: "VIP-58: a path with an empty segment names what the path without it names, so a deny on either spelling refuses both",
    command,
    arbitrary: fc.record({
      names: fc.array(name, { minLength: 1, maxLength: 4 }),
      denied: fc.array(name, { minLength: 1, maxLength: 4 }),
      slashes: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 5, maxLength: 5 }),
      trailing: fc.boolean(),
      tree: fc.boolean()
    }),
    numRuns: 2000,
    check: ({ names, denied, slashes, trailing, tree }: {
      names: Array<string>
      denied: Array<string>
      slashes: Array<number>
      trailing: boolean
      tree: boolean
    }) => {
      const plain = `/${names.join("/")}`
      const spelled = `${names.map((part, index) => `${"/".repeat(slashes[index]!)}${part}`).join("")}${trailing ? "/" : ""}`
      const policy: Capability.Policy = {
        allow: ["fs:*:**"],
        deny: [`fs:*:/${denied.join("/")}${tree ? "/**" : ""}` as Capability.PatternText]
      }
      const expected = Capability.evaluate(policy, Capability.make("fs:read", plain))
      const actual = Capability.evaluate(policy, Capability.make("fs:read", spelled))
      // The plain spelling refused is every spelling refused, and no
      // spelling is allowed that the plain one is not.
      if (expected === "deny") expect(actual).toBe("deny")
      if (actual === "allow") expect(expected).toBe("allow")
    }
  })
})

test("a network rule applies however its host, port and path are written", async () => {
  const server = Bun.serve({ port: 0, fetch: (request) => new Response(`served ${new URL(request.url).pathname}`) })
  const port = server.port
  try {
    const result = await guarded({
      allow: ["net:get:**"],
      deny: [
        `net:get:http://LocalHost:${port}/**`,
        `net:get:http://127.0.0.1:${port}/café/**`,
        `net:get:http://127.0.0.1:${port}/my files/**`,
        `net:get:http://127.0.0.1:${port}/{team}/**`
      ]
    }, Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      return {
        upperCaseHost: yield* failed(client.get(`http://localhost:${port}/x`)),
        nonAscii: yield* failed(client.get(`http://127.0.0.1:${port}/café/x`)),
        space: yield* failed(client.get(`http://127.0.0.1:${port}/my files/x`)),
        // The platform sends this path as `/%7Bteam%7D/x`.
        braces: yield* failed(client.get(`http://127.0.0.1:${port}/{team}/x`)),
        other: yield* failed(client.get(`http://127.0.0.1:${port}/open/x`))
      }
    }))
    expect(result).toEqual({ upperCaseHost: true, nonAscii: true, space: true, braces: true, other: false })
  } finally {
    server.stop(true)
  }
  const evaluate = Capability.evaluate
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://internal.example:443/**"] }, "net:get:https://internal.example/admin")).toBe("deny")
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:http://internal.example:80/**"] }, "net:get:http://internal.example/admin")).toBe("deny")
  // The default port of the other scheme is a different port.
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://internal.example:80/**"] }, "net:get:https://internal.example/admin")).toBe("allow")
  // An allow is read the same way.
  expect(evaluate({ allow: ["net:get:https://API.Example.com:443/v1/*"] }, "net:get:https://api.example.com/v1/users")).toBe("allow")
  expect(evaluate({ allow: ["net:get:https://*.café.example/*"] }, "net:get:https://api.xn--caf-dma.example/x")).toBe("allow")
  // A character a URL encodes in one part and not in another is read as its
  // escape on both sides, however the rule and the request write it.
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://h.example/{a}/**"] }, "net:get:https://h.example/%7Ba%7D/b")).toBe("deny")
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://h.example/%7Ba%7D/**"] }, "net:get:https://h.example/{a}/b")).toBe("deny")
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://h.example/x^y`z"] }, "net:get:https://h.example/x%5Ey%60z")).toBe("deny")
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://h.example/s?q='a'"] }, "net:get:https://h.example/s?q=%27a%27")).toBe("deny")
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://h.example/s?q={a}|b"] }, "net:get:https://h.example/s?q=%7Ba%7D%7Cb")).toBe("deny")
  expect(evaluate({ allow: ["net:get:https://h.example/{a}/*"] }, "net:get:https://h.example/%7Ba%7D/b")).toBe("allow")
  // Only those characters: an escaped `/` is not a `/`.
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:https://h.example/a/b"] }, "net:get:https://h.example/a%2Fb")).toBe("allow")
  // A path keeps its case: only the scheme and the host are folded.
  expect(evaluate({ allow: ["net:get:https://h.example/Admin"] }, "net:get:https://h.example/admin")).toBe("ask")
  // A deny as its author wrote it still selects the same text.
  expect(evaluate({ allow: ["net:get:**"], deny: ["net:get:*Admin*"] }, "net:get:https://h.example/Admin/x")).toBe("deny")
})

test("a rule written in any spelling of a URL selects the request for it", async () => {
  const mixed = (text: string, mask: number): string =>
    Array.from(text, (unit, index) => (mask >> (index % 16)) & 1 ? unit.toUpperCase() : unit).join("")
  await checkProperty(fc, {
    name: "capability-net-spelling",
    rule: "VIP-58: a network pattern and a request are read in one spelling, the request's: host in lower case, no default port, a space, a letter outside ASCII and the characters a URL encodes percent-encoded",
    command,
    arbitrary: fc.record({
      secure: fc.boolean(),
      host: fc.constantFrom("api.example.com", "localhost", "internal.example", "café.example"),
      mask: fc.integer({ min: 0, max: 65535 }),
      defaultPort: fc.boolean(),
      segments: fc.array(fc.constantFrom("a", "v1", "my files", "café", "~x", "A", "{a}", "x^y", "`b", "'q'", "a|b"), { maxLength: 3 }),
      query: fc.constantFrom("", "?q=1", "?q={z}", "?q='z'", "?q=a|b", "?q=my z", "?q=`x^")
    }),
    numRuns: 1500,
    check: ({ secure, host, mask, defaultPort, segments, query }: {
      secure: boolean
      host: string
      mask: number
      defaultPort: boolean
      segments: Array<string>
      query: string
    }) => {
      const scheme = secure ? "https" : "http"
      const written = `${scheme}://${mixed(host, mask)}${defaultPort ? (secure ? ":443" : ":80") : ""}/${segments.join("/")}${query}`
      // The platform's own URL type says how the request is written.
      const url = new URL(written)
      const requested = Capability.make("net:get", `${url.protocol}//${url.host}${url.pathname}${url.search}`)
      const pattern = `net:get:${written}` as Capability.PatternText
      expect(Capability.evaluate({ allow: ["net:get:**"], deny: [pattern] }, requested)).toBe("deny")
      expect(Capability.evaluate({ allow: [pattern] }, requested)).toBe("allow")
      // A different host is a different request.
      const elsewhere = Capability.make("net:get", `${url.protocol}//elsewhere.test${url.pathname}${url.search}`)
      expect(Capability.evaluate({ allow: [pattern] }, elsewhere)).toBe("ask")
    }
  })
})

test("a network grant does not read a local file: a `file:` URL is refused, direct or by redirect", async () => {
  const secret = join(outside, "secret.txt")
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 302, headers: { location: `file://files.invalid${secret}` } })
  })
  try {
    const body = (url: string) =>
      Effect.flatMap(Effect.service(HttpClient.HttpClient), (client) =>
        Effect.match(Effect.flatMap(client.get(url), (response) => response.text), {
          onFailure: (error) => Option.isSome(Capability.denied(error)) ? "refused" : "failed",
          onSuccess: (text) => `read: ${text}`
        }))
    const result = await guarded({ allow: ["net:get:**"], deny: ["fs:*:**"] }, Effect.gen(function*() {
      return {
        noHost: yield* body(`file://${secret}`),
        withHost: yield* body(`file://files.invalid${secret}`),
        redirected: yield* body(`http://127.0.0.1:${server.port}/page`),
        otherScheme: yield* body("ftp://files.invalid/x")
      }
    }))
    expect(result).toEqual({ noHost: "refused", withHost: "refused", redirected: "refused", otherScheme: "refused" })
  } finally {
    server.stop(true)
  }
})

test("a request is sent where its URL says: a `RequestInit` member outside the Fetch standard is refused", async () => {
  const proxyHits: Array<string> = []
  const socketHits: Array<string> = []
  const socket = join(base, "s.sock")
  const proxy = Bun.serve({ port: 0, fetch: (request) => { proxyHits.push(request.url); return new Response("from the proxy") } })
  const unix = Bun.serve({ unix: socket, fetch: (request) => { socketHits.push(request.url); return new Response("from the socket") } })
  const target = Bun.serve({ port: 0, fetch: (request) => new Response(`served ${request.headers.get("x-probe")}`) })
  try {
    const result = await guarded({ allow: ["net:get:http://allowed.invalid/**", `net:get:http://127.0.0.1:${target.port}/**`], deny: ["fs:*:**"] }, Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      const get = client.get("http://allowed.invalid/data?token=1")
      const reason = (init: RequestInit) =>
        Effect.map(Effect.flip(Effect.provideService(get, FetchHttpClient.RequestInit, init)), (error) =>
          Option.match(Capability.denied(error), { onNone: () => "not a refusal", onSome: (denied) => denied.reason }))
      return {
        proxy: yield* reason({ proxy: `http://127.0.0.1:${proxy.port}` } as RequestInit),
        unix: yield* reason({ unix: socket } as RequestInit),
        // The standard's own members pass through to the client underneath.
        standard: yield* Effect.flatMap(
          Effect.provideService(
            client.get(`http://127.0.0.1:${target.port}/ok`),
            FetchHttpClient.RequestInit,
            { headers: { "x-probe": "kept" }, credentials: "omit", cache: "no-store" }
          ),
          (response) => response.text
        )
      }
    }))
    expect(result.proxy).toContain("RequestInit holds proxy")
    expect(result.unix).toContain("RequestInit holds unix")
    expect(result.standard).toBe("served kept")
    // The policy allows one host. Nothing else received the request.
    expect({ proxyHits, socketHits }).toEqual({ proxyHits: [], socketHits: [] })
  } finally {
    proxy.stop(true)
    unix.stop(true)
    target.stop(true)
  }
})

test("the command that runs is the command that was asked about", async () => {
  const marker = join(root, "marker.txt")
  const result = await guarded({ allow: [], attended: true, workspace: root }, Effect.gen(function*() {
    const args = ["-c", "true"]
    const environment: Record<string, string> = { GREETING: "hello" }
    const given = ChildProcess.make("sh", args, { cwd: root, env: environment, extendEnv: true })
    const spawner = yield* ChildProcessSpawner
    const fiber = yield* Effect.forkChild(Effect.exit(spawner.exitCode(given)))
    let pending: ReadonlyArray<Capability.Request> = []
    for (let turn = 0; turn < 100 && pending.length === 0; turn += 1) {
      yield* Effect.sleep("10 millis")
      pending = yield* Capability.pending
    }
    const asked = pending.map((request) => Capability.format(request.capability))
    // The caller changes its own array and environment while the request waits.
    args[1] = `echo changed > ${marker}`
    environment.ENV = marker
    yield* Capability.reply(pending[0]!.requestId, "once")
    yield* Fiber.join(fiber)
    return asked
  }))
  expect(result).toEqual(["proc:spawn:env GREETING -- sh -c true"])
  expect(existsSync(marker)).toBe(false)
})

test("a layer provided again further in is built again, inside everything between", async () => {
  const wide = Capability.guard({ allow: [`fs:*:${base}/**`] })
  const strict = Capability.guard({ allow: [`fs:read:${root}/**`], deny: [`fs:*:${outside}/**`] })
  const task = Effect.gen(function*() {
    const fs = yield* fileSystem
    return {
      readRefused: yield* failed(fs.readFileString(join(outside, "secret.txt"))),
      writeRefused: yield* failed(fs.writeFileString(join(outside, "planted.txt"), "x")),
      checkRefused: yield* failed(Capability.check(Capability.make("fs:write", join(outside, "planted.txt")))),
      readAllowed: yield* failed(fs.readFileString(join(root, "README.md")))
    }
  })
  const run = (inner: Layer.Layer<never>) =>
    Effect.runPromise(Effect.scoped(
      task.pipe(Effect.provide(inner), Effect.provide(strict), Effect.provide(wide), Effect.provide(platform)) as Effect.Effect<any>
    ))
  const narrowed = { readRefused: true, writeRefused: true, checkRefused: true, readAllowed: false }
  // Control: a second layer object with the same policy.
  expect(await run(Capability.guard({ allow: [`fs:*:${base}/**`] }))).toEqual(narrowed)
  // The same layer object: the strict guard between its two uses still holds.
  expect(await run(wide)).toEqual(narrowed)
  expect(existsSync(join(outside, "planted.txt"))).toBe(false)

  const wideStore = Capability.grantStore({ allow: ["memory:*:**"], attended: false })
  const strictStore = Capability.grantStore({ allow: ["memory:read:**"], deny: ["memory:write:**"], attended: false })
  const refused = await Effect.runPromise(Effect.scoped(
    failed(Capability.check("memory:write:notes")).pipe(Effect.provide(wideStore), Effect.provide(strictStore), Effect.provide(wideStore)) as Effect.Effect<boolean>
  ))
  expect(refused).toBe(true)
})

test("guards combine by nesting: merged side by side, the later one replaces the earlier", async () => {
  const strict = Capability.guard({ allow: [`fs:read:${root}/**`], deny: [`fs:*:${outside}/**`] })
  const wide = Capability.guard({ allow: [`fs:*:${base}/**`] })
  const refused = (layer: Layer.Layer<never>) =>
    Effect.runPromise(Effect.scoped(
      Effect.flatMap(fileSystem, (fs) => failed(fs.readFileString(join(outside, "secret.txt")))).pipe(
        Effect.provide(layer),
        Effect.provide(platform)
      ) as Effect.Effect<boolean>
    ))
  // Nested either way round, both policies decide.
  expect(await refused(Layer.provide(strict, wide))).toBe(true)
  expect(await refused(Layer.provide(wide, strict))).toBe(true)
  // Merged, they are two layers that provide the same services.
  expect(await refused(Layer.mergeAll(wide, strict))).toBe(true)
  expect(await refused(Layer.mergeAll(strict, wide))).toBe(false)
})

test("a ceiling travels in the context: a context captured outside an attenuate carries the outer ceiling", async () => {
  const result = await Effect.runPromise(
    Capability.attenuate(["fs:read:/a/**"])(Effect.gen(function*() {
      const captured = yield* Effect.context<never>()
      return yield* Capability.attenuate(["fs:read:/a/b/**"])(Effect.gen(function*() {
        return {
          plain: yield* failed(Capability.check("fs:read:/a/x")),
          // No attenuate inside widens the ceiling again.
          star: yield* failed(Capability.attenuate(["*"])(Capability.check("fs:read:/a/x"))),
          // The captured context is the outer authority, and no more than it.
          provided: yield* failed(Effect.provide(Capability.check("fs:read:/a/x"), captured)),
          providedOutside: yield* failed(Effect.provide(Capability.check("fs:read:/z"), captured))
        }
      }))
    }))
  )
  expect(result).toEqual({ plain: true, star: true, provided: false, providedOutside: true })
})

test("a remembered answer is in the journal and applied, or in neither", async () => {
  const written: Array<Capability.RememberedGrant> = []
  const journal = Layer.succeed(Capability.GrantJournal, {
    remembered: Effect.sync(() => written.slice()),
    remember: (grant: Capability.RememberedGrant) => Effect.sync(() => void written.push(grant))
  })
  const result = await Effect.runPromise(Effect.scoped(Effect.provide(Effect.gen(function*() {
    const parked = (capability: Capability.CapabilityText) => Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Capability.check(capability))
      let pending: ReadonlyArray<Capability.Request> = []
      for (let turn = 0; turn < 100 && pending.length === 0; turn += 1) {
        yield* Effect.yieldNow
        pending = yield* Capability.pending
      }
      return { fiber, id: pending[pending.length - 1]?.requestId }
    })
    // Fill the store to its limit of 1,024 grants.
    for (let index = 0; index < 1024; index += 1) {
      const { fiber, id } = yield* parked(`memory:read:key-${index}`)
      yield* Capability.reply(id!, index === 0 ? "remembered" : "run")
      yield* Fiber.join(fiber)
    }
    const first = yield* parked("memory:read:extra")
    const answered = yield* Capability.reply(first.id!, "remembered")
    yield* Fiber.join(first.fiber)
    const again = yield* parked("memory:read:extra")
    yield* Fiber.interrupt(again.fiber)
    return {
      answered,
      journaled: written.map((grant) => grant.capability.resource),
      asksAgain: again.id !== undefined,
      firstStillGranted: yield* failed(Capability.check("memory:read:key-0"))
    }
  }), Layer.provide(Capability.journaled({ allow: [] }), journal))))
  // Below the limit the grant is written and applied. At the limit the
  // answer lets the one operation through and writes nothing.
  expect(result).toEqual({ answered: true, journaled: ["key-0"], asksAgain: true, firstStillGranted: false })
}, 30000)

test("a flag outside the platform's list asks to read and to write", async () => {
  writeFileSync(join(root, "wo.txt"), "write-only content")
  const result = await guarded({ allow: [`fs:write:${root}/wo.txt`], deny: [`fs:read:${root}/**`] }, Effect.gen(function*() {
    const fs = yield* fileSystem
    return {
      unlisted: yield* failed(fs.open(join(root, "wo.txt"), { flag: "rs" as FileSystem.OpenFlag })),
      write: yield* failed(fs.open(join(root, "wo.txt"), { flag: "a" }))
    }
  }))
  expect(result).toEqual({ unlisted: true, write: false })
})

test("a recursive listing does not descend through a link", async () => {
  mkdirSync(join(root, "d", "inner"), { recursive: true })
  writeFileSync(join(root, "d", "inner", "note.txt"), "note")
  symlinkSync(outside, join(root, "d", "l"))
  const result = await guarded(
    { allow: ["fs:read:**"], deny: [`fs:*:${outside}`, `fs:*:${outside}/**`] },
    Effect.gen(function*() {
      const fs = yield* fileSystem
      return {
        direct: yield* failed(fs.readDirectory(join(root, "d", "l"))),
        recursive: (yield* fs.readDirectory(join(root, "d"), { recursive: true })).slice().sort()
      }
    })
  )
  expect(result.direct).toBe(true)
  // The link is a name in the listing. What it leads to is not listed.
  expect(result.recursive).toEqual(["inner", join("inner", "note.txt"), "l"])
})

test("a deny on a path as written refuses before anything is resolved", async () => {
  mkdirSync(join(outside, "dir"))
  symlinkSync(join(outside, "dir"), join(outside, "pointer"))
  // A name inside the workspace that leads somewhere allowed.
  mkdirSync(join(root, "real"))
  writeFileSync(join(root, "real", "a.txt"), "a")
  symlinkSync(join(root, "real"), join(root, "alias"))
  const result = await guarded({
    allow: [`fs:*:${root}/**`],
    deny: [`fs:*:${outside}`, `fs:*:${outside}/**`, `fs:*:${root}/alias/**`]
  }, Effect.gen(function*() {
    const fs = yield* fileSystem
    const tell = (input: string) => Effect.map(Effect.flip(fs.exists(input)), (error) => ({
      refusal: Option.isSome(Capability.denied(error)),
      text: `${error.reason._tag} ${error.message}`
    }))
    return {
      underFile: yield* tell(join(outside, "secret.txt", "x")),
      underDirectory: yield* tell(join(outside, "dir", "x")),
      underMissing: yield* tell(join(outside, "missing", "x")),
      link: yield* tell(join(outside, "pointer")),
      // The deny names the alias: it holds although the file it leads to is allowed.
      alias: yield* failed(fs.readFileString(join(root, "alias", "a.txt"))),
      real: yield* failed(fs.readFileString(join(root, "real", "a.txt")))
    }
  }))
  expect({
    // Each is a refusal, whatever is on the disk there.
    refusals: [result.underFile.refusal, result.underDirectory.refusal, result.underMissing.refusal],
    // The three read the same but for the path that was asked about.
    sameText: new Set([result.underFile, result.underDirectory, result.underMissing].map((told) => told.text.replace(/secret\.txt|dir|missing/g, "NAME"))).size,
    // Where the link leads is not in what the caller gets back.
    linkTargetShown: result.link.text.includes(join(outside, "dir")),
    alias: result.alias,
    real: result.real
  }).toEqual({ refusals: [true, true, true], sameText: 1, linkTargetShown: false, alias: true, real: false })
})
