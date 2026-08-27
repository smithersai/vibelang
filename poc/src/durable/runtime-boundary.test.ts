import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/**
 * The runtime boundary of the published package, checked statically.
 *
 * `smthrs` ships two kinds of subpath. Most are runtime-neutral: a consumer
 * must be able to `import` them under Node. Three are declared Bun-only —
 * `./agent/bun`, `./durable/bun`, `./concurrency/bun` — and exist precisely so
 * that the Bun-only surface (SQLite persistence, the Bun worker host) stays
 * off the Node import graph.
 *
 * Nothing else in the repository can see a violation. The type-checker resolves
 * `bun:sqlite` from `@types/bun` and is happy; the unit suites all run under
 * Bun, where `bun:sqlite` loads; only `npm run verify:pack` builds a tarball and
 * imports every subpath under a real Node, and that gate costs minutes. A single
 * value import — `import { CoordinatorCrash } from "../durable/engine.ts"` from
 * `agent/sandbox.ts` — was enough to drag `bun:sqlite` onto `smthrs/agent` and
 * break it with `ERR_UNSUPPORTED_ESM_URL_SCHEME` under Node.
 *
 * So this walks the same graph from source, in milliseconds, and fails the same
 * way. It reads `package.json` rather than a hand-written list of subpaths, so a
 * newly published export is covered the moment it is declared.
 *
 * What it can and cannot see: it follows *runtime* edges only — Bun's
 * transpiler drops `import type` for us, which is what makes the walk accurate
 * — and it judges module *specifiers*. A runtime-specific **global** (a
 * top-level `Bun.serve(...)` with no `bun:` import) is out of its reach; that
 * half stays with the release fixture, which loads each subpath under Node and
 * catches the `ReferenceError`.
 */

const repositoryRoot = resolve(import.meta.dir, "../../..")
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
  exports: Record<string, string | { default?: string }>
}

/**
 * Subpaths whose module bodies are allowed to name a Bun-only specifier. Each
 * is skipped by `scripts/release-fixtures/runtime-smoke.mjs` under Node, where
 * it must *fail closed* rather than expose a half-initialized namespace.
 */
const BUN_ONLY_EXPORTS = new Set(["./agent/bun", "./durable/bun", "./concurrency/bun"])

/** Specifiers only one runtime can resolve. */
function runtimeSpecificSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith("bun:")) return "Bun-only"
  if (specifier.startsWith("deno:")) return "Deno-only"
  if (specifier.startsWith("npm:") || specifier.startsWith("jsr:")) return "Deno-only"
  if (specifier.endsWith(".node")) return "native addon"
  return undefined
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  js: new Bun.Transpiler({ loader: "js" })
}

/** Runtime import edges of one module, with `import type` already dropped. */
function runtimeEdges(file: string): readonly string[] {
  const loader = file.endsWith(".ts") ? transpilers.ts : transpilers.js
  return loader.scanImports(readFileSync(file, "utf8")).map((entry) => entry.path)
}

/**
 * Resolve a build-output path to the source that emits it. The published
 * `exports` name `dist/` and `poc/dist/`; the graph this test walks is the
 * source tree those are compiled from, so nothing here depends on a build
 * having been run.
 */
