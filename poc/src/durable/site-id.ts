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

// ---------------------------------------------------------------------------
// Durable failure identity
// ---------------------------------------------------------------------------

/**
 * UTF-16 code-unit bound on a minted durable failure identity.
 *
 * The durable failure ENVELOPE validator (`./schema.ts`,
 * `/^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,255}$/`) admits one leading character plus
 * 255 more, so 256 units is exactly the window a minted identity has to fit.
 */
const DURABLE_FAILURE_IDENTITY_UNITS = 256

/**
 * `[A-Za-z0-9._/:-]` — every unit that survives durable escaping verbatim.
 *
 * This is the envelope validator's alphabet MINUS `+` and MINUS `@`, and BOTH
 * withholdings are load-bearing:
 *
 *  - `+` is the escape introducer, which is what makes the encoding reversible:
 *    an unescaped `+` can never occur, so every `+` in the output starts exactly
 *    one five-unit escape.
 *  - `@` is the SEPARATOR. Withholding it is what makes the composed spelling
 *    injective, and it is the step {@link escapeIdentityPath} does not need:
 *    that one may leave `@` in the path because its separator is `:` and it
 *    parses at the LAST `:`. Here there are two `@` roles — the file/class
 *    separator and the trailing `@1` version marker — so "the last one" is not
 *    enough on its own, and withholding `@` from both components makes the
 *    count exactly two and the parse unambiguous.
 *
 * `moduleRowQualifier` (`../language/semantic.ts`) withholds its own separator
 * from its own alphabet for exactly this reason. Each identity in this compiler
 * owns the alphabet its separator forces; they are deliberately not one shared
 * set.
 */
function isDurableIdentityUnit(unit: number): boolean {
  return isIdentityAlphanumericUnit(unit) ||
    unit === 0x2e /* . */ || unit === 0x5f /* _ */ || unit === 0x2f /* / */ ||
    unit === 0x3a /* : */ || unit === 0x2d /* - */
}

/**
 * REVERSIBLE encoding of one durable identity component into the alphabet above.
 *
 * Applied to BOTH components, which is the difference from
 * {@link escapeIdentityPath}'s single-component use. The class name has to be
 * escaped rather than carried verbatim because a TypeScript identifier may hold
 * `$` and arbitrary `ID_Continue` letters, neither of which the durable envelope
 * validator accepts — the predecessor met that by folding them onto `_`, which
 * is precisely how `$Failed` and `_Failed` became one identity.
 *
 * There is no index-0 special case. {@link escapeIdentityPath} escapes a
 * non-alphanumeric first unit to displace a `source_` prefix its predecessor
 * minted; this site never had that prefix, the composed identity always begins
 * with the literal `smithers:` so the validator's leading-character rule is
 * already satisfied, and the encoding is injective with or without it.
 */
function escapeDurableIdentityComponent(component: string): string {
  let escaped = ""
  for (let index = 0; index < component.length; index++) {
    const unit = component.charCodeAt(index)
    escaped += isDurableIdentityUnit(unit)
      ? component[index]
      : `+${unit.toString(16).toUpperCase().padStart(4, "0")}`
  }
  return escaped
}

