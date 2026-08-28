import { createHash } from "node:crypto"
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

// ---------------------------------------------------------------------------
// Nominal Error identity
// ---------------------------------------------------------------------------

/**
 * UTF-16 code-unit bound on a minted identity.
 *
 * The runtime validator (`../runtime/errors.ts`, `STABLE_ERROR_IDENTITY`)
 * admits one leading character plus 255 more. Its quantifier counts CODE POINTS
 * under the `u` flag while this bound counts CODE UNITS, so a unit bound of 256
 * is the conservative side of that inequality: a string of 256 units is at most
 * 256 code points and therefore always inside the validator's window.
 */
const NOMINAL_ERROR_IDENTITY_UNITS = 256

/** `[0-9A-Za-z]`, on one UTF-16 code unit. */
function isIdentityAlphanumericUnit(unit: number): boolean {
  return (unit >= 0x30 && unit <= 0x39) ||
    (unit >= 0x41 && unit <= 0x5a) ||
    (unit >= 0x61 && unit <= 0x7a)
}

/**
 * `[A-Za-z0-9._/@:-]` — every unit that survives escaping verbatim.
 *
 * This is the alphabet the runtime validator accepts for a path, MINUS `+`.
 * `+` is withheld as the escape introducer, which is the whole reason the
 * encoding below is reversible: an unescaped `+` can never occur, so every `+`
 * in the output starts exactly one five-unit escape.
 */
function isIdentityPathUnit(unit: number): boolean {
  return isIdentityAlphanumericUnit(unit) ||
    unit === 0x2e /* . */ || unit === 0x5f /* _ */ || unit === 0x2f /* / */ ||
    unit === 0x40 /* @ */ || unit === 0x3a /* : */ || unit === 0x2d /* - */
}

/**
 * REVERSIBLE encoding of a logical file name into the identity alphabet.
 *
 * The predecessor of this function replaced each unit outside the alphabet with
 * `_` and, when the result did not start alphanumerically, prefixed `source_`.
 * Both steps were many-to-one, and both were measured minting one identity for
 * two distinct files with no diagnostic:
 *
 *     a b.sm        and  a_b.sm        -> smithers:a_b.sm:Boom
 *     .a.sm         and  source_.a.sm  -> smithers:source_.a.sm:Boom
 *
 * `+XXXX` (four upper-case hex units, always four, never two) fixes both. It is
 * a bijection onto its image, so distinct file names cannot converge:
 *
 *  - a unit outside the alphabet becomes its escape, and `+` itself becomes
 *    `+002B`, so the escapes are self-delimiting and decode uniquely;
 *  - the FIRST unit additionally escapes when it is not alphanumeric, which
 *    replaces the `source_` prefix with something that cannot be spelled by an
 *    ordinary file name;
 *  - a surrogate is outside the alphabet, so a non-BMP character encodes as two
 *    escapes and no lone surrogate can survive into the identity.
 */
function escapeIdentityPath(logicalFile: string): string {
  let escaped = ""
  for (let index = 0; index < logicalFile.length; index++) {
    const unit = logicalFile.charCodeAt(index)
    const verbatim = index === 0 ? isIdentityAlphanumericUnit(unit) : isIdentityPathUnit(unit)
    escaped += verbatim ? logicalFile[index] : `+${unit.toString(16).toUpperCase().padStart(4, "0")}`
  }
  return escaped
}