function sourceOfBuildOutput(target: string): string | undefined {
  const relative = target.replace(/^\.\//, "")
  const mapped = relative.startsWith("poc/dist/")
    ? join("poc/src", relative.slice("poc/dist/".length))
    : relative.startsWith("dist/")
      ? join("src", relative.slice("dist/".length))
      : undefined
  if (mapped === undefined) return undefined
  const withoutExtension = join(repositoryRoot, mapped.replace(/\.js$/, ""))
  for (const candidate of [`${withoutExtension}.ts`, join(withoutExtension, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

/** Resolve one relative specifier against the importer, in source terms. */
function resolveEdge(importer: string, specifier: string): string | undefined {
  const absolute = resolve(dirname(importer), specifier)
  // Root `src/*.ts` reaches the POC through its build output (`../poc/dist/x.js`).
  if (absolute.includes(`${join(repositoryRoot, "poc/dist")}/`)) {
    return sourceOfBuildOutput(absolute.slice(repositoryRoot.length + 1))
  }
  for (const candidate of [absolute, `${absolute}.ts`, join(absolute, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && candidate.endsWith(".ts")) return candidate
  }
  return undefined
}

interface Violation {
  readonly reason: string
  readonly specifier: string
  /** Import chain from the entry to the module naming the specifier. */
  readonly chain: readonly string[]
}

/** Every runtime-specific specifier reachable from one entry, with its chain. */
function walk(entry: string): readonly Violation[] {
  const seen = new Set<string>()
  const found: Violation[] = []
  const pending: { file: string; chain: readonly string[] }[] = [{ file: entry, chain: [] }]
  while (pending.length > 0) {
    const { file, chain } = pending.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const here = [...chain, file.slice(repositoryRoot.length + 1)]
    for (const specifier of runtimeEdges(file)) {
      const reason = runtimeSpecificSpecifier(specifier)
      if (reason !== undefined) {
        found.push({ reason, specifier, chain: here })
        continue
      }
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue
      const target = resolveEdge(file, specifier)
      if (target !== undefined) pending.push({ file: target, chain: here })
    }
  }
  return found
}

const entries = Object.entries(packageJson.exports).flatMap(([name, value]) => {
  if (name === "./package.json") return []
  const target = typeof value === "string" ? value : value.default
  if (target === undefined) return []
  const source = sourceOfBuildOutput(target)
  // `./compat/*.cjs` are hand-written shims over `typescript-js` with no module
  // under `src/`; they name no relative edge and no runtime-specific specifier.
  if (source === undefined) return []
  return [{ name, source }]
})

describe("published runtime boundary", () => {
  test("every published subpath backed by source is covered", () => {
    // A guard on the guard: if the dist layout changes so that nothing resolves,
    // the assertions below would all pass vacuously.
    expect(entries.length).toBeGreaterThanOrEqual(20)
    for (const bunOnly of BUN_ONLY_EXPORTS) {
      expect(entries.some((entry) => entry.name === bunOnly)).toBe(true)
    }
  })

  test.each(entries.filter((entry) => !BUN_ONLY_EXPORTS.has(entry.name)).map((entry) => [entry.name, entry.source]))(
    "%s reaches no runtime-specific specifier",
    (name, source) => {
      const violations = walk(source)
      const detail = violations
        .map((violation) => `${violation.reason} ${violation.specifier} via ${violation.chain.join(" -> ")}`)
        .join("\n")
      expect(
        violations.length === 0 ? "" : `smthrs${String(name).slice(1)} is runtime-neutral but reaches:\n${detail}`
      ).toBe("")
    }
  )

  test("the declared Bun-only subpaths still carry the Bun surface", () => {
    // The other direction. Moving an error class off the store fixed the leak;
    // moving the *store* would "fix" it by deleting the feature. `./agent/bun`
    // and `./durable/bun` exist to reach `bun:sqlite`, so pin that they do.
    for (const name of ["./agent/bun", "./durable/bun"]) {
      const entry = entries.find((candidate) => candidate.name === name)!
      const specifiers = walk(entry.source).map((violation) => violation.specifier)
      expect(specifiers).toContain("bun:sqlite")
    }
  })
})

describe("coordinator failure identity survives the split", () => {
  /**
   * Splitting a class out of `engine.ts` is only safe while every route to it
   * lands on the *same* class object. A second declaration — a copy left behind
   * in `engine.ts`, a re-export rewritten as a subclass — would still satisfy
   * the type-checker and every `.name` comparison, and would silently break the
   * `instanceof` decision the agent sandbox makes: a genuine coordinator crash
   * would be committed as a replayable host-call result and a restarted turn
   * would be answered from the recording instead of rejoining the execution.
   */
  test("one class object is reached through the leaf, the engine, and the Bun entry", async () => {
    const [leaf, engine, entry] = await Promise.all([
      import("./errors.ts"),
      import("./engine.ts"),
      import("./index.ts")
    ])
    expect(engine.CoordinatorCrash).toBe(leaf.CoordinatorCrash)
    expect(entry.CoordinatorCrash).toBe(leaf.CoordinatorCrash)
    for (const name of [
      "DurableActionDefect",
      "DurableActionFailure",
      "DurableExecutionAlreadyFailed",
      "DurableExecutionCancelled"
    ] as const) {
      expect(engine[name]).toBe(leaf[name])
    }
  })

  test("the moved class is still a branded identity, not a name", async () => {
    const { CoordinatorCrash } = await import("./errors.ts")
    const crash = new CoordinatorCrash("node-1")
    expect(crash).toBeInstanceOf(Error)
    expect(crash.nodeId).toBe("node-1")
    expect(crash.name).toBe("CoordinatorCrash")
    // An impostor that merely spells the name is an ordinary tool failure: the
    // sandbox's in-process decision is `instanceof`, so identity must not be
    // satisfied by the spelling.
    const impostor = new Error("not a coordinator crash")
    impostor.name = "CoordinatorCrash"
    expect(impostor).not.toBeInstanceOf(CoordinatorCrash)
  })
})