/**
 * THE durable failure identity of one nominal Error class, and the only
 * algorithm either backend may mint one with.
 *
 * This is the CONTRACT spelling, `smithers:<file>@<Class>@1`. It is deliberately
 * NOT {@link nominalErrorIdentity}, the RUNTIME spelling `smithers:<file>:<Class>`
 * that `__smithersRegisterError` carries: the two coexist on purpose, they are
 * validated by two different rules, and unifying them would silently retag every
 * persisted failure envelope with a string the envelope validator never accepted.
 *
 * `specification/durable-execution.mdx`: "Every value crossing an Action or Flow
 * persistence boundary MUST satisfy the compiler-checked durable codec
 * contract"; read with `specification/failures.mdx` "Error Prototype" —
 * "Handler selection MUST use compiler-stable nominal identity" — the identity
 * is the key a decoder on the far side of a persistence boundary selects a
 * handler by. Stability without INJECTIVITY is worth nothing there: two Error
 * classes arriving under one identity is a forgeable key.
 *
 * THE INJECTIVITY RULE. Until 2026-08-28 this was `stableIdentity`
 * (`./schema.ts`): it spelled `smithers:<file>#<Class>@1` and then rewrote every
 * unit outside `[A-Za-z0-9._/@:+-]` to `_`. `#` is not in that class, so the
 * SEPARATOR was the first thing destroyed, and the fold was many-to-one on both
 * components at once. Three mechanisms were measured on both backends, with zero
 * diagnostics and a runtime `already registered` throw at the end of each:
 *
 *     a b.sm / Boom, a_b.sm / Boom, a#b.sm / Boom, a%b.sm / Boom, a!b.sm / Boom
 *       -> smithers:a_b.sm_Boom@1          (charset collapse, a 5-member family)
 *     a.sm_B / C  and  a.sm#B / C  and  a.sm / B_C
 *       -> smithers:a.sm_B_C@1        (separator destruction; the first and the
 *                                      third need NO character outside the
 *                                      alphabet, so escaping alone is not a fix)
 *     $Failed  and  _Failed  in one file
 *       -> smithers:<file>__Failed@1              (class-name collapse)
 *
 * Every step here is therefore information-preserving: both components are
 * escaped reversibly, the separator is withheld from the alphabet so it cannot
 * be spelled by either component, and the length bound is honoured by DIGESTING
 * the exact spelling rather than by cutting it. `smithers.digest:` cannot be
 * confused with the ordinary `smithers:` spelling — the ninth unit is `.` in one
 * and `:` in the other.
 *
 * The result is the byte-identical answer the Go fork's `durableFailureIdentity`
 * (`compiler/forkbridge/durable.go.txt`) gives; the two are pinned against each
 * other by the shared vectors in
 * `conformance/identity/durable-failure-identity.json`, which both backends
 * read, and NOT by reading one another. `logicalFile` is a portable name from
 * {@link identityFileName} — never an absolute path.
 *
 * ---------------------------------------------------------------------------
 * REPLAY COMPATIBILITY. This change is NOT backward compatible with journals
 * recorded before 2026-08-28, and that is stated here rather than discovered.
 *
 * The sibling decision that left `ComponentIdentity.name` alone did so because
 * the name is persisted in `function_identity_json` and moving it breaks replay
 * of already-recorded journals. This identity has that property and MORE, so
 * the same question was asked of it and answered by tracing the value:
 *
 *  1. it is hashed into `errorSchema.digest` -> `contractDigest` ->
 *     `flowSchemas.error` -> `plan.digest` -> the Effect Manifest digest, and
 *     `durable_executions.plan_digest` / `.manifest_digest` are pinned columns.
 *     `store.ts` raises `ExecutionMigratedError` when a resumed execution's
 *     stored digest is not the freshly compiled one, so every UNFINISHED
 *     execution in an existing database refuses to resume;
 *  2. it is also written VERBATIM, as a string, into the failure envelope
 *     (`pool-bundle.ts`, `{ version: 1, identity, payload }`), which is stored
 *     in `durable_nodes.error_json`, `durable_executions.error_json` and the
 *     hash-chained `durable_journal.payload_json`. On resume,
 *     `validateDurableValue` compares that recorded string against the freshly
 *     derived descriptor's identity, so an already-recorded typed failure is
 *     re-read as a `PersistedFlowCodecDefect`;
 *  3. the agent turn journal compares `agent_flow_calls.plan_digest` and
 *     `agent_host_calls.contract_json` (which embeds `errorSchemaDigest`) and
 *     raises `TurnJournalDivergenceError` on a mismatch — the exact hazard the
 *     `ComponentIdentity.name` decision cites, one column over;
 *  4. `planExecutionMigration` (`./migration.ts`), the one sanctioned way to
 *     move a live execution between Plan digests, refuses this by construction:
 *     a respelled identity changes `flowSchemas.error`'s bytes, which it
 *     reports as `flow-contract-changed`.
 *
 * So there is no supported in-place upgrade for a database recorded under the
 * old spelling, and none is invented here: a shim would have to be a real
 * decision about wire versioning, not a side effect of an identity repair. The
 * seam it would use already exists and is the reason the envelope carries a
 * version at all — the `version: 1` field beside the identity, which a decoder
 * could pair with the old spelling while `version: 2` carries the new one.
 *
 * Why this was still the right change now: the alternative is a spelling that is
 * not an identity. Two Error classes under one key is a forgeable handler
 * selection on a persistence boundary, and the artifact this sits underneath is
 * the one intended to be SIGNED. Replay compatibility with journals whose keys
 * are ambiguous is not a property worth keeping. The cost is stated so that
 * whoever ships a release makes the migration decision deliberately.
 * ---------------------------------------------------------------------------
 */
