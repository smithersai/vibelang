import { expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import fc from "fast-check"
import { Effect, FileSystem, Layer, Result, Stream } from "effect"
import * as ChildProcess from "effect/process/ChildProcess"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Sandbox from "../src/experimental/Sandbox.js"
import { keptVariables, plan, resolveIn, shellVariables } from "../src/experimental/internal/sandbox.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const command = "bun test tests/sandbox-isolation.property.test.ts"

const string = (cmd: ChildProcess.Command) =>
  Effect.flatMap(Effect.service(ChildProcessSpawner), (spawner) => spawner.string(cmd))

const bytes = (cmd: ChildProcess.Command) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner
    const handle = yield* spawner.spawn(cmd)
    const chunks = yield* Stream.runCollect(handle.stdout)
    let length = 0
    for (const chunk of chunks) length += chunk.length
    const out = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }))

// One directory sandbox for every run of a property: a run spawns processes,
// and building a layer per run would measure the layer, not the property.
const withDirectory = async <A>(body: (run: <B, E>(effect: Effect.Effect<B, E, Sandbox.Host>) => Promise<B>) => Promise<A>) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibe-sandbox-property-")))
  try {
    const layer = Sandbox.directory(root).pipe(Layer.provide(NodeServices.layer))
    return await body((effect) => Effect.runPromise(Effect.provide(effect, layer)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const argument = fc.string({ unit: "grapheme", maxLength: 24 }).filter((text) => !text.includes("\0") && !text.includes("\n"))

test("VIP-67: arguments reach the program unchanged, on a real machine and in the interpreter", async () => {
  await withDirectory(async (run) => {
    await checkProperty(fc, {
      name: "sandbox-argv-directory",
      rule: "VIP-67: the same ChildProcess.make call means the same argv inside a sandbox",
      command,
      arbitrary: fc.array(argument, { minLength: 1, maxLength: 5 }),
      numRuns: 25,
      check: async (args: Array<string>) => {
        const out = await run(string(ChildProcess.make("printf", ["%s\\n", ...args])))
        expect(out).toBe(args.map((arg) => `${arg}\n`).join(""))
      }
    })
  })
  const layer = Sandbox.interpreter()
  await checkProperty(fc, {
    name: "sandbox-argv-interpreter",
    rule: "VIP-67: the interpreter reads the quoted command line back into the same words",
    command,
    arbitrary: fc.array(argument, { minLength: 1, maxLength: 5 }),
    numRuns: 300,
    check: async (args: Array<string>) => {
      const out = await Effect.runPromise(Effect.provide(string(ChildProcess.make("printf", ["%s\\n", ...args])), layer))
      expect(out).toBe(args.map((arg) => `${arg}\n`).join(""))
    }
  })
}, 60_000)

const declaredName = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,10}$/).filter((name) =>
  !keptVariables.includes(name) && !shellVariables.includes(name) && !name.startsWith("LC_")
)
const declaredValue = fc.string({ unit: "grapheme", maxLength: 20 }).filter((text) => !text.includes("\0") && !text.includes("\n"))

test("VIP-67 rule 3: a child sees the kept variables and exactly what its caller declares", async () => {
  process.env["VIBE_PROPERTY_CANARY"] = "host-only"
  try {
    await withDirectory(async (run) => {
      await checkProperty(fc, {
        name: "sandbox-environment",
        rule: "VIP-67 rule 3: the environment is replaced, not inherited",
        command,
        arbitrary: fc.dictionary(declaredName, declaredValue, { maxKeys: 4 }),
        numRuns: 25,
        check: async (declared: Record<string, string>) => {
          const out = await run(string(ChildProcess.make("env", [], { env: declared, extendEnv: true })))
          const seen = new Map(out.split("\n").filter((line) => line.includes("=")).map((line) => {
            const at = line.indexOf("=")
            return [line.slice(0, at), line.slice(at + 1)] as const
          }))
          for (const [name, value] of Object.entries(declared)) expect(seen.get(name)).toBe(value)
          for (const name of seen.keys()) {
            const allowed = name in declared || keptVariables.includes(name) || shellVariables.includes(name) || name.startsWith("LC_")
            expect([name, allowed]).toEqual([name, true])
          }
        }
      })
    })
  } finally {
    delete process.env["VIBE_PROPERTY_CANARY"]
  }
}, 60_000)

test("VIP-67 rule 4: standard input is delivered whole, however it is chunked", async () => {
  const input = fc.record({
    data: fc.uint8Array({ maxLength: 70_000 }),
    cuts: fc.array(fc.nat(), { maxLength: 6 })
  })
  const chunks = (data: Uint8Array, cuts: Array<number>) => {
    const points = [...new Set(cuts.map((cut) => cut % (data.length + 1)))].sort((a, b) => a - b)
    const out: Array<Uint8Array> = []
    let start = 0
    for (const point of points) {
      out.push(data.slice(start, point))
      start = point
    }
    out.push(data.slice(start))
    return out
  }
  await withDirectory(async (run) => {
    await checkProperty(fc, {
      name: "sandbox-stdin-directory",
      rule: "VIP-67 rule 4: standard input is delivered whole or refused before the spawn",
      command,
      arbitrary: input,
      numRuns: 20,
      check: async ({ data, cuts }: { data: Uint8Array; cuts: Array<number> }) => {
        const out = await run(bytes(ChildProcess.make("cat", [], { stdin: Stream.fromIterable(chunks(data, cuts)) })))
        expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true)
      }
    })
  })
  const layer = Sandbox.interpreter()
  await checkProperty(fc, {
    name: "sandbox-stdin-interpreter",
    rule: "VIP-67 rule 4: the interpreter's cat answers its whole input",
    command,
    arbitrary: input,
    numRuns: 200,
    check: async ({ data, cuts }: { data: Uint8Array; cuts: Array<number> }) => {
      const out = await Effect.runPromise(Effect.provide(bytes(ChildProcess.make("cat", [], { stdin: Stream.fromIterable(chunks(data, cuts)) })), layer))
      expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true)
    }
  })
}, 60_000)