/**
 * THE stable nominal identity of one Error class, and the only algorithm either
 * backend may mint one with.
 *
 * `specification/failures.mdx`, "Error Prototype": "Handler selection MUST use
 * compiler-stable nominal identity, not a forgeable user `_tag` or
 * minifier-sensitive constructor name in compiled artifacts." An identity that
 * two distinct classes can share is not an identity, and the failure is not
 * quiet: `registerErrorType` refuses the second registration, so the compiler
 * accepts the program, emits a plausible artifact, and the artifact throws
 * `stable Error identity … is already registered` while it is still loading.
 * That is a fail-open — the worst available outcome — and it was reachable two
 * ways before this function existed, both measured on both backends:
 *
 *  - **blind truncation.** The identity was `.slice(0, 256)`-ed AFTER the class
 *    name was appended, so in a file whose name is long enough the discriminator
 *    is what gets cut. `"a".repeat(250) + ".sm"` declaring `Left` and `Right`
 *    minted one 256-unit identity for both, with zero diagnostics.
 *  - **lossy normalization.** See {@link escapeIdentityPath}.
 *
 * Both are fixed here by never destroying information: the path is escaped
 * reversibly, and the bound is honoured by hashing the exact spelling rather
 * than by cutting it. `smithers.digest:` cannot be confused with the ordinary
 * `smithers:` spelling — the ninth unit is `.` in one and `:` in the other —
 * and the ordinary spelling is itself injective over the pair, because a class
 * name is a TypeScript identifier and so contains no `:`, which makes the last
 * `:` an unambiguous separator.
 *
 * The result is the byte-identical answer the Go fork's `stableErrorIdentity`
 * (`compiler/forkbridge/lowering.go.txt`) gives; the two are pinned against each
 * other by the shared vectors in `conformance/identity/nominal-error-identity.json`,
 * which both backends read. `logicalFile` is a portable name from
 * {@link identityFileName} — never an absolute path.
 */
export function nominalErrorIdentity(logicalFile: string, className: string): string {
  const spelled = `smithers:${escapeIdentityPath(logicalFile)}:${className}`
  if (spelled.length <= NOMINAL_ERROR_IDENTITY_UNITS) return spelled
  // Digesting the SPELLING rather than the pair is what makes the fallback
  // injective for free: the spelling is already injective over (file, name), so
  // the digest inherits that up to SHA-256 collision resistance. `update(…,
  // "utf8")` is the same byte sequence Go's `[]byte(string)` produces.
  return `smithers.digest:${createHash("sha256").update(spelled, "utf8").digest("hex")}`
}

/** One declaration's claim on an identity. */
export interface NominalErrorIdentityClaim {
  readonly identity: string
  /** `<file>:<class>` already holding it, when this claim collides with one. */
  readonly collidesWith?: string
}

/**
 * Assigns nominal Error identities within one compilation, refusing a collision
 * rather than emitting an artifact that cannot load.
 *
 * {@link nominalErrorIdentity} is injective, so on today's algorithm this class
 * never reports a collision. That is the point: it is a defensive invariant, not
 * a filter. The defect it exists for was introduced by weakening the algorithm —
 * twice — and in both cases the compiler's only signal was a clean compile
 * followed by a runtime `TypeError` out of `registerErrorType`. With this in the
 * emit path, weakening the algorithm again makes the compiler REFUSE.
 *
 * It mirrors {@link EffectSiteIds}, which holds exactly this line for site ids.
 *
 * `mint` is injectable for exactly one reason: a guard that the current
 * algorithm cannot trip is a guard no test can exercise, and a guard no test
 * exercises is one the next refactor deletes as dead code. Handing it the
 * PREVIOUS algorithm is how the test proves this would have caught the shipped
 * defect. Nothing in the compiler passes it.
 */
export class NominalErrorIdentities {
  readonly #assigned = new Map<string, string>()
  readonly #mint: (logicalFile: string, className: string) => string

  constructor(mint: (logicalFile: string, className: string) => string = nominalErrorIdentity) {
    this.#mint = mint
  }