export function durableFailureIdentity(logicalFile: string, className: string): string {
  const spelled = `smithers:${escapeDurableIdentityComponent(logicalFile)}@${
    escapeDurableIdentityComponent(className)
  }@1`
  if (spelled.length <= DURABLE_FAILURE_IDENTITY_UNITS) return spelled
  // Digesting the SPELLING rather than the pair is what makes the fallback
  // injective for free: the spelling is already injective over (file, name), so
  // the digest inherits that up to SHA-256 collision resistance. The `@1` is
  // kept so that every durable failure identity, spelled or digested, carries
  // the same version marker. `update(…, "utf8")` is the same byte sequence Go's
  // `[]byte(string)` produces.
  return `smithers.digest:${createHash("sha256").update(spelled, "utf8").digest("hex")}@1`
}

// ---------------------------------------------------------------------------
// Durable cache adoption source
// ---------------------------------------------------------------------------

/**
 * `[A-Za-z0-9._/@-]` — every unit that survives adoption-source escaping
 * verbatim.
 *
 * `:` is the SEPARATOR and `+` is the escape introducer, and both are withheld
 * for the reasons {@link isDurableIdentityUnit} states: withholding the
 * introducer is what makes the encoding reversible, and withholding the
 * separator is what makes the composed spelling injective. The separator
 * matters more here than anywhere else in this file because THREE components
 * are joined, so "parse at the last `:`" is not available even in principle.
 */
function isAdoptionSourceUnit(unit: number): boolean {
  return isIdentityAlphanumericUnit(unit) ||
    unit === 0x2e /* . */ || unit === 0x5f /* _ */ || unit === 0x2f /* / */ ||
    unit === 0x40 /* @ */ || unit === 0x2d /* - */
}

/** REVERSIBLE encoding of one adoption-source component into the alphabet above. */
function escapeAdoptionSourceComponent(component: string): string {
  let escaped = ""
  for (let index = 0; index < component.length; index++) {
    const unit = component.charCodeAt(index)
    escaped += isAdoptionSourceUnit(unit)
      ? component[index]
      : `+${unit.toString(16).toUpperCase().padStart(4, "0")}`
  }
  return escaped
}

