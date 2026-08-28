import { basename, isAbsolute, normalize, relative, resolve, sep } from "node:path"
import { digest } from "./value.ts"

/** The name a model with no caller-supplied one is analyzed under. */
export const MEMORY_SOURCE_NAME = "__smithers_memory__.sm"

/**
 * THE portable spelling of a source file's name, and the only string anything
 * in this compiler may anchor an identity on — a site id, a digest, a journal
 * key, a nominal row or Error brand, a `debug.callSite`.
 *
 * It lives beside {@link EffectSiteIdentity} because it produces that
 * interface's `file` component, and because BOTH compilers need it: the
 * language frontend (`../language/semantic.ts` re-exports it, which is where
 * most callers still name it) and the durable contract compiler
 * (`./schema.ts`). It was previously spelled twice — the second copy,
 * `logicalFileName` in `schema.ts`, only stripped path segments, so an absolute
 * `fileName` handed to `compileActionContract` minted a nominal failure
 * identity like `smithers:Users/someone/checkout/orders.sm#Failed@1` that
 * differed between two machines. One home, one rule, and nothing left to reach
 * for.
 *
 * An identity is not the same thing as an addressing key. `ProjectAnalysis.files`
 * and `ProjectDiagnostic.fileName` are keyed by the caller's own spelling on
 * purpose, so a caller can look a file back up by the name it supplied; those
 * are not identities and do not come from here.
 *
 * Root-relative, POSIX-separated, `.sm` extension intact. That is byte-for-byte
 * the spelling the Go fork already uses: `durableLogicalFile`
 * (`compiler/forkbridge/durable.go.txt`) trims a FIXED `/src/` virtual root off
 * the authored name, `virtualFileName` (`.../main.go.txt`) refuses an absolute
 * input outright rather than normalizing one, and `identityPathsForDiskRoots`
 * (`compiler/fork.go`) states every root name relative to a project root
 * without ever consulting the process working directory. This accessor is the
 * TypeScript half of that agreement.
 *
 * An absolute filesystem path is NOT such a spelling. It differs between two
 * machines, two checkouts, and CI vs local, so an identity built on one is not
 * an identity — it cannot be a durable journal key, and two backends compiling
 * the same program cannot agree on it. The point of routing every identity
 * through one function is that the next one cannot quietly reach for the
 * absolute name instead: there is no absolute name on the model to reach for.
 *
 * The answer is a function of the caller's own name and root only. It never
 * consults `process.cwd()`, so it does not change with the directory the
 * compiler was invoked from.
 */
export function identityFileName(fileName: string, rootDir?: string): string {
  const portable = !isAbsolute(fileName)
    // An authored relative name is already portable; only normalize it, so
    // `./a.sm` and `a.sm` cannot mint two identities for one file.
    ? normalize(fileName)
    : rootDir === undefined
    // A single-file analysis has no project to be relative to, and exactly one
    // file, so the basename is both portable and collision-free.
    ? basename(fileName)
    : relative(resolve(rootDir), fileName)
  return portable.split(sep).join("/")
}

/**
 * Site identity for an effect request.
 *
 * `specification/effects.mdx` §Effect Requests: a request carries "a site
 * identity — content-addressed from the request's source position and its
 * enclosing function's identity, plus an occurrence index assigned at
 * dispatch".
 *
 * The scheme is the one the Plan lowerer already uses for `stableNodeID`
 * (`source-compiler.ts`, eight sites, all spelled
 * `src-${digest({ ...identity, occurrence }).slice(0, 24)}`), and the Go fork
 * agrees with it. It is lifted here unchanged so that when the journal key
 * becomes `siteId#occurrence` the two backends do not have to re-establish an
 * agreement they already have.
 *
 * Two occurrence counters are involved and they are NOT the same quantity:
 *
 * - the **compile-time** occurrence in {@link EffectSiteIds}, which exists only
 *   to keep two syntactically distinct sites that hash to the same identity
 *   from colliding, exactly as the Plan lowerer's does; and
 * - the **dispatch** occurrence index, assigned by the runtime in the
 *   scheduler's deterministic order and specified as the second half of a
 *   journal key. It is not a compile-time value and this module does not
 *   produce it.
 */
export interface EffectSiteIdentity {
  /** The enclosing model's file name. */
  readonly file: string
  /** The enclosing function's analysis-assigned name. */
  readonly functionName: string
  /** Which of the three request kinds this site issues. */
  readonly kind: "get" | "perform" | "abort"
  /** `line:character` of the request's source position, zero-based. */
  readonly anchor: string
  /** The request's nominal key, when the site has one. */
  readonly key?: string
}

/** The content-addressed half of a journal key. */
export const effectSiteId = (identity: EffectSiteIdentity, occurrence: number): string =>
  `src-${digest({ ...identity, occurrence }).slice(0, 24)}`

/**
 * Assigns site ids within one compilation unit, refusing a collision rather
 * than papering over it — the Plan lowerer raises `SMITHERS4199` on the same
 * condition, and a silently reused journal key is worse than a hard stop.
 */
export class EffectSiteIds {
  readonly #occurrences = new Map<string, number>()
  readonly #assigned = new Set<string>()

  assign(identity: EffectSiteIdentity): string {
    const key = digest(identity)
    const occurrence = this.#occurrences.get(key) ?? 0
    this.#occurrences.set(key, occurrence + 1)
    const id = effectSiteId(identity, occurrence)
    if (this.#assigned.has(id)) {
      throw new Error(`stable effect site id collision ${id}`)
    }
    this.#assigned.add(id)
    return id
  }
}