test("VIP-67 rule 4: a command is refused exactly when it asks for a feature a sandbox cannot honor", async () => {
  await checkProperty(fc, {
    name: "sandbox-refusals",
    rule: "VIP-67 rule 4: extra descriptors, inherited stdin, detached processes and custom shells fail with BadArgument",
    command,
    arbitrary: fc.record({
      detached: fc.option(fc.boolean(), { nil: undefined }),
      shell: fc.option(fc.oneof(fc.boolean(), fc.constantFrom("/bin/bash", "zsh")), { nil: undefined }),
      stdin: fc.option(fc.constantFrom("pipe", "inherit", "ignore"), { nil: undefined }),
      fds: fc.boolean(),
      piped: fc.boolean()
    }),
    numRuns: 500,
    check: async (input: {
      detached: boolean | undefined
      shell: boolean | string | undefined
      stdin: "pipe" | "inherit" | "ignore" | undefined
      fds: boolean
      piped: boolean
    }) => {
      const options = {
        ...(input.detached === undefined ? {} : { detached: input.detached }),
        ...(input.shell === undefined ? {} : { shell: input.shell }),
        ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        ...(input.fds ? { additionalFds: { fd3: { type: "output" } } } : {})
      } as ChildProcess.CommandOptions
      const one = ChildProcess.make("echo", ["x"], options)
      const cmd = input.piped ? ChildProcess.make("cat", []).pipe(ChildProcess.pipeTo(one)) : one
      const refused = input.detached === true || typeof input.shell === "string" || input.fds ||
        (input.stdin === "inherit" && !input.piped)
      const planned = plan(cmd)
      expect(Result.isFailure(planned)).toBe(refused)
      if (Result.isFailure(planned)) expect(planned.failure.reason._tag).toBe("BadArgument")
    }
  })
})

const segment = fc.constantFrom("a", "b", "..", ".", "dir", "x y", "")

test("VIP-67: a relative path resolves inside the machine's directory unless it climbs out", async () => {
  await checkProperty(fc, {
    name: "sandbox-path-resolution",
    rule: "VIP-67: relative paths resolve against the machine's directory in normalized POSIX form",
    command,
    arbitrary: fc.record({
      workdir: fc.array(fc.constantFrom("work", "space", "w"), { minLength: 1, maxLength: 3 }),
      segments: fc.array(segment, { minLength: 1, maxLength: 6 })
    }),
    numRuns: 1000,
    check: async ({ workdir, segments }: { workdir: Array<string>; segments: Array<string> }) => {
      const root = `/${workdir.join("/")}`
      const relative = segments.join("/")
      const resolved = resolveIn(root)(relative)
      expect(resolved.startsWith("/")).toBe(true)
      expect(resolved.split("/").slice(1).some((part) => part === "." || part === ".." || (part === "" && resolved !== "/"))).toBe(false)
      let depth = 0
      let escaped = false
      for (const part of segments) {
        if (part === "..") depth--
        else if (part !== "." && part !== "") depth++
        if (depth < 0) escaped = true
      }
      // A path that starts with / is absolute, the machine's own.
      if (!escaped && !relative.startsWith("/")) expect(resolved === root || resolved.startsWith(`${root}/`)).toBe(true)
    }
  })
})

test("VIP-67 rule 5: two interpreter sandboxes share nothing", async () => {
  await checkProperty(fc, {
    name: "sandbox-interpreter-isolation",
    rule: "VIP-67 rule 5: an interpreter's machine is its own; a file one writes is absent from another",
    command,
    arbitrary: fc.record({
      path: fc.array(fc.constantFrom("a", "b", "c", "deep"), { minLength: 1, maxLength: 4 }).map((parts) => parts.join("/")),
      data: fc.uint8Array({ maxLength: 64 })
    }),
    numRuns: 200,
    check: async ({ path, data }: { path: string; data: Uint8Array }) => {
      const first = Sandbox.interpreter()
      const second = Sandbox.interpreter()
      const written = await Effect.runPromise(Effect.provide(
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."
          yield* fs.makeDirectory(parent, { recursive: true })
          yield* fs.writeFile(path, data)
          return yield* bytes(ChildProcess.make("cat", [path]))
        }),
        first
      ))
      expect(Buffer.from(written).equals(Buffer.from(data))).toBe(true)
      const elsewhere = await Effect.runPromise(Effect.provide(
        Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.exists(path)),
        second
      ))
      expect(elsewhere).toBe(false)
    }
  })
})