  claim(logicalFile: string, className: string): NominalErrorIdentityClaim {
    const identity = this.#mint(logicalFile, className)
    const owner = `${logicalFile}:${className}`
    const prior = this.#assigned.get(identity)
    if (prior === undefined) {
      this.#assigned.set(identity, owner)
      return { identity }
    }
    // One declaration reaching the assigner twice is idempotent, not a collision.
    return prior === owner ? { identity } : { identity, collidesWith: prior }
  }
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

/** One request site's claim on a site id. */
export interface EffectSiteIdClaim {
  readonly id: string
  /** `<requestKind>@<anchor>` already holding it, when this claim collides. */
  readonly collidesWith?: string
}

/**
 * Assigns **Effect Manifest** site ids within one Flow's derivation.
 *
 * The Manifest's site table is a different assigner from {@link EffectSiteIds}
 * only because its rows carry a `kind` the id does not: `effect-manifest.ts`
 * mints every id under `kind: "perform"` and puts the real request kind
 * (`sleep`, `signal`, `broadcast`, `queue`, `childFlow`) in the ROW. That is
 * fine on its own — a constant contributes nothing to injectivity either way —
 * but it is only fine while the occurrence counter is keyed on exactly the
 * tuple the id is minted from, and it was not:
 *
 *     bucket = digest({ ...identity, requestKind })   // partitioned BY kind
 *     id     = effectSiteId(identity, occurrence)     // blind to kind
 *
 * A counter partitioned more finely than the value it disambiguates does not
 * disambiguate it — it defeats it. Two sites sharing `(file, functionName,
 * anchor, key)` but differing in `requestKind` each read occurrence `0` out of
 * their own bucket and then mint the SAME id, which under PR-2 is the same
 * journal key. Both backends spelled it that way, so no cross-backend digest
 * comparison could ever see it; only a direct assertion can, which is what
 * `mint` below exists for.
 *
 * The counter is therefore keyed on `digest(identity)` — the id's own tuple,
 * nothing added — which is byte-for-byte what the Plan lowerer's twin does
 * (`source-compiler.ts`, eight sites, `const occurrenceKey = digest(identity)`).
 * Because the previous bucket was a strict refinement of this one, every
 * program in which the shipped answer was already correct keeps byte-identical
 * site ids and therefore a byte-identical Manifest digest; the answer moves
 * only where the shipped answer was a duplicate.
 *
 * The refusal is the second half, and it is the half the Plan lowerer has and
 * the Manifest did not: `SMITHERS4199`, "stable durable node id collision",
 * raised off a set of already-assigned ids. A site id is 24 hex digits — 96
 * bits of a SHA-256 — so even with an injective tuple the truncation is a
 * (astronomically unlikely) source of duplicates, and a duplicated journal key
 * in the artifact whose digest is meant to be SIGNED is the worst available
 * outcome. This makes it a refusal instead.
 *
 * `mint` is injectable for exactly one reason, and it is the same reason
 * {@link NominalErrorIdentities} takes one: with the bucket aligned, no
 * compilable program can trip the guard, and a guard no test can exercise is a
 * guard the next refactor deletes as dead code. Handing it the SHIPPED bucket
 * is how the test proves this would have caught the shipped defect. Nothing in
 * the compiler passes it.
 */
export class EffectManifestSiteIds {
  readonly #occurrences = new Map<string, number>()
  readonly #assigned = new Map<string, string>()
  readonly #mint: (identity: EffectSiteIdentity, requestKind: string) => string

  constructor(
    mint: (identity: EffectSiteIdentity, requestKind: string) => string = (identity) => digest(identity)
  ) {
    this.#mint = mint
  }

  assign(identity: EffectSiteIdentity, requestKind: string): EffectSiteIdClaim {
    const bucket = this.#mint(identity, requestKind)
    const occurrence = this.#occurrences.get(bucket) ?? 0
    this.#occurrences.set(bucket, occurrence + 1)
    const id = effectSiteId(identity, occurrence)
    const owner = `${requestKind}@${identity.anchor}`
    const prior = this.#assigned.get(id)
    if (prior !== undefined) return { id, collidesWith: prior }
    this.#assigned.set(id, owner)
    return { id }
  }
}

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