/**
 * THE provenance string a node records when it adopts a MEMO cache winner, and
 * the only algorithm anything may spell one with.
 *
 * PERSISTED, which is the whole reason this is not left inline. It is written to
 * `durable_nodes.adopted_from` and — through `emit` — into
 * `durable_journal.payload_json`, whose `payload_digest` and `event_digest`
 * are computed from it. A collision here is not a transient mis-read: it is a
 * durable audit record, inside a hash-chained journal, that names two different
 * cache entries with one string, and the artifact this sits underneath is the
 * one intended to be SIGNED.
 *
 * THE INJECTIVITY RULE. It used to be spelled twice, inline, as
 * `memo:${scope}:${generation}:${memoKey}` (`./engine.ts`, `./store.ts`), and
 * TWO of the three components are free-form author strings: `provideAction`
 * (`./provider.ts`) validates `scope` and `generation` only for being non-empty
 * after `trim()`, so both may hold `:`. The measured collision needs no
 * character outside the old spelling's implicit alphabet at all:
 *
 *     scope "a",   generation "b:c" -> memo:a:b:c:<key>
 *     scope "a:b", generation "c"   -> memo:a:b:c:<key>
 *
 * Escaping alone would not have fixed that — neither input contains anything
 * exotic — which is why the separator is withheld from the component alphabet
 * rather than merely escaped in it. That is the same lesson `a.sm_B`/`C` versus
 * `a.sm`/`B_C` taught {@link durableFailureIdentity}.
 *
 * `memoKey` is a 64-hex `digest`, so escaping it is a no-op today. It is escaped
 * anyway: the injectivity argument then rests on nothing outside this function,
 * and a future memo key that is not a digest cannot quietly reintroduce the
 * defect.
 *
 * There is no length bound to honour and therefore nothing to truncate — a
 * `TEXT` column and a JSON payload both take the exact spelling.
 *
 * REPLAY COMPATIBILITY: unaffected. Unlike {@link durableFailureIdentity}, this
 * string is WRITE-ONLY. Nothing reads `adopted_from` back, nothing re-derives it
 * to compare against a recorded one, and it reaches no pinned column: journal
 * rows recorded under the old spelling keep their own `payload_json` and the
 * `payload_digest`/`event_digest` computed from THOSE bytes, so the hash chain
 * over an existing journal still verifies unchanged. Only newly written rows
 * carry the new spelling.
 */
export function memoAdoptionSource(scope: string, generation: string, memoKey: string): string {
  return `memo:${escapeAdoptionSourceComponent(scope)}:${
    escapeAdoptionSourceComponent(generation)
  }:${escapeAdoptionSourceComponent(memoKey)}`
}

/**
 * THE provenance string a node records when it adopts a CONTENT cache winner.
 *
 * One component after a fixed prefix, so it is injective for free — there is no
 * separator to destroy and nothing for a second component to be confused with.
 * It goes through this module anyway so that both adoption sources have one
 * home, and so that `content:` and `memo:` are visibly disjoint prefixes rather
 * than two coincidences: a `content:` spelling can never equal a `memo:` one,
 * whatever the components hold.
 *
 * The component is escaped for the reason {@link memoAdoptionSource} escapes its
 * digest: `contentKey` is a 64-hex `digest` today, so this is a no-op, and the
 * argument then depends on nothing outside this function.
 */
export function contentAdoptionSource(contentKey: string): string {
  return `content:${escapeAdoptionSourceComponent(contentKey)}`
}

// ---------------------------------------------------------------------------
// Attached child execution namespace
// ---------------------------------------------------------------------------

/**
 * THE marker that separates a parent execution id from a childFlow node id in
 * the derived id of an attached child execution, and the reserved substring no
 * caller-supplied execution id may contain.
 *
 * `./engine.ts` derives `parent + MARKER + nodeId` so that a restart resumes the
 * same attached child instead of spawning a sibling. That derived id is the
 * PRIMARY KEY of `durable_executions`, so two things claiming one spelling is
 * two Flows sharing one journal.
 *
 * The reservation is what makes the derivation sound, and it is a REFUSAL rather
 * than an encoding on purpose. Escaping the components would change a durable
 * primary key — orphaning every already-linked child — to close a hole that is
 * not in the spelling at all: it is in the two id NAMESPACES overlapping.
 * `./engine.ts` states both halves of that argument at the derivation site;
 * `DurableStore.initializeExecution` enforces this half.
 */
export const CHILD_EXECUTION_MARKER = "::child::"

// ---------------------------------------------------------------------------
// Embedded child deployment id
// ---------------------------------------------------------------------------

/**
 * THE deployment id of the complete pinned deployment `buildDeployment`
 * (`./provider.ts`) mints for one embedded child Plan.
 *
 * It reaches the child's `DeploymentManifest`, so it is hashed into
 * `manifest.digest`, which `DurableStore.initializeExecution` pins as
 * `durable_executions.manifest_digest` for every attached child execution and
 * which the remote worker handshake compares.
 *
 * THE TRUNCATION THIS REPLACES. It was
 * `${deploymentId}/child/${childPlan.digest.slice(0, 16)}` — a 64-BIT cut of a
 * SHA-256, which is exactly the "honour a bound by destroying information" step
 * {@link nominalErrorIdentity} was rewritten to stop doing. Two embedded child
 * Plans agreeing in their first 16 hex digits minted ONE child deployment id.
 * There is no bound to honour here at all: `validateDeploymentManifest`
 * (`./artifact.ts`) checks `deploymentId` for being non-empty and nothing else,
 * so the cut bought nothing and cost injectivity. The full digest is carried.
 *
 * WHY NO ESCAPING, stated rather than assumed. The parent id is free-form and
 * MAY contain `/child/`, so the spelling looks like the many-to-one joins
 * repaired above. It is not one: the second component is a `digest`, which is
 * exactly 64 lower-case hex units and therefore holds no `/`, so the parse is
 * right-anchored and unique — the last `/child/` followed by 64 hex digits ends
 * the parent, whatever the parent holds. That is the same argument that makes
 * `nominalErrorIdentity` injective at its LAST `:`.
 *
 * The residual overlap — an authored top-level `deploymentId` spelled to look
 * derived — is real and is a LABEL collision only, unlike
 * {@link CHILD_EXECUTION_MARKER}'s namespace, which is a durable primary key. A
 * deployment id keys nothing: `buildDeployment` registers no id anywhere,
 * `childDeployments` is keyed by the full child Plan digest, and the remote
 * worker handshake (`./remote-worker.ts`) compares `deploymentId` only beside
 * `manifestDigest`, `planDigest`, `artifactDigest`, `bundleDigest` and the
 * pool's `actionIds` — all of which differ whenever the deployments do, since
 * the manifest digest covers the id itself. So there is nothing here for a
 * duplicate label to authorize, and no reservation is imposed on an authored id.
 */
export function childDeploymentId(parentDeploymentId: string, childPlanDigest: string): string {
  return `${parentDeploymentId}/child/${childPlanDigest}`
}

/** One declaration's claim on a durable failure identity. */
export interface DurableFailureIdentityClaim {
  readonly identity: string
  /** `<file>:<class>` already holding it, when this claim collides with one. */
  readonly collidesWith?: string
}

/**
 * Assigns durable failure identities across a WHOLE compilation, refusing a
 * collision rather than emitting a contract whose failures cannot be told apart.
 *
 * The scope is the entire point. `DescriptorBuilder.claimedErrorIdentities`
 * (`./schema.ts`) is a per-instance field, so it sees exactly one
 * `compileActionContract` call — and the measured collision was TWO Actions,
 * which is two calls, so the reachable case was precisely the one the existing
 * refusal could not see. A guard whose scope is narrower than the space the
 * identity has to be unique in is not a guard.
 *
 * {@link durableFailureIdentity} is injective, so on today's algorithm this
 * class never reports a collision across distinct (file, class) pairs. That is
 * the point: it is a defensive invariant, not a filter. The defect it exists for
 * was introduced by weakening the algorithm, and the compiler's only signal was
 * a clean compile followed by a runtime `TypeError` out of `registerErrorType`.
 *
 * It mirrors {@link NominalErrorIdentities} exactly, including why `mint` is
 * injectable: a guard the current algorithm cannot trip is a guard no test can
 * exercise, and a guard no test exercises is one the next refactor deletes as
 * dead code. Handing it the PREVIOUS algorithm is how the test proves this would
 * have caught the shipped defect. Nothing in the compiler passes it.
 */
export class DurableFailureIdentities {
  readonly #assigned = new Map<string, string>()
  readonly #mint: (logicalFile: string, className: string) => string

  constructor(mint: (logicalFile: string, className: string) => string = durableFailureIdentity) {
    this.#mint = mint
  }

  claim(logicalFile: string, className: string): DurableFailureIdentityClaim {
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
