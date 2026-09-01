import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript-js";
import { MANDATORY_CHECKER_OPTIONS } from "./compiler-options.ts";
import { DurableCodecError, deriveDurableValueSchema } from "../durable/schema.ts";
import {
  EffectSiteIds,
  MEMORY_SOURCE_NAME,
  NominalErrorIdentities,
  identityFileName,
  nominalErrorIdentity,
} from "../durable/site-id.ts";
import type {
  Analysis,
  AnalyzeOptions,
  AnalyzeProjectOptions,
  Diagnostic,
  ErrorDeclaration,
  FunctionChannel,
  FunctionDeclaration,
  FunctionRows,
  ProjectAnalysis,
  ProjectDiagnostic,
  ProjectFileAnalysis,
  ProjectSource,
} from "./model.ts";
import { DECLARATION_EFFECT_TAG, DECLARATION_EFFECT_VERSION } from "./model.ts";
import {
  recoverSmithersSyntax,
  scanTokens as scanRecoveryTokens,
  tokenEndsExpression,
  type RecoveredSource,
} from "./recover.ts";
import { isCompilerIssuedRuntimeSource } from "./runtime-source-authority.ts";

const PRELUDE_NAME = "__smithers_frontend_prelude__.d.ts";

/**
 * The `@types` packages the authored-`.sm` name environment admits: none.
 *
 * Without this, TypeScript auto-includes every package under
 * `node_modules/@types`, so whether `Buffer`, `require`, `module`, `exports`,
 * `__dirname`, `__filename`, and `setImmediate` exist in a `.sm` module depends
 * on what the *host toolchain* happens to have installed. That is not a fact
 * about the language, and it produced two concrete defects.
 *
 * The first is a guaranteed crash. `__dirname`, `__filename`, `module`, and
 * `exports` type-checked against `@types/node` while the compiler emits ESM,
 * where none of them exists — a `ReferenceError` at runtime inside a function
 * whose row read `failures: []`.
 *
 * The second is backend disagreement. The pinned Go fork carries no ambient
 * `@types/node` (`compiler/forkbridge/hostrules.go.txt`), so `Buffer` was
 * `ok: true` here and `TS2591` there, and `setImmediate` was `ok: true` here
 * and `TS2304` there — a divergence in the *name environment* that conformance
 * cannot see, because no corpus case can name a global that only one backend
 * declares. Pinning `types: []` makes the two agree by construction.
 *
 * `specification/compatibility.mdx`, "Configuration", places `lib` among the
 * emit-scoped options that MAY differ by host; the ambient `@types` set is the
 * same kind of choice, and the same page's rule that "a file's legality cannot
 * change merely because its emitted code runs on Node, Bun, Deno, a browser, or
 * an edge runtime" is what forbids leaving it to the environment. An explicit
 * `import` of a host module still resolves normally — `node:crypto` in a
 * foreign `.ts` is a module requirement, not an ambient global.
 */
const AUTHORED_AMBIENT_TYPE_PACKAGES: readonly string[] = [];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The instance members of the compiler-owned `Result`, as their declaration
 * text. THE one table: the prelude interface below is generated from it, and
 * `RESULT_CONSUMERS` — the ownership walk's discharge set — is derived from it.
 *
 * They used to be two hand-maintained lists over the same member set, written
 * 6000 lines apart, and that is this repository's signature defect shape: two
 * walks over one value where one learns a new form and the other does not.
 * `flatten` and `tapBoth` were implemented and tested on the runtime
 * (`poc/src/runtime/result.ts`) and were unreachable from `.sm` anyway, because
 * neither list had learned them. The refusal did not even name the member: an
 * undeclared member leaves the Result unconsumed, so the analyzer reported
 * SMITHERS1301/SMITHERS1302 and returned before the emitted TypeScript could
 * report the unknown property. A member added here reaches both walks at once.
 *
 * `unwrap` is deliberately absent. It is the runtime's missed-lowering
 * fallback, not authoring surface: the compiler emits an early Result return
 * for `!`, and `expect` is the sanctioned panicking spelling.
 */
const RESULT_MEMBER_SIGNATURES: readonly string[] = [
  "isOk(): boolean",
  "isError(): boolean",
  "match<B>(handlers: { ok(value: A): B; error(error: E): B }): B",
  "map<B>(fn: (value: A) => B): Result<B, E>",
  "mapError<F extends Error>(fn: (error: E) => F): Result<A, F>",
  "andThen<B, F extends Error>(fn: (value: A) => Result<B, F>): Result<B, E | F>",
  // The `this` constraint mirrors the runtime's "requires a nested Result"
  // panic guard. It does not produce the refusal on its own: this analyzer
  // reports its own rules and returns before the emitted TypeScript is checked,
  // so `lookup(k).flatten()` on a non-nested Result is refused as TS2684
  // against the runtime's own `this` type, the way every other type error in a
  // `.sm` surfaces. Declaring it here keeps the authored surface an honest
  // description of the runtime rather than a wider one.
  "flatten<B, F extends Error>(this: Result<Result<B, F>, E>): Result<B, E | F>",
  "recover<B>(fn: (error: E) => B): Result<A | B, never>",
  "tap(fn: (value: A) => unknown): Result<A, E>",
  "tapError(fn: (error: E) => unknown): Result<A, E>",
  "tapBoth(handlers: { ok(value: A): unknown; error(error: E): unknown }): Result<A, E>",
  "unwrapOr(value: A): A",
  "expect(message: string): A",
];

/**
 * The member name a signature declares — everything before its type parameter
 * list or its parameter list. Deriving it means each name is written exactly
 * once, so a table entry cannot declare one member and admit another.
 */
function resultMemberName(signature: string): string {
  const start = signature.search(/[<(]/);
  if (start <= 0) throw new Error(`unparsable Result member signature: ${signature}`);
  return signature.slice(0, start);
}

/**
 * Checker-only declarations. They describe the source language surface without
 * making the POC runtime importable from an uncompiled `.sm` module.
 */
const PRELUDE = String.raw`
interface Result<A, E extends Error> {
  readonly __smithersResult: { readonly success: A; readonly error: E }
${RESULT_MEMBER_SIGNATURES.map((signature) => `  ${signature}`).join("\n")}
}
declare const Result: {
  // The failure channel is the union of the collected Results' own failures.
  // Widening it to \`Error\` made an ordinary \`Result.all([...])!\` propagate a
  // failure named \`Error\` into its caller's contract, which then reported
  // SMITHERS1104 for a failure the program cannot actually produce.
  // specification/failures.mdx: transformations "MUST preserve or correctly
  // combine the Result error type"; the runtime declaration in
  // poc/src/runtime/result.ts already combines it precisely.
  all<const T extends readonly Result<unknown, Error>[]>(values: T): Result<unknown, T[number]["__smithersResult"]["error"]>
  try<A>(body: () => A): Result<A, Panic>
  try<A, E extends Error>(body: () => A, mapper: (cause: unknown) => E): Result<A, E | Panic>
  tryPromise<A>(body: () => PromiseLike<A>): Promise<Result<A, Panic>>
  tryPromise<A, E extends Error>(body: () => PromiseLike<A>, mapper: (cause: unknown) => E): Promise<Result<A, E | Panic>>
}

declare class Panic extends Error { readonly cause?: unknown }
declare namespace Reflect { function panic(cause?: unknown): never }

interface Error {
  is<T extends Error>(kind: abstract new (...args: never[]) => T): this is T
  matches<T extends Error>(kind: abstract new (...args: never[]) => T): boolean
  match<B>(handlers: Record<string, (error: Error) => B>): B
  matchPartial<B, F>(handlers: Record<string, (error: Error) => B>, fallback: (error: Error) => F): B | F
  rootCause(): Error
}

declare module "smthrs/context" {
  export abstract class Context {
    static context<C extends abstract new (...args: never[]) => Context>(this: C): InstanceType<C>
  }
}

declare module "smthrs/provider" {
  import type { Context } from "smthrs/context"
  export interface Layer<P> {
    readonly __smithersLayer: { readonly provides: P }
  }
  export const Layer: {
    succeed<C extends abstract new (...args: never[]) => Context>(capability: C, implementation: InstanceType<C>): Layer<C>
    merge<const L extends readonly Layer<unknown>[]>(...layers: L): Layer<L[number] extends Layer<infer P> ? P : never>
    provide<L extends Layer<unknown>, A>(layer: L, body: () => A): A
  }
}

declare module "smithers:exceptions" {
  export { Panic }
  export function panic(cause?: unknown): never
}

`;

export interface TypeShape {
  readonly channel: FunctionChannel;
  readonly async: boolean;
  readonly failures: ReadonlySet<string>;
  /**
   * The REQUIREMENT half of the effect row, read from the type rather than from
   * the call graph. **G7.**
   *
   * `docs/DECISIONS.md` §Function model, Locked: "A function's effect row is
   * the pair `(E, R)`. It is part of the function's static type ... and is
   * carried by a function **value**, not only by a function declaration." and
   * "An unannotated function type carries the empty row." Both halves are
   * modelled here: the row is populated from the declaration's own
   * `@smithersEffects` metadata ({@link declaredRequirementRow}) and is the
   * EMPTY SET everywhere else, which is the locked default rather than an
   * "unknown".
   *
   * It is deliberately NOT the same quantity as `SemanticFunction.requirements`.
   * That one is the whole-program inference over the call graph and is what
   * `Analysis.rows` publishes; this one is what a caller can learn about a
   * callee it can only see through a type — a `.d.ts` this compiler emitted.
   * The two agree for a function whose declaration this compilation owns, and
   * only this one exists for one it does not.
   */
  readonly requirements: ReadonlySet<string>;
  readonly successType?: ts.Type;
}

/** The empty effect row, shared so the common case allocates nothing. */
const NO_REQUIREMENTS: ReadonlySet<string> = new Set();

export interface ForeignPolicy {
  readonly kind: "panic" | "never" | "declared";
  readonly errorName?: string;
  /** In-scope runtime constructor selected by checker symbol identity. */
  readonly errorValuePath?: readonly string[];
  readonly async: boolean;
  /** False when the boundary is known but expression-order-safe emit is deferred. */
  readonly lowerable: boolean;
}

/**
 * Every syntax that INVOKES a checked function by naming it.
 *
 * `specification/requirements.mdx` §Inference (Locked): "Calling a function
 * with unsatisfied requirements MUST add those capabilities to the caller's `R`
 * row. ... Requirement inference MUST be transitive through ordinary calls."
 * The call graph was keyed on `ts.CallExpression` alone, so a tagged template
 * and a `new` contributed no edge, no row and no diagnostic: ``return tag`x` ``
 * published `tag: { requirements: ["Db"] }` beside `f: { requirements: [] }` —
 * the callee's row computed correctly and then thrown away at the call — and
 * the program ran and panicked with `capability 'Db' was not provided`. The
 * same blind spot silenced must-consume (SMITHERS1301), SMITHERS1303 and
 * SMITHERS1404 on the tagged-template spelling, and both backends accepted all
 * of it.
 *
 * These three are the forms that name their callee in the syntax. The IMPLICIT
 * protocol invocations (`Symbol.iterator` through a spread or `for…of`,
 * `toString` in a template, `toJSON`, a thenable's `then`, a decorator) name it
 * only through a type, so they are modelled separately as
 * `implicitInvocations` — the way `accessorInvocations` already models a getter.
 */
export type InvocationExpression =
  | ts.CallExpression
  | ts.NewExpression
  | ts.TaggedTemplateExpression;

export interface CallEdge {
  readonly node: InvocationExpression;
  readonly callee?: SemanticFunction;
  readonly foreign?: ForeignPolicy;
  readonly panicExit?: boolean;
  readonly propagatesFailure: boolean;
  /**
   * The call happens directly inside the inline callback of an authored
   * prelude `Result.try`/`Result.tryPromise` boundary. The authored boundary
   * already owns the throw scope, so the call is neither re-wrapped nor
   * treated as an already-checked Result value.
   */
  readonly authoredBoundary?: boolean;
  /**
   * Checker-instantiated failure row for a callee whose declared row is a
   * polymorphic template (its `Result` error mentions the callee's own type
   * parameters, or a deferred type operation over them). It wholly replaces
   * `callee.failures` at this call site; the template is never substituted
   * member-by-member, so a type parameter that shadows an Error class name
   * cannot silently rewrite a concrete row member.
   */
  readonly instantiatedFailures?: ReadonlySet<string>;
  /**
   * **G7**, the requirement half of {@link instantiatedFailures}.
   *
   * Present only when the resolved signature's declaration published a non-empty
   * `@smithersEffects` requirement row, so `undefined` means "no row on the
   * type" rather than "the empty row" — the same reading its failure sibling
   * has. It is charged in `inferRows` beside the callee's inferred row, which is
   * a no-op whenever this compilation owns the callee's body (the two agree) and
   * is the only row available when it does not.
   */
  readonly instantiatedRequirements?: ReadonlySet<string>;
}

export interface ProvideEdge {
  readonly node: ts.CallExpression;
  readonly callback?: SemanticFunction;
  readonly callbackReference?: SemanticFunction;
  readonly provided: ReadonlySet<string>;
  readonly complete: boolean;
}

export interface SemanticFunction {
  readonly node: ts.FunctionLikeDeclaration;
  readonly name: string;
  readonly publicName?: string;
  readonly exported: boolean;
  readonly async: boolean;
  readonly explicitReturn: boolean;
  readonly declaredShape: TypeShape;
  readonly directFailures: Set<string>;
  readonly bodyFailures: Set<string>;
  readonly failures: Set<string>;
  readonly directRequirements: Set<string>;
  readonly requirements: Set<string>;
  /**
   * The subset of {@link directRequirements} that came from a
   * `Capability.context()` SITE — a read the emitter lowers into a `get`
   * request — rather than from an ambient CHARGE.
   *
   * The two used to be the same set, and they stopped being the same set when
   * `specification/compatibility.mdx` §Determinism-Sensitive Members rows three
   * and five landed: `Promise.race` charges `Scheduler` and `"a".localeCompare`
   * charges `Locale` with no `Scheduler.context()` or `Locale.context()`
   * anywhere in the program. Both belong in the published row — that is what
   * "charge" means — and neither gives the emitter anything to lower.
   *
   * MEASURED, and this is why the distinction exists rather than being tidy:
   * `isResumableFunction` decides the calling convention on `requirements.size
   * > 0`, so the moment an ICU call charged a row, the corpus case
   * `20-host-globals/intl-locale-formatting-is-not-a-clock-read` emitted its
   * `main` as a GENERATOR — a generator that yields nothing, that nobody
   * drives, and that handed the harness `[object Generator]` where it expected
   * `string[]`. The row was right and the convention was wrong.
   */
  readonly directCapabilityRequirements: Set<string>;
  /** {@link directCapabilityRequirements}, transitively. @see inferRows */
  readonly capabilityRequirements: Set<string>;
  readonly calls: CallEdge[];
  readonly provides: ProvideEdge[];
  /**
   * Project accessors this body invokes by reading or writing a property.
   * `box.size` CALLS the getter and `box.first = 1` CALLS the setter, so both
   * are ordinary calls for row purposes; see `accessorInvocations`.
   */
  readonly accessorUses: SemanticFunction[];
  /** `X.expect(...)` call sites; the panic channel is charged during row inference. */
  readonly expectCalls: ts.CallExpression[];
  /** Inline callbacks of authored `Result.try`/`tryPromise` boundary calls in this body. */
  readonly boundaryCallbacks: SemanticFunction[];
  /**
   * Function values this body hands across a call or `new` argument boundary.
   *
   * The boundary is already modelled for the other two channels — a callback
   * that can fail is refused (SMITHERS1303) and an async one is refused
   * (SMITHERS1404) — but the requirement row crossed it deleted: `xs.map((x) =>
   * Db.context().find(x))` published `requirements: []` while reading `Db`
   * through the ambient scope at run time, which also made the top-level
   * unsatisfied-requirement check (SMITHERS2102) escapable by wrapping the read
   * in a callback. `specification/requirements.mdx` §Inference: "Requirement
   * inference MUST be transitive through ordinary calls."
   */
  readonly callbackValues: SemanticFunction[];
  /**
   * Expressions whose SEMANTIC CHANNEL charges this row: the operand of every
   * postfix `!` in this body, and every returned expression.
   *
   * They are recorded here and charged inside the `inferRows` fixpoint rather
   * than during collection, because the channel of `r` in `const r = f(); r!`
   * is `effectiveChannel(f)` — a quantity the fixpoint is still computing. Read
   * before the fixpoint runs, an inferred-fallible callee answers "plain, no
   * failures", so the charge was silently vacuous for exactly the callees that
   * need it: measured, `outer(): Result<number, Calm>` containing
   * `const r = inferred("bad"); return r!` published `failures: ["Calm"]`, over
   * a body that can only produce `Boom`, and reported no SMITHERS1104 — while
   * the identical program spelled `return inferred("bad")!` reported it,
   * because THAT spelling is charged by the call-edge route which does run
   * inside the fixpoint.
   *
   * `nonNull` records which of the two kinds a site is, because only postfix
   * propagation sets `hasResultPropagation` (SMITHERS1202's input).
   */
  readonly channelSites: { readonly expression: ts.Expression; readonly nonNull: boolean }[];
  /**
   * Every capability read in this body, recorded at the one place the analysis
   * already classifies one.
   *
   * `contextRequirement` answers with the receiver AND the call; `collectFacts`
   * has only ever kept the receiver's name, so the *node* — the thing an
   * effect lowering has to rewrite into a `get` request — was computed and
   * discarded on every compile. This array keeps it. It is published on
   * {@link SemanticModel.capabilitySites} and consumed by nothing.
   */
  readonly capabilitySites: { readonly call: ts.CallExpression; readonly receiver: ContextReceiver }[];
  /**
   * Every postfix `!` in this body, as the `!` expression itself.
   *
   * `channelSites` already records the same sites, but it records the OPERAND
   * and it mixes them with returned expressions, because what it exists for is
   * charging the failure row inside the `inferRows` fixpoint. An effect
   * lowering needs the `!` node — the thing that becomes an `abort` request —
   * so this array keeps that, separately, and changes nothing about the
   * charge. Published on {@link SemanticModel.effectSites}; consumed by
   * nothing.
   */
  readonly propagationSites: ts.NonNullExpression[];
  hasResultPropagation: boolean;
}

/**
 * One capability read, as the eventual `get` request would see it.
 *
 * `receiver` is `contextRequirement`'s verbatim answer, so an `ambiguous`
 * receiver is recorded as ambiguous rather than dropped — SMITHERS2106 has
 * already refused the program by the time anyone reads this, and a site table
 * that silently omitted the refused form would be a table that disagrees with
 * the diagnostic.
 */
export interface CapabilitySite {
  readonly call: ts.CallExpression;
  readonly receiver: ContextReceiver;
  /** The nominal capability key, or `undefined` when the receiver is ambiguous. */
  readonly name: string | undefined;
}

/**
 * THE portable spelling of a source file's name — see the definition in
 * `../durable/site-id.ts`, which is where it lives so that the durable contract
 * compiler can reach the SAME function rather than keeping a second, weaker
 * copy of the rule. Re-exported here because this is the name most of the
 * compiler imports it under.
 */
export { identityFileName };

/**
 * THE nominal Error identity algorithm — see the definition in
 * `../durable/site-id.ts`. It lives beside {@link identityFileName} because it
 * consumes that function's answer and nothing else, and it is re-exported here
 * for the same reason: the lowerer imports its identity rules from one place.
 */
export { NominalErrorIdentities, nominalErrorIdentity };

export interface SemanticModel {
  /** The authored `.sm` text. */
  readonly source: string;
  /** Pre-parse expression recovery relating authored and parsed text. */
  readonly recovery: RecoveredSource;
  /**
   * This model's portable name, from {@link identityFileName}: the ONE spelling
   * every identity derived from this model is anchored on.
   *
   * The model deliberately publishes no absolute file name. Module resolution
   * needs a filesystem location and gets {@link SemanticModel.resolutionDirectory},
   * which is a directory and therefore cannot be mistaken for — or interpolated
   * into — an identity.
   */
  readonly identityName: string;
  /**
   * The absolute directory an authored relative module specifier in this file
   * resolves against.
   *
   * FILESYSTEM PLUMBING, NEVER AN IDENTITY. It is machine-specific by
   * construction; anything that reaches it to build a stable name has picked
   * the wrong field and wants {@link SemanticModel.identityName}.
   */
  readonly resolutionDirectory: string;
  /** Parsed from RecoveredSource.parseSource; positions are derived offsets. */
  readonly sourceFile: ts.SourceFile;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly functions: readonly SemanticFunction[];
  readonly functionByNode: ReadonlyMap<ts.Node, SemanticFunction>;
  readonly callEdges: ReadonlyMap<InvocationExpression, CallEdge>;
  readonly diagnostics: readonly Diagnostic[];
  readonly errors: readonly ErrorDeclaration[];
  readonly rows: Readonly<Record<string, FunctionRows>>;
  readonly publicFunctions: readonly FunctionDeclaration[];
  /**
   * Every `Capability.context()` call in this file, keyed by the call node.
   *
   * Under the effect lowering (`specification/effects.mdx` §Effect Requests)
   * each of these becomes a `get` request whose key is the nominal capability,
   * and the emitter reads this table to find them. That lowering is now the
   * only one — the `effectLowering` option and its `Db.context()`-passthrough
   * alternative were deleted with migration step 13.
   *
   * ONE SPELLING IS KNOWN MISSING, and it is written down here rather than left
   * to be discovered by whichever step first depends on the table being total.
   * A capability read at MODULE TOP LEVEL is not recorded, because
   * `collectFacts` runs per `SemanticFunction` and module top level is not a
   * function body — the same structural fact
   * `05-context-rows/a-top-level-capability-read-is-rejected` was written to
   * pin, from the other side. Measured across all 541 corpus models on
   * 2026-08-28: 130 syntactic `.context()` / `["context"]()` calls, 129
   * recorded, and the single omission is that case's `export const entry =
   * Directory.context().lookup("ada")`. (The table's own size is 133, because
   * it also records receiver spellings no syntactic scan finds, such as
   * `Clock[KEY]()` over a `const` key.)
   *
   * It is currently unreachable rather than merely rare: a top-level read
   * outside a provide is refused by `SMITHERS2102`, and a read inside a
   * top-level `Layer.provide` callback IS in a function body and IS recorded.
   * So the omission is masked by a diagnostic, not by the analysis — and it
   * stops being masked the moment that diagnostic narrows.
   */
  readonly capabilitySites: ReadonlyMap<ts.CallExpression, CapabilitySite>;
  /**
   * The content-addressed site identity of every request-issuing node in this
   * file: each capability read (`get`) and each postfix `!` (`abort`).
   *
   * PUBLISHED FOR A LATER STEP AND CONSUMED BY NOTHING. `perform` sites — the
   * Action calls — are deliberately absent: classifying one is the durable
   * lowerer's job today, and inventing a second classifier here would be
   * deriving a fact the analysis does not have rather than exposing one it
   * does.
   *
   * The `file` component of each identity is this model's
   * {@link SemanticModel.identityName}, so these ids are portable: the same
   * program produces the same ids from two different checkout paths, on two
   * machines, and in CI. It was an absolute filesystem path until the accessor
   * above became the only way to spell a model's file name, which made these
   * ids machine-specific and therefore unusable as durable journal keys.
   */
  readonly effectSites: ReadonlyMap<ts.Node, string>;
  /**
   * The capability keys read in this file whose `get` answer MUST be journaled.
   *
   * PUBLISHED FOR A LATER STEP AND CONSUMED BY NOTHING.
   * `specification/effects.mdx` §The Journaling Classifier: "A request MUST be
   * journaled if and only if its answer satisfies the compiler-checked durable
   * codec contract", and its worked example is that `Clock.context()` answers
   * with a service, is therefore NOT journaled, and MUST be re-answered by the
   * handler stack on every resumption.
   *
   * MEASURED, NOT ASSUMED: across all 531 corpus `.sm` files this set is
   * empty, over 130 capability sites. It is empty *by construction*, and the
   * reason is worth writing down because it is not the reason the spec gives.
   * The spec's example says a Clock is not journaled because it is a service.
   * The implementation is blunter: `Key.context()` always answers with a
   * Context subclass instance, and the codec predicate refuses every class
   * instance categorically — "only nominal Error payloads are supported" —
   * whether it carries methods or is plain data. So the `get` side of the
   * partition is a constant, and the interesting journaled/replayed boundary
   * is at capability METHOD calls (`clock.now()`, the spec's own second
   * example), which no analysis in this tree classifies today. That gap is
   * named here rather than papered over by widening this field's meaning.
   *
   * Kept anyway, and kept fail-closed: it is the field that stops being a
   * constant the moment a capability answer becomes codec-representable, which
   * is exactly the hole `platform/host.ts` admits to when it calls its
   * determinism perimeter "an author's discipline ... not a property of the
   * language".
   *
   * The predicate is the tree's ONE codec predicate
   * (`durable/schema.ts` `deriveDurableValueSchema`), not a second copy of it.
   */
  readonly journaledRequirements: ReadonlySet<string>;
}

export interface PendingDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly start: number;
}

/**
 * The three facts an effect lowering will read, assembled from what the
 * analysis already collected.
 *
 * NOTHING IN THE COMPILER CONSUMES THE RESULT. No diagnostic is raised here,
 * no existing structure is mutated, and every failure inside the journaling
 * classifier is swallowed into "not journaled" — the fail-closed answer. This
 * function is additive by construction, and it has to stay that way: adding a
 * consumer is what makes the effect lowering observable, and that is a
 * different step with a different gate.
 */
function collectEffectFacts(
  fileName: string,
  functions: readonly SemanticFunction[],
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): {
  readonly capabilitySites: ReadonlyMap<ts.CallExpression, CapabilitySite>;
  readonly effectSites: ReadonlyMap<ts.Node, string>;
  readonly journaledRequirements: ReadonlySet<string>;
} {
  const capabilitySites = new Map<ts.CallExpression, CapabilitySite>();
  const effectSites = new Map<ts.Node, string>();
  const journaledRequirements = new Set<string>();
  const ids = new EffectSiteIds();

  const anchorOf = (node: ts.Node): string => {
    const owner = node.getSourceFile();
    const { line, character } = owner.getLineAndCharacterOfPosition(node.getStart(owner));
    return `${line}:${character}`;
  };

  for (const fn of functions) {
    for (const site of fn.capabilitySites) {
      const name = site.receiver.kind === "capability" ? site.receiver.name : undefined;
      capabilitySites.set(site.call, { call: site.call, receiver: site.receiver, name });
      // `key` is OMITTED, not set to `undefined`, when the receiver is
      // ambiguous: the identity is digested through `canonicalJson`, which
      // refuses `undefined` outright, so spelling the absent key as a present
      // one turns SMITHERS2106 — a diagnostic — into a compiler crash. Measured
      // on `05-context-rows`, not reasoned about.
      const anchor = anchorOf(site.call);
      effectSites.set(
        site.call,
        ids.assign(
          name === undefined
            ? { file: fileName, functionName: fn.name, kind: "get", anchor }
            : { file: fileName, functionName: fn.name, kind: "get", anchor, key: name },
        ),
      );
      if (name !== undefined && isJournaledAnswer(site.call, checker, sourceFile)) {
        journaledRequirements.add(name);
      }
    }
    for (const site of fn.propagationSites) {
      effectSites.set(
        site,
        ids.assign({ file: fileName, functionName: fn.name, kind: "abort", anchor: anchorOf(site) }),
      );
    }
  }

  return { capabilitySites, effectSites, journaledRequirements };
}

/**
 * `specification/effects.mdx` §The Journaling Classifier, applied to a `get`
 * request's answer: journaled if and only if the answer satisfies the durable
 * codec contract.
 *
 * The predicate is the tree's existing codec derivation, deliberately, so that
 * there is exactly one answer to "is this codec-representable" and it cannot
 * drift between the language lane and the durable lane. Any refusal — and any
 * unexpected failure — means "not codec-representable", which is the
 * fail-closed side: an unjournaled answer is re-asked on every resumption,
 * whereas a wrongly journaled one is frozen into the journal.
 */
function isJournaledAnswer(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  try {
    deriveDurableValueSchema(checker, sourceFile, call, checker.getTypeAtLocation(call), "success", "capability answer");
    return true;
  } catch (error) {
    if (error instanceof DurableCodecError) return false;
    return false;
  }
}

export function buildSemanticModel(source: string, options: AnalyzeOptions = {}): SemanticModel {
  const recovery = recoverSmithersSyntax(source);
  const environment = createProgram(recovery.parseSource, options.fileName);
  const { sourceFile, checker } = environment;
  const pending: PendingDiagnostic[] = [];
  checkRemovedAndUnsupportedSyntax(recovery.parseSource, sourceFile, checker, recovery, pending);

  const functions = collectFunctions(sourceFile, checker);
  const functionByNode = new Map<ts.Node, SemanticFunction>();
  for (const fn of functions) functionByNode.set(fn.node, fn);

  const callEdges = new Map<InvocationExpression, CallEdge>();
  const layerBindings = collectLayerBindings(sourceFile, checker);
  for (const fn of functions) {
    collectFacts(fn, checker, sourceFile, functions, functionByNode, layerBindings, pending, callEdges);
  }

  checkForeignValueBoundaries(sourceFile, checker, pending, callEdges, functionByNode);
  inferRows(functions, checker, callEdges);
  checkFunctionContracts(functions, checker, pending);
  checkLayerSatisfaction(sourceFile, functions, functionByNode, layerBindings, checker, pending);
  checkContextReferences(sourceFile, checker, pending);
  checkCallbackOwnership(sourceFile, functions, functionByNode, callEdges, checker, pending);
  checkTopLevelForeignBoundaries(sourceFile, checker, pending, callEdges, functions, functionByNode);
  checkJavaScriptCatchBoundaries(sourceFile, checker, callEdges, pending);
  checkMustConsume(sourceFile, functions, functionByNode, callEdges, checker, pending);
  checkAuthoredApis(sourceFile, checker, pending);
  checkPanicSpellings(sourceFile, checker, pending);
  checkErrorMatches(sourceFile, checker, pending);
  checkDuplicateErrorNames(sourceFile, checker, pending);

  const diagnostics = finalizeDiagnostics(pending, recovery, sourceFile);

  const errors = collectErrorDeclarations(sourceFile, checker, recovery.parseSource)
    .map((error) => remapErrorDeclaration(error, recovery));
  const { rows, publicFunctions } = collectPublicRows(functions, sourceFile, recovery);

  // `environment.fileName` is an absolute path with a `.ts` suffix the checker
  // needs and no identity may carry. The portable name comes from the caller's
  // own spelling, through the one accessor.
  const identityName = identityFileName(options.fileName ?? MEMORY_SOURCE_NAME);
  return {
    source,
    recovery,
    identityName,
    resolutionDirectory: dirname(environment.fileName),
    sourceFile,
    program: environment.program,
    checker,
    functions,
    functionByNode,
    callEdges,
    diagnostics,
    errors,
    rows,
    publicFunctions,
    ...collectEffectFacts(identityName, functions, checker, sourceFile),
  };
}

interface ProjectEntry {
  /**
   * The caller's own spelling. It is the KEY of every published map — the
   * `ProjectAnalysis.files` record and every `ProjectDiagnostic.fileName` —
   * because the API contract is that a caller can look a file back up by the
   * exact name it supplied. That makes it an addressing key, not an identity:
   * it is whatever the caller wrote, up to and including an absolute path.
   */
  readonly displayName: string;
  /** The portable identity spelling, from {@link identityFileName}. */
  readonly identityName: string;
  readonly absoluteName: string;
  readonly internalName: string;
  /** The parsed (recovery-derived) text; matches sourceFile positions. */
  readonly source: string;
  /** The authored `.sm` text. */
  readonly authoredSource: string;
  readonly recovery: RecoveredSource;
  readonly sourceFile: ts.SourceFile;
}

export interface SemanticProject {
  readonly analysis: ProjectAnalysis;
  readonly models: ReadonlyMap<string, SemanticModel>;
  readonly rootDir: string;
}

/** Internal whole-project pass shared by project analysis and lowering. */
export function buildSemanticProjectModels(
  inputs: readonly ProjectSource[],
  options: AnalyzeProjectOptions = {},
): SemanticProject {
  if (inputs.length === 0) {
    return { analysis: { files: {}, diagnostics: [] }, models: new Map(), rootDir: resolve(options.rootDir ?? process.cwd()) };
  }

  const environment = createProjectProgram(inputs, options);
  const { checker } = environment;
  // Nominal row identities must exist before any row member is minted.
  rowNamingByChecker.set(checker, buildRowNaming(environment.entries, checker));
  const pendingByFile = new Map<ts.SourceFile, PendingDiagnostic[]>();
  for (const entry of environment.entries) {
    const pending: PendingDiagnostic[] = [];
    pendingByFile.set(entry.sourceFile, pending);
    checkRemovedAndUnsupportedSyntax(entry.source, entry.sourceFile, checker, entry.recovery, pending);
  }

  const functions = environment.entries.flatMap((entry) => collectFunctions(entry.sourceFile, checker));
  const functionByNode = new Map<ts.Node, SemanticFunction>();
  for (const fn of functions) functionByNode.set(fn.node, fn);

  const callEdges = new Map<InvocationExpression, CallEdge>();
  const layerBindings = new Map<ts.Symbol, ts.Expression>();
  for (const entry of environment.entries) {
    for (const [symbol, expression] of collectLayerBindings(entry.sourceFile, checker)) {
      layerBindings.set(symbol, expression);
    }
  }
  for (const fn of functions) {
    const sourceFile = fn.node.getSourceFile();
    collectFacts(
      fn,
      checker,
      sourceFile,
      functions,
      functionByNode,
      layerBindings,
      pendingByFile.get(sourceFile)!,
      callEdges,
    );
  }

  for (const entry of environment.entries) {
    checkForeignValueBoundaries(
      entry.sourceFile,
      checker,
      pendingByFile.get(entry.sourceFile)!,
      callEdges,
      functionByNode,
    );
  }
  inferRows(functions, checker, callEdges);
  for (const entry of environment.entries) {
    const pending = pendingByFile.get(entry.sourceFile)!;
    const fileFunctions = functions.filter((fn) => fn.node.getSourceFile() === entry.sourceFile);
    checkFunctionContracts(fileFunctions, checker, pending);
    checkLayerSatisfaction(entry.sourceFile, functions, functionByNode, layerBindings, checker, pending);
    checkContextReferences(entry.sourceFile, checker, pending);
    checkCallbackOwnership(entry.sourceFile, functions, functionByNode, callEdges, checker, pending);
    checkTopLevelForeignBoundaries(
      entry.sourceFile,
      checker,
      pending,
      callEdges,
      functions,
      functionByNode,
    );
    checkJavaScriptCatchBoundaries(entry.sourceFile, checker, callEdges, pending);
    checkMustConsume(entry.sourceFile, functions, functionByNode, callEdges, checker, pending);
    checkAuthoredApis(entry.sourceFile, checker, pending);
    checkPanicSpellings(entry.sourceFile, checker, pending);
    checkErrorMatches(entry.sourceFile, checker, pending);
    checkDuplicateErrorNames(entry.sourceFile, checker, pending);
  }
  checkProjectImports(environment, pendingByFile);
  checkDeferredProjectCalls(environment, functions, functionByNode, callEdges, pendingByFile);

  const files: Record<string, ProjectFileAnalysis> = {};
  const models = new Map<string, SemanticModel>();
  const allDiagnostics: ProjectDiagnostic[] = [];
  for (const entry of environment.entries) {
    const fileFunctions = functions.filter((fn) => fn.node.getSourceFile() === entry.sourceFile);
    const analysis = analysisForFile(
      entry.source,
      entry.recovery,
      entry.sourceFile,
      checker,
      fileFunctions,
      pendingByFile.get(entry.sourceFile)!,
    );
    files[entry.displayName] = { fileName: entry.displayName, ...analysis };
    models.set(entry.displayName, {
      source: entry.authoredSource,
      recovery: entry.recovery,
      identityName: entry.identityName,
      resolutionDirectory: dirname(entry.absoluteName),
      sourceFile: entry.sourceFile,
      program: environment.program,
      checker,
      functions: fileFunctions,
      functionByNode,
      callEdges,
      diagnostics: analysis.diagnostics,
      errors: analysis.errors,
      rows: analysis.rows,
      publicFunctions: analysis.functions,
      ...collectEffectFacts(entry.identityName, fileFunctions, checker, entry.sourceFile),
    });
    for (const diagnostic of analysis.diagnostics) {
      allDiagnostics.push({ fileName: entry.displayName, ...diagnostic });
    }
  }
  allDiagnostics.sort((left, right) => compareText(left.fileName, right.fileName) ||
    left.start - right.start || compareText(left.code, right.code) || compareText(left.message, right.message));
  return {
    analysis: { files, diagnostics: allDiagnostics },
    models,
    rootDir: environment.rootDir,
  };
}

/** Internal whole-project pass used by analyzeProject. */
export function buildSemanticProject(
  inputs: readonly ProjectSource[],
  options: AnalyzeProjectOptions = {},
): ProjectAnalysis {
  return buildSemanticProjectModels(inputs, options).analysis;
}

interface ProjectEnvironment {
  readonly rootDir: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly entries: readonly ProjectEntry[];
  readonly entryByAbsoluteName: ReadonlyMap<string, ProjectEntry>;
  readonly entryByInternalName: ReadonlyMap<string, ProjectEntry>;
}

interface ProjectRuntimeEntry {
  readonly absoluteName: string;
  readonly internalName: string;
  readonly source: string;
  readonly resolutionAliases: readonly string[];
  readonly compilerIssued: boolean;
}

const trustedCompilerRuntimeSourceFiles = new WeakSet<ts.SourceFile>();

function createProjectProgram(
  inputs: readonly ProjectSource[],
  options: AnalyzeProjectOptions,
): ProjectEnvironment {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const staged: Array<Omit<ProjectEntry, "sourceFile">> = [];
  const seenDisplayNames = new Set<string>();
  const seenAbsoluteNames = new Set<string>();
  for (const input of inputs) {
    if (!input.fileName.endsWith(".sm")) {
      throw new TypeError(`project source '${input.fileName}' must end in .sm`);
    }
    if (seenDisplayNames.has(input.fileName)) {
      throw new TypeError(`duplicate project source name '${input.fileName}'`);
    }
    const absoluteName = resolve(rootDir, input.fileName);
    if (seenAbsoluteNames.has(absoluteName)) {
      throw new TypeError(`project source '${input.fileName}' resolves to a duplicate path`);
    }
    seenDisplayNames.add(input.fileName);
    seenAbsoluteNames.add(absoluteName);
    const recovery = recoverSmithersSyntax(input.source);
    staged.push({
      displayName: input.fileName,
      // `options.rootDir`, deliberately NOT the `rootDir` above. That one falls
      // back to `process.cwd()` so the program has somewhere to resolve module
      // specifiers from — filesystem plumbing. Handing it to `identityFileName`
      // would put the working directory back inside every identity by the back
      // door: an absolute `ProjectSource.fileName` with no stated root would
      // become `relative(cwd, …)`, which is what this whole seam exists to
      // prevent. With no stated root, an absolute name collapses to its
      // basename, which is portable.
      identityName: identityFileName(input.fileName, options.rootDir),
      absoluteName,
      internalName: `${absoluteName}.ts`,
      source: recovery.parseSource,
      authoredSource: input.source,
      recovery,
    });
  }
  staged.sort((left, right) => compareText(left.displayName, right.displayName));

  const runtimeStaged: ProjectRuntimeEntry[] = [];
  const seenRuntimeNames = new Set<string>();
  for (const [index, input] of (options.additionalRuntimeSources ?? []).entries()) {
    if (
      input === null || typeof input !== "object" ||
      typeof input.sourceFileName !== "string" || input.sourceFileName.trim() === "" ||
      typeof input.source !== "string" ||
      (input.resolutionAliases !== undefined &&
        (!Array.isArray(input.resolutionAliases) ||
          !input.resolutionAliases.every((alias) => typeof alias === "string" && alias.trim() !== "")))
    ) {
      throw new TypeError(`additional runtime source ${index} has an invalid shape`);
    }
    const absoluteName = resolve(rootDir, input.sourceFileName);
    const relativeName = relative(rootDir, absoluteName);
    if (relativeName === "" || relativeName === ".." || relativeName.startsWith(`..${sep}`) || isAbsolute(relativeName)) {
      throw new TypeError(`additional runtime source '${input.sourceFileName}' must be beneath the project root`);
    }
    if (seenAbsoluteNames.has(absoluteName) || seenRuntimeNames.has(absoluteName)) {
      throw new TypeError(`additional runtime source '${input.sourceFileName}' resolves to a duplicate path`);
    }
    if (Buffer.byteLength(input.source, "utf8") > 2 * 1024 * 1024) {
      throw new TypeError(`additional runtime source '${input.sourceFileName}' exceeds 2097152 bytes`);
    }
    const aliases = [...new Set((input.resolutionAliases ?? []).map((alias) => resolve(rootDir, alias)))].sort(compareText);
    for (const alias of aliases) {
      const relativeAlias = relative(rootDir, alias);
      if (relativeAlias === "" || relativeAlias === ".." || relativeAlias.startsWith(`..${sep}`) || isAbsolute(relativeAlias)) {
        throw new TypeError(`additional runtime alias '${alias}' must be beneath the project root`);
      }
      if (seenAbsoluteNames.has(alias) || seenRuntimeNames.has(alias) || alias === absoluteName) {
        throw new TypeError(`additional runtime alias '${alias}' resolves to a duplicate path`);
      }
    }
    seenRuntimeNames.add(absoluteName);
    for (const alias of aliases) seenRuntimeNames.add(alias);
    runtimeStaged.push({
      absoluteName,
      internalName: `${absoluteName}.__smithers_generated__.ts`,
      source: input.source,
      resolutionAliases: aliases,
      compilerIssued: isCompilerIssuedRuntimeSource(input),
    });
  }
  runtimeStaged.sort((left, right) => compareText(left.absoluteName, right.absoluteName));

  const stagedByAbsoluteName = new Map(staged.map((entry) => [entry.absoluteName, entry]));
  const stagedByInternalName = new Map(staged.map((entry) => [entry.internalName, entry]));
  const runtimeByAbsoluteName = new Map(runtimeStaged.map((entry) => [entry.absoluteName, entry]));
  const runtimeByInternalName = new Map(runtimeStaged.map((entry) => [entry.internalName, entry]));
  const resolvableByAbsoluteName = new Map<string, { readonly absoluteName: string; readonly internalName: string }>([
    ...staged.map((entry) => [entry.absoluteName, entry] as const),
    ...runtimeStaged.map((entry) => [entry.absoluteName, entry] as const),
    ...runtimeStaged.flatMap((entry) => entry.resolutionAliases.map((alias) => [alias, entry] as const)),
  ]);
  const preludeName = resolve(rootDir, PRELUDE_NAME);
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...MANDATORY_CHECKER_OPTIONS,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.Preserve,
    allowImportingTsExtensions: true,
    types: [...AUTHORED_AMBIENT_TYPE_PACKAGES],
  };
  const sourceFiles = new Map(staged.map((entry) => [
    entry.internalName,
    ts.createSourceFile(entry.internalName, entry.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  ]));
  for (const entry of runtimeStaged) {
    const sourceFile = ts.createSourceFile(
      entry.internalName,
      entry.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    sourceFiles.set(entry.internalName, sourceFile);
    if (entry.compilerIssued) trustedCompilerRuntimeSourceFiles.add(sourceFile);
  }
  const preludeFile = ts.createSourceFile(preludeName, PRELUDE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const resolved = resolve(name);
    if (resolved === preludeName) return preludeFile;
    const authored = sourceFiles.get(resolved);
    return authored ?? originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => {
    const resolved = resolve(name);
    return resolved === preludeName || sourceFiles.has(resolved) || originalFileExists(name);
  };
  host.readFile = (name) => {
    const resolved = resolve(name);
    if (resolved === preludeName) return PRELUDE;
    const authored = stagedByInternalName.get(resolved);
    const generated = runtimeByInternalName.get(resolved);
    return authored?.source ?? generated?.source ?? originalReadFile(name);
  };
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    const containing = stagedByInternalName.get(resolve(containingFile)) ??
      runtimeByInternalName.get(resolve(containingFile));
    const target = containing
      ? resolveProjectSpecifier(containing.absoluteName, moduleName, resolvableByAbsoluteName)
      : undefined;
    if (target) {
      return {
        resolvedFileName: target.internalName,
        extension: ts.Extension.Ts,
        isExternalLibraryImport: false,
      };
    }
    return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule;
  });

  const program = ts.createProgram({
    rootNames: [
      ...staged.map((entry) => entry.internalName),
      ...runtimeStaged.map((entry) => entry.internalName),
      preludeName,
    ],
    options: compilerOptions,
    host,
  });
  const entries: ProjectEntry[] = staged.map((entry) => ({
    ...entry,
    sourceFile: program.getSourceFile(entry.internalName) ?? sourceFiles.get(entry.internalName)!,
  }));
  const entryByAbsoluteName = new Map(entries.map((entry) => [entry.absoluteName, entry]));
  const entryByInternalName = new Map(entries.map((entry) => [entry.internalName, entry]));
  return { rootDir, program, checker: program.getTypeChecker(), entries, entryByAbsoluteName, entryByInternalName };
}

function resolveProjectSpecifier<T extends { readonly absoluteName: string }>(
  containingAbsoluteName: string,
  specifier: string,
  entries: ReadonlyMap<string, T>,
): T | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingAbsoluteName), specifier);
  const candidates = [exact];
  if (extname(exact) === "") candidates.push(`${exact}.sm`, resolve(exact, "index.sm"));
  if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`);
  for (const candidate of candidates) {
    const entry = entries.get(candidate);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Map a derived (parse-source) offset to an authored offset, exactly where
 * provable and to the recovery anchor otherwise.
 */
function remapOffset(recovery: RecoveredSource, offset: number): number {
  if (!recovery.changed) return offset;
  return recovery.toAuthored(offset) ?? recovery.toAuthoredAnchor(offset);
}

/** Exclusive span ends stay exact when the final contained unit is exact. */
function remapEnd(recovery: RecoveredSource, end: number): number {
  if (!recovery.changed) return end;
  if (end <= 0) return 0;
  const last = recovery.toAuthored(end - 1);
  return last !== undefined ? last + 1 : recovery.toAuthoredAnchor(end);
}

function remapErrorDeclaration(error: ErrorDeclaration, recovery: RecoveredSource): ErrorDeclaration {
  if (!recovery.changed) return error;
  return { ...error, start: remapOffset(recovery, error.start), end: remapEnd(recovery, error.end) };
}

/**
 * Whether a publicly named function's name is a MODULE-SCOPE binding — the only
 * kind of name anything downstream can address a row by.
 *
 * `annotateDeclarationEffects`, `normalizeDeclarationEffectChannels` and
 * `splitEffectVariableStatements` (`./declarations.ts`) all look a row up by
 * `statementDeclarationName(statement)` over `sourceFile.statements`, so a row
 * belonging to a method or to a function nested inside another function has no
 * addressable name in the emitted `.d.mts` at all.
 */
function isModuleScopeFunction(node: ts.FunctionLikeDeclaration): boolean {
  if (ts.isFunctionDeclaration(node)) return ts.isSourceFile(node.parent);
  return ts.isVariableDeclaration(node.parent) &&
    ts.isVariableDeclarationList(node.parent.parent) &&
    ts.isVariableStatement(node.parent.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent.parent);
}

/**
 * The public row table and the public function list for one analyzed file.
 *
 * THE DEFECT THIS EXISTS FOR. Both call sites spelled the table inline as
 * `rows[fn.publicName] = …` in a loop, which is a LAST-WRITER-WINS assignment
 * over a key that is not unique. `collectFunctions` mints `publicName` as the
 * BASE name — the `#2` disambiguator goes on `name`, not on `publicName` — and
 * `isPubliclyNamedFunction` admits function declarations, methods, and
 * function-valued variable declarations at any nesting depth. So two
 * declarations sharing one base name is ordinary, accepted TypeScript, and the
 * second silently overwrote the first. Measured, with zero diagnostics:
 *
 *     export function work(): Result<number, Boom> { … }
 *     export class Holder { work(): Result<number, Bang> { … } }
 *
 *     rows == { work: { failures: ["Bang"], requirements: [] } }
 *
 * and, run through `annotateDeclarationEffects`, an emitted declaration whose
 * exported `work` — the one that fails with `Boom` — carries
 * `@smithersEffects {"version":1,"failures":["Bang"],"requirements":[]}`. That
 * is not a lost row, it is a WRONG artifact: a downstream module checks against
 * a failure row belonging to a different function.
 *
 * WHY THIS IS A PRECEDENCE RULE AND NOT A REFUSAL. The rest of this repair
 * campaign answers a collision with a diagnostic, and that is unavailable here:
 * a diagnostic the Go fork does not also raise makes the two backends disagree
 * on an accepted program, and the fork's row analysis
 * (`compiler/forkbridge/lowering.go.txt`) has no `publicName` and no row table
 * to mirror one into. Refusing a program TypeScript accepts, in one backend
 * only, would trade a wrong artifact for a divergence.
 *
 * So the rule is precedence, and it is chosen by ADDRESSABILITY rather than by
 * source order: the module-scope declaration owns the name, because it is the
 * only claimant `./declarations.ts` can ever look the row up for. Two
 * module-scope claimants cannot occur — TypeScript reports its own duplicate
 * identifier or duplicate implementation error first — so the winner is unique.
 *
 * WHAT IS STILL LOST, named here rather than left to be rediscovered: when two
 * NON-module-scope declarations share a base name and no module-scope one
 * claims it, the last still wins, exactly as before. That row is unaddressable
 * in the emitted declarations either way, so the choice is observable only
 * through `Analysis.rows` itself; narrowing it further would change the table
 * for every program with a method in it, to no consumer's benefit.
 * `Analysis.functions` is unaffected and keeps BOTH declarations — it is a list,
 * so nothing there was ever overwritten.
 */
function collectPublicRows(
  functions: readonly SemanticFunction[],
  sourceFile: ts.SourceFile,
  recovery: RecoveredSource,
): { rows: Record<string, FunctionRows>; publicFunctions: FunctionDeclaration[] } {
  const rows: Record<string, FunctionRows> = {};
  const moduleScopeOwned = new Set<string>();
  const publicFunctions: FunctionDeclaration[] = [];
  for (const fn of functions) {
    if (!fn.publicName) continue;
    publicFunctions.push(publicFunctionDeclaration(fn, sourceFile, recovery));
    const moduleScope = isModuleScopeFunction(fn.node);
    if (!moduleScope && moduleScopeOwned.has(fn.publicName)) continue;
    if (moduleScope) moduleScopeOwned.add(fn.publicName);
    rows[fn.publicName] = {
      failures: [...fn.failures].sort(),
      requirements: [...fn.requirements].sort(),
    };
  }
  return { rows, publicFunctions };
}

function publicFunctionDeclaration(
  fn: SemanticFunction,
  sourceFile: ts.SourceFile,
  recovery: RecoveredSource,
): FunctionDeclaration {
  const body = fn.node.body;
  return {
    name: fn.publicName!,
    exported: fn.exported,
    async: fn.async,
    channel: effectiveChannel(fn),
    explicitReturn: fn.explicitReturn,
    start: remapOffset(recovery, fn.node.getStart(sourceFile)),
    end: remapEnd(recovery, fn.node.end),
    bodyStart: remapOffset(recovery, body?.getStart(sourceFile) ?? fn.node.end),
    bodyEnd: remapEnd(recovery, body?.end ?? fn.node.end),
  };
}

/**
 * Deduplicate, remap to authored coordinates, and locate diagnostics. All
 * pending diagnostics carry derived offsets; recovery diagnostics already
 * carry authored offsets and join after remapping.
 */
function finalizeDiagnostics(
  pending: readonly PendingDiagnostic[],
  recovery: RecoveredSource,
  sourceFile: ts.SourceFile,
): Diagnostic[] {
  const located = recovery.changed
    ? (diagnostic: PendingDiagnostic): Diagnostic => {
        const start = remapOffset(recovery, diagnostic.start);
        return { ...diagnostic, start, ...lineAndColumnFromText(recovery.authoredSource, start) };
      }
    : (diagnostic: PendingDiagnostic): Diagnostic => ({ ...diagnostic, ...lineAndColumn(sourceFile, diagnostic.start) });
  const remapped: Diagnostic[] = pending.map(located);
  for (const diagnostic of recovery.diagnostics) {
    remapped.push({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      start: diagnostic.start,
      ...lineAndColumnFromText(recovery.authoredSource, diagnostic.start),
    });
  }
  const seenDiagnostics = new Set<string>();
  return remapped
    .filter((diagnostic) => {
      const key = `${diagnostic.code}:${diagnostic.start}:${diagnostic.message}`;
      if (seenDiagnostics.has(key)) return false;
      seenDiagnostics.add(key);
      return true;
    })
    .sort((left, right) => left.start - right.start || compareText(left.code, right.code) ||
      compareText(left.message, right.message));
}

function lineAndColumnFromText(text: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < bounded; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index += 1;
      line += 1;
      lineStart = index + 1;
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: bounded - lineStart + 1 };
}

function analysisForFile(
  parseSource: string,
  recovery: RecoveredSource,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  pending: readonly PendingDiagnostic[],
): Analysis {
  const diagnostics = finalizeDiagnostics(pending, recovery, sourceFile);
  const { rows, publicFunctions } = collectPublicRows(functions, sourceFile, recovery);
  return {
    errors: collectErrorDeclarations(sourceFile, checker, parseSource)
      .map((error) => remapErrorDeclaration(error, recovery)),
    functions: publicFunctions,
    rows,
    diagnostics,
  };
}

function checkProjectImports(
  environment: ProjectEnvironment,
  pendingByFile: ReadonlyMap<ts.SourceFile, PendingDiagnostic[]>,
): void {
  const { checker } = environment;
  // A binding is valid when the target module declares it, or when the target
  // re-exports it from somewhere else. The second case is how a generated
  // asset module reaches an authored consumer:
  // `export { default as config } from "./a.json" with { type: "json" }`
  // resolves to a declaration in the generated module, not in the `.sm`
  // module that re-exports it.
  const exportsByModule = new Map<ts.SourceFile, ReadonlySet<ts.Symbol>>();
  const exportedSymbolsOf = (sourceFile: ts.SourceFile): ReadonlySet<ts.Symbol> => {
    const cached = exportsByModule.get(sourceFile);
    if (cached) return cached;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const symbols = new Set(
      (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [])
        .map((exported) => unalias(exported, checker))
        .filter((exported): exported is ts.Symbol => exported !== undefined),
    );
    exportsByModule.set(sourceFile, symbols);
    return symbols;
  };
  for (const entry of environment.entries) {
    const diagnostics = pendingByFile.get(entry.sourceFile)!;
    for (const statement of entry.sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const target = resolveProjectSpecifier(entry.absoluteName, specifier, environment.entryByAbsoluteName);
      if (!target) {
        if (specifier.startsWith(".") && specifier.endsWith(".sm")) {
          diagnostics.push(at(
            statement.moduleSpecifier,
            entry.sourceFile,
            "SMITHERS1801",
            `relative Smithers module '${specifier}' is not present in the analyzeProject source set`,
          ));
        }
        continue;
      }
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const importedBindings: ts.Identifier[] = [];
      if (clause.name) importedBindings.push(clause.name);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) importedBindings.push(element.name);
        }
      }
      const reExported = exportedSymbolsOf(target.sourceFile);
      for (const binding of importedBindings) {
        const resolved = unalias(checker.getSymbolAtLocation(binding), checker);
        const belongsToTarget = resolved !== undefined && (
          resolved.declarations?.some((declaration) => declaration.getSourceFile() === target.sourceFile) ||
          reExported.has(resolved)
        );
        if (!belongsToTarget) {
          diagnostics.push(at(
            binding,
            entry.sourceFile,
            "SMITHERS1804",
            `import '${binding.text}' does not resolve to an exported value in '${target.displayName}'`,
          ));
        }
      }
    }
  }
}

function checkDeferredProjectCalls(
  environment: ProjectEnvironment,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  pendingByFile: ReadonlyMap<ts.SourceFile, PendingDiagnostic[]>,
): void {
  const { checker } = environment;
  const functionBySymbol = new Map<ts.Symbol, SemanticFunction>();
  for (const fn of functions) {
    const symbol = functionSymbol(fn.node, checker);
    if (symbol) functionBySymbol.set(symbol, fn);
  }

  for (const entry of environment.entries) {
    const diagnostics = pendingByFile.get(entry.sourceFile)!;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !isInTypePosition(node) && !isProjectModuleBindingName(node)) {
        // `expressionSymbol`, not a bare `getSymbolAtLocation`: on a shorthand
        // property name the latter answers the object literal's PROPERTY, so
        // `{ plain }` escaped while the identical `{ plain: plain }` was
        // refused — the same divergence `SMITHERS1303` had to close.
        const symbol = unalias(expressionSymbol(node, checker), checker);
        const target = symbol && functionBySymbol.get(symbol);
        if (target && target.node.getSourceFile() !== entry.sourceFile &&
          !isCheckedProjectReference(node, target, callEdges, checker, functions, functionByNode)) {
          diagnostics.push(at(
            node,
            entry.sourceFile,
            "SMITHERS1802",
            `cross-module function '${target.name}' escapes direct static call analysis; wrap the higher-order use in an explicitly checked local function`,
          ));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(entry.sourceFile);
  }
}

/** Type shapes whose members are only known once type arguments are supplied. */
const DEFERRED_TYPE_FLAGS = ts.TypeFlags.TypeParameter |
  ts.TypeFlags.Conditional |
  ts.TypeFlags.IndexedAccess |
  ts.TypeFlags.Substitution;

/**
 * The unresolved constituents of a row type, named for diagnostics. An empty
 * result means every constituent is a concrete nominal type, so the row can be
 * serialized as ordinary member names.
 */
function deferredRowConstituents(type: ts.Type, checker: ts.TypeChecker): readonly string[] {
  const names = new Set<string>();
  const seen = new Set<ts.Type>();
  const inspect = (current: ts.Type): void => {
    if (seen.has(current)) return;
    seen.add(current);
    if ((current.flags & DEFERRED_TYPE_FLAGS) !== 0) {
      names.add(checker.typeToString(current));
      return;
    }
    if (current.isUnionOrIntersection()) {
      for (const part of current.types) inspect(part);
      return;
    }
    for (const argument of typeArguments(current, checker)) inspect(argument);
  };
  inspect(type);
  return [...names].sort(compareText);
}

/**
 * The declared effect row of a signature: the pair `(E, R)`.
 *
 * **G7.** This used to be `declaredFailureRowType`, which answered `E` alone.
 * `docs/DECISIONS.md` §Function model locks the row as a PAIR, so the three
 * functions that read a declared row — this one, {@link genericRowTemplate},
 * and {@link instantiateEffectRow} — read both halves through this one helper
 * rather than one half here and none anywhere else.
 *
 * The two halves have different carriers, and that asymmetry is the finding
 * rather than an oversight:
 *
 * - `E` is a TYPE. `Result<A, E>`'s error channel is read off the prelude's
 *   own brand, so it can mention the declaration's type parameters and is
 *   therefore instantiable per call site.
 * - `R` is METADATA. The compiler's chosen representation is the
 *   `@smithersEffects` tag `declarations.ts` writes onto every emitted
 *   declaration — `specification/compatibility.mdx` §TypeScript Target leaves
 *   the representation open ("Whatever representation is chosen MUST
 *   additionally carry whether a function is effectful") and this is it. A JSON
 *   array of nominal names cannot mention a type parameter, so `R` is never
 *   deferred and never needs instantiating. The generalization below is
 *   nevertheless written for both halves, because the asymmetry is a property
 *   of today's carrier and not of the rule.
 */
interface DeclaredEffectRow {
  /** The declared `Result` error type, after unwrapping `Promise`. */
  readonly error?: ts.Type;
  /** Nominal `Context` subclass names the declaration publishes about itself. */
  readonly requirements: ReadonlySet<string>;
}

function declaredEffectRow(
  signature: ts.Signature | undefined,
  checker: ts.TypeChecker,
): DeclaredEffectRow {
  if (!signature) return { requirements: NO_REQUIREMENTS };
  let returnType = checker.getReturnTypeOfSignature(signature);
  returnType = promisedType(returnType, checker) ?? returnType;
  return {
    error: compilerResultChannels(returnType, checker)?.error,
    requirements: declaredRequirementRow(signature.declaration),
  };
}

/**
 * The requirement row a DECLARATION publishes about itself, or the empty row.
 *
 * The empty answer is the LOCKED default, not an "unknown": `DECISIONS.md`
 * §Function model states "An unannotated function type carries the empty row",
 * so a signature with no metadata is a signature whose row is empty, and a
 * caller may lower its call site on that basis. That is what makes
 * {@link callConvention}'s last arm decidable — see G7 there.
 *
 * Read strictly. The tag is compiler-owned and its encoding is canonical
 * (`declarations.ts` re-serializes and compares), so anything that does not
 * parse to the exact envelope is treated as absent rather than as a partial
 * row: a malformed tag must not silently shrink a row, and a row that is
 * silently WIDER than the truth costs only an unnecessary delegation.
 */
export function declaredRequirementRow(declaration: ts.Declaration | undefined): ReadonlySet<string> {
  if (!declaration) return NO_REQUIREMENTS;
  const tags = ts.getJSDocTags(declaration).filter((tag) => tag.tagName.text === DECLARATION_EFFECT_TAG);
  if (tags.length !== 1) return NO_REQUIREMENTS;
  const comment = tags[0]!.comment;
  if (typeof comment !== "string" || comment.length > 65_536) return NO_REQUIREMENTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(comment);
  } catch {
    return NO_REQUIREMENTS;
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") return NO_REQUIREMENTS;
  const record = parsed as Record<string, unknown>;
  if (record.version !== DECLARATION_EFFECT_VERSION) return NO_REQUIREMENTS;
  const requirements = record.requirements;
  if (!Array.isArray(requirements) || !requirements.every((name) => typeof name === "string")) {
    return NO_REQUIREMENTS;
  }
  return requirements.length === 0 ? NO_REQUIREMENTS : new Set(requirements as readonly string[]);
}

/**
 * A generic success value does not make a concrete Error/Context row
 * polymorphic. Only a declared row that mentions the declaration's own type
 * parameters (directly or through a deferred type operation) is a polymorphic
 * row template that each call site must instantiate.
 *
 * **G7**: asked of the pair, not of `E` alone. `R`'s carrier is a JSON array of
 * nominal names, which cannot mention a type parameter, so the requirement half
 * contributes nothing today and MEASURES nothing — the predicate's answer is
 * unchanged on every program in the tree. It is written this way so that giving
 * `R` a type-level carrier later is a change to the carrier and not to this
 * rule.
 */
function genericRowTemplate(fn: SemanticFunction, checker: ts.TypeChecker): boolean {
  if (!fn.node.typeParameters?.length) return false;
  const signature = checker.getSignatureFromDeclaration(fn.node);
  if (!signature) return true;
  const row = declaredEffectRow(signature, checker);
  // A generic declaration whose row is not a spelled `Result` error has no
  // template to instantiate; its row is whatever its body infers.
  if (!row.error) return false;
  return deferredRowConstituents(row.error, checker).length > 0;
}

type RowInstantiation =
  | {
    readonly ok: true;
    readonly failures: ReadonlySet<string>;
    readonly requirements: ReadonlySet<string>;
  }
  | { readonly ok: false; readonly unresolved: readonly string[] };

/**
 * Instantiate a polymorphic row template at one checker-resolved direct static
 * call. The checker has already substituted the call's explicit or inferred
 * type arguments into the resolved signature, so the instantiated error type is
 * read straight back out of it. Anything still deferred there (the caller
 * forwarding its own type parameter, an unresolvable conditional) fails closed
 * instead of contributing an approximate row.
 *
 * **G7**: returns the pair. The requirement half is read off the same resolved
 * signature and is invariant under substitution, so it is carried rather than
 * instantiated.
 */
function instantiateEffectRow(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): RowInstantiation {
  const signature = checker.getResolvedSignature(call);
  if (!signature) return { ok: false, unresolved: ["the call signature"] };
  const row = declaredEffectRow(signature, checker);
  if (!row.error) return { ok: false, unresolved: ["the instantiated Result error"] };
  const unresolved = deferredRowConstituents(row.error, checker);
  if (unresolved.length > 0) return { ok: false, unresolved };
  return { ok: true, failures: errorNames(row.error, checker), requirements: row.requirements };
}

/** A type's own nominal name plus every base class name above it. */
function nominalAncestryNames(type: ts.Type, checker: ts.TypeChecker, seen = new Set<ts.Type>()): Set<string> {
  const names = new Set<string>();
  if (seen.has(type)) return names;
  seen.add(type);
  for (const name of errorNames(type, checker)) names.add(name);
  for (const base of baseTypesOf(type, checker)) {
    for (const name of nominalAncestryNames(base, checker, seen)) names.add(name);
  }
  return names;
}

function typeConstituents(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [type];
}

/**
 * An instantiated row is only as nominal as the checker's assignability, and
 * two authored `class X extends Error {}` declarations are structurally the
 * same type. So a callback argument that carries its own explicit Result
 * contract is additionally required to be nominally covered by the row the
 * site instantiated: without this, an explicit type argument could name a
 * sibling Error and publish a row the callback can never produce.
 *
 * Callbacks without an explicit Result contract are already rejected by the
 * inferred-fallible callback rule, so they need no second gate here.
 */
function uncoveredCallbackRowNames(
  call: ts.CallExpression,
  row: ReadonlySet<string>,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly string[] {
  const uncovered = new Set<string>();
  for (const argument of call.arguments) {
    const callback = resolveFunctionReference(argument, checker, functions, functionByNode);
    if (!callback?.explicitReturn || !callback.declaredShape.channel.startsWith("result")) continue;
    const declared = declaredEffectRow(checker.getSignatureFromDeclaration(callback.node), checker).error;
    if (!declared) continue;
    for (const part of typeConstituents(declared)) {
      if (deferredRowConstituents(part, checker).length > 0) continue;
      const ancestry = nominalAncestryNames(part, checker);
      if (![...ancestry].some((name) => row.has(name))) {
        for (const name of errorNames(part, checker)) uncovered.add(name);
      }
    }
  }
  return [...uncovered].sort(compareText);
}

/**
 * A module-binding NAME rather than a use of the value it binds.
 *
 * `export { plain }` re-exports the binding; it does not evaluate the function
 * or hand it to anyone, and a downstream direct call through the re-export
 * still resolves to the same declaration and still carries its row (measured:
 * a requirement crosses a two-hop re-export chain intact). It is the mirror
 * image of `import { plain }`, which was always exempt.
 */
function isProjectModuleBindingName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent) ||
    ts.isExportSpecifier(parent);
}

/**
 * Whether a reference to a cross-module function is an ordinary call whose row
 * this analysis has already attributed, rather than a value escaping it.
 *
 * `SMITHERS1802` is the fail-closed backstop for the second case
 * (`specification/compatibility.mdx`: a build "MUST fail closed on any
 * construct whose lowering depends on information the file alone does not
 * carry, rather than emitting a guess"). It must not fire on the first: an
 * ordinary call is exactly what `specification/requirements.mdx` §Inference and
 * `specification/type-system.mdx` §Fallibility Inference require rows to travel
 * through.
 *
 * Three spellings are ordinary calls whose rows are already attributed, and all
 * three used to draw the diagnostic:
 *
 *  - a call at module top level. Call edges are collected per function body, so
 *    a top-level call has none — but `resolveLocalCallee` resolves it, which is
 *    what `SMITHERS2102` and the top-level channel checks already use, and the
 *    hazards there (`1301`/`1302`/`2102`) fire identically for a same-module
 *    callee, which was never refused.
 *  - a parenthesized callee, `(plain)(1, 2)`. The row IS charged (the resolved
 *    signature sees through parentheses); only this walk did not. An `as`-cast
 *    callee is NOT accepted, because there the row genuinely stops.
 *  - a property or element access backed by an accessor. Reading it runs it;
 *    see `accessorInvocations`, which now charges the row it invokes.
 */
function isCheckedProjectReference(
  node: ts.Identifier,
  target: SemanticFunction,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): boolean {
  // `const { value: read } = source` names the property explicitly, and that
  // name resolves to the accessor. It reads it exactly as `source.value` does.
  if (ts.isBindingElement(node.parent) && node.parent.propertyName === node &&
    destructuredAccessorInvocations(node.parent, checker, functionByNode).includes(target)) {
    return true;
  }
  let expression: ts.Expression = node;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    if (accessorInvocations(node.parent, checker, functionByNode).includes(target)) return true;
    expression = node.parent;
  }
  while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
  const parent = expression.parent;
  if (!ts.isCallExpression(parent) || parent.expression !== expression) return false;
  if (!isAnalyzedCallSite(parent)) return false;
  return callEdges.get(parent)?.callee === target ||
    resolveLocalCallee(parent, checker, functions, functionByNode) === target;
}

/**
 * Whether a call's callee row was attributed anywhere.
 *
 * `collectFacts` walks function BODIES, and the top-level passes
 * (`SMITHERS2102` requirements, `SMITHERS1301`/`1302` must-consume,
 * `SMITHERS1505` channels) cover module evaluation and anything else outside a
 * function, such as a class property initializer. A call in a PARAMETER DEFAULT
 * is in neither: its callee's row is charged nowhere, so a cross-module callee
 * there is a genuine fail-closed case and keeps `SMITHERS1802`.
 */
function isAnalyzedCallSite(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    const parent: ts.Node = current.parent;
    // A member's computed NAME is analyzed by the ENCLOSING scope, not by the
    // member; see `evaluatedOutsideFunction`.
    if (isSupportedFunctionLike(parent) && !evaluatedOutsideFunction(parent).includes(current)) {
      return parent.body === current;
    }
    current = parent;
  }
  return true;
}

function checkTopLevelForeignBoundaries(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges?: ReadonlyMap<InvocationExpression, CallEdge>,
  functions: readonly SemanticFunction[] = [],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction> = new Map(),
): void {
  const visit = (node: ts.Node): void => {
    if (node !== sourceFile && isSupportedFunctionLike(node)) {
      for (const outside of evaluatedOutsideFunction(node)) visit(outside);
      return;
    }
    // Static blocks are rejected wholesale (SMITHERS1107); avoid duplicate reports.
    if (ts.isClassStaticBlockDeclaration(node)) return;
    if (ts.isThrowStatement(node)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1511", "a top-level throw cannot be represented as a checked Result; move it into a checked Result-returning function and consume that Result"));
    }
    if (ts.isCallExpression(node)) {
      if (callEdges && isResultExpectCall(node, checker, callEdges)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1505", "top-level Result.expect() panics on the error variant and cannot expose that checked panic channel; move it into a checked Result-returning function and consume that Result"));
      }
      if (callEdges?.get(node)?.callee || resolveLocalCallee(node, checker, functions, functionByNode)) {
        ts.forEachChild(node, visit);
        return;
      }
      if (isPanicCall(node, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1505", "top-level panic cannot be represented as a checked Result; move it into a checked Result-returning function and consume that Result"));
      } else {
        const policy = foreignPolicy(node, checker, sourceFile, diagnostics);
        if (policy && policy.kind !== "never") {
          diagnostics.push(at(node, sourceFile, "SMITHERS1505", "an untrusted foreign call at top level cannot expose its checked panic channel; move it into a checked Result-returning function and consume that Result"));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * Heap provenance is intentionally bounded, but every supported foreign value
 * flow is checker-backed. Unsupported execution/escape sites are hard errors:
 * accepting them would be less honest than leaving the source untransformed.
 */
function checkForeignValueBoundaries(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): void {
  // Nodes at which the property/accessor rule has already reported SMITHERS1506.
  //
  // `for (const n of foreign.inner)` is BOTH a foreign property read and an
  // implicit iteration of what that read returned, and the two rules would
  // otherwise report the same code at the same position twice. The property rule
  // runs first and takes the node; the implicit rule still owns the node when
  // the property rule declined it — a `@throws {never}` getter that hands back a
  // foreign `Iterable` is trusted for the READ and still foreign for the
  // iteration.
  const evaluationReported = new Set<ts.Node>();
  const visit = (node: ts.Node, inheritedOwner?: SemanticFunction): void => {
    const owner = isSupportedFunctionLike(node) ? functionByNode.get(node) ?? inheritedOwner : inheritedOwner;

    if (ts.isCallExpression(node)) {
      const edge = callEdges.get(node);
      // Whose obligation is a callback's failure channel at a foreign boundary?
      //
      // `specification/compatibility.mdx` §Foreign Boundary attaches the channel
      // to the CALL — "Calling an unannotated foreign runtime value MUST add the
      // checked `panic` case … Trusted `@throws {never}` metadata opts out;
      // `@throws {T}` declares a more precise channel" — and
      // `failures.mdx` §Foreign Exceptions repeats it verbatim. A trust claim is
      // therefore a claim about everything that call does, including invoking an
      // argument it was handed: the binding author who writes `@throws {never}`
      // over a function that runs a listener is claiming the composite. The
      // deferred half is assigned by `requirements.mdx` §Scoping — "Imported
      // JavaScript or TypeScript that starts hidden background work owns that
      // work. Caller-controlled background APIs MUST expose explicit completion
      // or disposal handles through their adapters." That obligation is on the
      // adapter, not on `.sm`.
      //
      // Requiring the callback to be independently panic-free is not an
      // available reading: `failures.mdx` §Panic Does Not Widen a Return Type
      // says a function "MUST therefore be able to abort with `panic(...)` while
      // keeping a plain return type", so no `.sm` function can spell, or be
      // checked for, panic-freedom — the rule would admit nothing.
      //
      // What the trust claim does NOT cover, and what stays refused below:
      //   * an UNTRUSTED boundary (`kind === "panic"`), which keeps SMITHERS1509;
      //   * FOREIGN callable provenance handed on through the trusted call, which
      //     falls through to SMITHERS1508 — the neighbouring rule that owns a
      //     foreign callable escaping, and whose panic provenance no claim made
      //     about *this* callee can speak for;
      //   * the callback's own inferred Result channel (SMITHERS1303) and an
      //     async callback's started work (SMITHERS1404), both charged by
      //     `checkCallbackOwnership`, which never consults the boundary's trust.
      if (edge?.foreign && edge.foreign.kind === "panic") {
        for (const argument of node.arguments) {
          if (!containsCallableValue(argument, checker)) continue;
          diagnostics.push(at(
            argument,
            sourceFile,
            "SMITHERS1509",
            "a callback handed to an UNTRUSTED foreign call may escape beyond the checked call scope; register it through a trusted @throws {never} binding that owns the invocation, or expose an owned Smithers wrapper/adapter with an explicit Result or structured-task callback policy",
          ));
          recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
        }
      } else if (!edge?.panicExit) {
        for (const argument of node.arguments) {
          if (!containsForeignExecutableValue(argument, checker, callEdges)) continue;
          diagnostics.push(at(
            argument,
            sourceFile,
            "SMITHERS1508",
            "foreign callable provenance would escape through an unchecked higher-order call; wrap it in a local adapter that owns invocation and exposes an explicit Result/task contract",
          ));
          recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      checkForeignPropertyAccess(node, owner, sourceFile, checker, diagnostics, callEdges, evaluationReported);
    }

    if (ts.isTaggedTemplateExpression(node)) {
      checkForeignTemplateTag(node, owner, sourceFile, checker, diagnostics, callEdges);
    }

    if (ts.isDecorator(node)) {
      const applied = ts.isCallExpression(node.expression) ? node.expression.expression : node.expression;
      if (foreignValueOrigin(applied, checker)) {
        diagnostics.push(at(
          node,
          sourceFile,
          "SMITHERS1504",
          "a foreign decorator is invoked when the declaration is evaluated, with no call expression to lower; apply it inside an annotated adapter instead",
        ));
        recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
      }
    }

    if (ts.isExpression(node)) {
      checkImplicitForeignInvocation(node, owner, sourceFile, checker, diagnostics, callEdges, evaluationReported);
    }

    if (ts.isVariableDeclaration(node) && (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) &&
      node.initializer) {
      const origin = foreignValueOrigin(node.initializer, checker);
      if (origin && !origin.namespaceObject) {
        diagnostics.push(at(
          node.name,
          sourceFile,
          "SMITHERS1506",
          "destructuring a foreign value can execute untyped accessors and has no expression-safe Result lowering; read it through an annotated getter/factory adapter instead",
        ));
        recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer && ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) === 0 &&
      containsForeignExecutableValue(node.initializer, checker, callEdges)) {
      diagnostics.push(at(
        node.initializer,
        sourceFile,
        "SMITHERS1508",
        "a mutable alias cannot retain foreign panic provenance in this POC; use a const local adapter with an explicit Result contract",
      ));
      recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
    }

    if (ts.isNewExpression(node)) {
      const origin = foreignValueOrigin(node.expression, checker);
      if (origin) {
        const signature = checker.getResolvedSignature(node);
        const policy = foreignPolicyFromDeclaration(
          signature?.declaration,
          false,
          node,
          sourceFile,
          checker,
          diagnostics,
        );
        if (policy.kind !== "never") {
          diagnostics.push(at(
            node,
            sourceFile,
            "SMITHERS1504",
            "a foreign constructor can execute JavaScript but constructor Result lowering is deferred; expose an annotated factory function or Smithers adapter (only a checker-resolved @throws {never} constructor is accepted)",
          ));
          if (owner) addForeignFailures(owner.directFailures, policy);
        }
      } else if (foreignBaseClass(node.expression, checker)) {
        // An AUTHORED class whose base chain reaches a foreign class. `new X()`
        // runs that foreign constructor through an implicit `super(...)` that no
        // call expression names, so the constructor rule above never saw it.
        //
        // The rule is on the CONSTRUCTION and not on the `extends` clause,
        // because the clause alone runs no constructor: it evaluates the base
        // expression and sets a prototype. Refusing the clause was measurably
        // wrong — `17-durable/the-retired-vibelang-flows-specifier-is-not-compiler-owned`
        // declares a subclass of an unresolvable foreign `Action` and never
        // constructs it, and its declared diagnostic set is the module edge
        // alone.
        diagnostics.push(at(
          node,
          sourceFile,
          "SMITHERS1504",
          "constructing this class runs a FOREIGN base constructor through an implicit super(...) that no call expression names, and constructor Result lowering is deferred; wrap the base in an annotated factory or Smithers adapter and hold it as a field",
        ));
        recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
      }
    }

    if (ts.isReturnStatement(node) && node.expression && !ts.isNewExpression(node.expression) &&
      containsForeignExecutableValue(node.expression, checker, callEdges)) {
      diagnostics.push(at(
        node.expression,
        sourceFile,
        "SMITHERS1508",
        "returning an executable foreign value would lose its panic provenance; return a Smithers-owned adapter with an explicit Result/task contract instead",
      ));
      recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      containsForeignExecutableValue(node.right, checker, callEdges)) {
      diagnostics.push(at(
        node.right,
        sourceFile,
        "SMITHERS1508",
        "storing a foreign callable through a mutable/opaque reference loses panic provenance; use an immutable local adapter with an explicit Result contract",
      ));
      recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
    }

    ts.forEachChild(node, (child) => visit(child, owner));
  };
  visit(sourceFile);
}

/**
 * The protocols JavaScript runs on a value WITHOUT a call expression in the
 * source. Each names the member the language invokes, which is what the
 * diagnostic tells the author to look for.
 */
const IMPLICIT_INVOCATION_PROTOCOLS = {
  iteration: "Symbol.iterator / Symbol.asyncIterator",
  enumeration: "its own enumerable getters",
  coercion: "Symbol.toPrimitive / valueOf / toString",
} as const;

type ImplicitInvocationProtocol = keyof typeof IMPLICIT_INVOCATION_PROTOCOLS;

/**
 * Binary operators that evaluate an operand through the coercion protocol.
 *
 * `===`/`!==` are absent because they never coerce; `&&`, `||`, `??` and `,` are
 * absent because ToBoolean and sequencing run no user code. `instanceof` is
 * present for its RIGHT operand only (`Symbol.hasInstance`), which is handled at
 * the call site rather than by membership here.
 */
const COERCING_BINARY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
]);

const COERCING_PREFIX_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.TildeToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

/**
 * ONE predicate: does this expression's POSITION invoke an arbitrary method on
 * the value it holds?
 *
 * Every form below is a method call with no call expression to see. `for…of` and
 * spread and `yield*` run `value[Symbol.iterator]()`; object spread and
 * destructuring read every own enumerable property, running getters; template
 * interpolation, arithmetic, loose comparison and a computed key run
 * `Symbol.toPrimitive`/`valueOf`/`toString`. The panic-channel machinery is
 * driven from `ts.CallExpression`/`ts.NewExpression` and property reads, so all
 * of them were unmodelled and a foreign value that throws produced a raw host
 * `Error` out of a function whose row read `failures: []`.
 *
 * They are ONE rule and not five, deliberately. The enumerated-call-site shape
 * is how this class keeps reopening: each new sibling — `for await…of`,
 * `yield*`, a spread into a call's arguments, a compound assignment, a computed
 * property key — is a separate edit at a separate site, and the ones nobody
 * thought of stay fail-open silently. Asking the position a single question
 * makes the answer total over the grammar: a form is covered because the
 * predicate classifies it, not because someone remembered it.
 *
 * The receiver-provenance and can-execute gates live at the call site, so this
 * function is purely syntactic and has no checker dependency.
 */
function implicitInvocationProtocol(expression: ts.Expression): ImplicitInvocationProtocol | undefined {
  const parent = expression.parent as ts.Node | undefined;
  if (!parent) return undefined;

  // --- iteration protocol -------------------------------------------------
  // `for (const x of E)` and `for await (const x of E)` are one node kind.
  if (ts.isForOfStatement(parent) && parent.expression === expression) return "iteration";
  // `[...E]`, `f(...E)`, `new C(...E)` — one node kind for all three.
  if (ts.isSpreadElement(parent) && parent.expression === expression) return "iteration";
  if (ts.isYieldExpression(parent) && parent.asteriskToken && parent.expression === expression) return "iteration";
  // `[a] = E` — array destructuring ASSIGNMENT. The declaration form
  // (`const [a] = E`) is reported at its binding pattern by the neighbouring
  // rule, so it is deliberately not claimed twice here.
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === expression && ts.isArrayLiteralExpression(parent.left)) return "iteration";

  // --- enumeration protocol -----------------------------------------------
  if (ts.isSpreadAssignment(parent) && parent.expression === expression) return "enumeration";
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === expression && ts.isObjectLiteralExpression(parent.left)) return "enumeration";

  // --- coercion protocol --------------------------------------------------
  if (ts.isTemplateSpan(parent)) {
    // A TAGGED template does not coerce its substitutions: they are handed to
    // the tag untouched. The tag itself is a call and is refused separately.
    const template = parent.parent as ts.Node | undefined;
    return template?.parent && ts.isTaggedTemplateExpression(template.parent) ? undefined : "coercion";
  }
  if (ts.isPrefixUnaryExpression(parent) && COERCING_PREFIX_OPERATORS.has(parent.operator)) return "coercion";
  if (ts.isPostfixUnaryExpression(parent)) return "coercion";
  if (ts.isBinaryExpression(parent) && COERCING_BINARY_OPERATORS.has(parent.operatorToken.kind)) return "coercion";
  // `x instanceof E` runs `E[Symbol.hasInstance]`; `E in o` runs ToPropertyKey.
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    parent.right === expression) return "coercion";
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
    parent.left === expression) return "coercion";
  // `{ [E]: v }` and `o[E]` both run ToPropertyKey on `E`.
  if (ts.isComputedPropertyName(parent)) return "coercion";
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === expression) return "coercion";
  return undefined;
}

/**
 * The operand of a wrapper that changes only the TYPE, never the value.
 *
 * THE ONE TABLE for type-level wrappers, the sibling of `valueBranches` (which
 * is the one table for selecting OPERATORS). Every walk that asks "what value
 * is this really" has to use this and only this, because eight such walks were
 * written separately, each spelled its own `isParenthesizedExpression(e) ||
 * isAsExpression(e) || …` chain, and they drifted: when `satisfies` was added
 * to TypeScript it was taught to three of the eight and not to the other five.
 * `foreignValueOrigin` was one of the five, so `(client satisfies T).dangerous`
 * published `failures: []` and no diagnostic while `client.dangerous` was
 * refused — and a raw host `Error` escaped a function declared to return
 * `string`. Ten independently measured programs escaped that way, one per rule:
 * SMITHERS1504 (foreign constructor and foreign tag), SMITHERS1506 (property
 * read, element access, optional chain, iteration, spread, coercion),
 * SMITHERS1507/SMITHERS1101 (foreign callee), SMITHERS1508 (a callable handed
 * to a higher-order call, stored, or returned) and SMITHERS1509 (a callback
 * handed to an untrusted host). `satisfies` is the purest laundering wrapper
 * there is: unlike `as`, it does not even change the expression's type, so
 * nothing downstream can notice it was there.
 *
 * `undefined` means "this expression is not a type-level wrapper" — it is a
 * value as far as this table is concerned.
 *
 * What is deliberately NOT in the table, and why each is left to its caller:
 * `!` is this language's Result propagation boundary, so it turns a checked
 * `Result` into its success value and is a real operation, not a type-level
 * one (`foreignValueOrigin` clears `uncheckedResult` across it,
 * `semanticExpressionShape` changes channel across it, `isStableForeignCallee`
 * accepts it outright); and `await` removes a Promise layer, which is likewise
 * a real change of value. Both are still walked by the callers that should
 * walk them — just not from here, because they do not mean the same thing to
 * every caller and a shared table may only hold what does.
 */
function typeOnlyWrapperOperand(expression: ts.Expression): ts.Expression | undefined {
  // `x as const` is an `AsExpression` too, so it is covered by the same entry.
  return ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)
    ? expression.expression
    : undefined;
}

/** Parentheses and type assertions, removed. The runtime value is unchanged by both. */
function withoutTypeAssertions(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    const operand = typeOnlyWrapperOperand(current);
    if (!operand) return current;
    current = operand;
  }
}

/**
 * The first FOREIGN class in an authored class's `extends` chain, if any.
 *
 * `new Derived()` runs every constructor up the chain, so a foreign base three
 * levels up is still invoked by this construction and is still invoked with no
 * call expression naming it.
 */
function foreignBaseClass(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): ts.Expression | undefined {
  const symbol = unalias(expressionSymbol(expression, checker), checker);
  if (!symbol || seen.has(symbol)) return undefined;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (!ts.isClassDeclaration(declaration) && !ts.isClassExpression(declaration)) continue;
    for (const clause of declaration.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const base of clause.types) {
        if (foreignValueOrigin(base.expression, checker)) return base.expression;
        const deeper = foreignBaseClass(base.expression, checker, seen);
        if (deeper) return deeper;
      }
    }
  }
  return undefined;
}

/**
 * The shared reporter for `implicitInvocationProtocol`.
 *
 * Two gates keep this from widening past the defect. The value must have
 * FOREIGN provenance — an authored value in an implicit position runs authored
 * code — and it must be able to CARRY a foreign member: `foreignValueCanExecute`
 * is false for a primitive, so a trusted binding's `string` may still be
 * interpolated, iterated, and spread, because `String.prototype`'s protocol
 * members are the language's, not the foreign module's. An ESM namespace object
 * is excluded for the same reason `checkForeignPropertyAccess` excludes it:
 * its members are live-binding selection, not user accessors.
 */
function checkImplicitForeignInvocation(
  expression: ts.Expression,
  owner: SemanticFunction | undefined,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  evaluationReported: Set<ts.Node>,
): void {
  const protocol = implicitInvocationProtocol(expression);
  if (!protocol) return;
  if (evaluationReported.has(expression)) return;
  const origin = foreignValueOrigin(expression, checker);
  if (!origin || origin.namespaceObject) return;
  // The can-execute gate reads the type of the value ITSELF, with parentheses
  // and type assertions stripped. `(foreign as unknown as number) == 1` still
  // runs `foreign.valueOf()` at runtime, so asking the cast's type would let an
  // author launder the gate with the same `as` that provenance already refuses
  // to follow. `!` is deliberately not stripped: in `.sm` it is the checked
  // propagation boundary and it really does change the value.
  if (!foreignValueCanExecute(withoutTypeAssertions(expression), checker, callEdges)) return;
  diagnostics.push(at(
    expression,
    sourceFile,
    "SMITHERS1506",
    `this position invokes ${IMPLICIT_INVOCATION_PROTOCOLS[protocol]} on a foreign value with no call expression to lower; that ${protocol} step can throw, so bind the value through a checker-annotated adapter that returns an owned Smithers value first`,
  ));
  recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
}

/**
 * A tagged template is a CALL whose callee never appears in call position.
 *
 * `` tag`x${1}` `` invokes `tag`, so the same rule that governs `tag(strings, 1)`
 * governs it — but the foreign-call pipeline is keyed on `ts.CallExpression`, so
 * this form reached none of it and a throwing foreign tag escaped a
 * `failures: []` row uncaught. Result lowering for the tagged form is deferred
 * exactly as it is for `new`, so this follows the constructor precedent
 * (`SMITHERS1504`): the form is refused unless its RESOLVED signature carries
 * `@throws {never}`, which keeps a genuinely trusted tag usable.
 */
function checkForeignTemplateTag(
  node: ts.TaggedTemplateExpression,
  owner: SemanticFunction | undefined,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): void {
  const origin = foreignValueOrigin(node.tag, checker);
  if (!origin) return;
  const signature = checker.getResolvedSignature(node);
  const returned = signature ? checker.getReturnTypeOfSignature(signature) : checker.getTypeAtLocation(node);
  const policy = foreignPolicyFromDeclaration(
    signature?.declaration,
    carriesRejectionChannel(returned, checker),
    node,
    sourceFile,
    checker,
    diagnostics,
  );
  if (policy.kind === "never") {
    // The substitutions are this call's ARGUMENTS. A trust claim about the tag
    // cannot speak for another module's panic provenance, so foreign callable
    // provenance handed through them stays refused exactly as it is for the
    // ordinary call spelling `tag(strings, value)`.
    if (ts.isTemplateExpression(node.template)) {
      for (const span of node.template.templateSpans) {
        if (!containsForeignExecutableValue(span.expression, checker, callEdges)) continue;
        diagnostics.push(at(
          span.expression,
          sourceFile,
          "SMITHERS1508",
          "foreign callable provenance would escape through an unchecked higher-order call; wrap it in a local adapter that owns invocation and exposes an explicit Result/task contract",
        ));
        recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
      }
    }
    return;
  }
  diagnostics.push(at(
    node,
    sourceFile,
    "SMITHERS1504",
    "a foreign tagged template invokes its tag and can execute JavaScript, but tagged-template Result lowering is deferred; call the tag as an ordinary function through an annotated adapter (only a checker-resolved @throws {never} tag is accepted)",
  ));
  if (owner) addForeignFailures(owner.directFailures, policy);
}

function checkForeignPropertyAccess(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  owner: SemanticFunction | undefined,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  evaluationReported: Set<ts.Node>,
): void {
  const receiver = foreignValueOrigin(access.expression, checker);
  if (!receiver || receiver.namespaceObject) return;

  const policy = foreignAccessPolicy(access, sourceFile, checker, diagnostics);
  if (foreignAccessIsCovered(access, callEdges, checker) && policy.kind !== "declared") return;
  if (policy.kind === "never") return;
  evaluationReported.add(access);
  diagnostics.push(at(
    access,
    sourceFile,
    "SMITHERS1506",
    "foreign property/accessor evaluation can throw but expression-safe Result lowering is deferred; expose a checker-annotated getter/factory function or a Smithers wrapper adapter",
  ));
  if (owner) addForeignFailures(owner.directFailures, policy);
}

function foreignAccessIsCovered(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  checker: ts.TypeChecker,
): boolean {
  let current: ts.Node = access;
  for (let parent = current.parent; parent; current = parent, parent = parent.parent) {
    if (isSupportedFunctionLike(parent)) return false;
    if (ts.isNewExpression(parent) && parent.expression === current) return current === access;
    if (ts.isNonNullExpression(parent) && parent.expression === current) return true;
    if (ts.isCallExpression(parent)) {
      const foreign = callEdges.get(parent)?.foreign;
      if (!foreign) return false;
      if (parent.expression === current && current === access) return true;
      // The whole original call (callee chain and arguments) is evaluated inside
      // Result.try/tryPromise. A trusted `never` call has no such catch scope.
      return foreign.kind !== "never" && foreign.lowerable;
    }
    if (ts.isStatement(parent) || ts.isVariableDeclaration(parent)) return false;
  }
  return false;
}

function foreignAccessPolicy(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): ForeignPolicy {
  const location = ts.isPropertyAccessExpression(access) ? access.name : access.argumentExpression;
  const symbol = unalias(location ? checker.getSymbolAtLocation(location) : undefined, checker);
  const write = ts.isBinaryExpression(access.parent) && access.parent.left === access;
  const eligible = (symbol?.declarations ?? []).filter((declaration) => write
    ? ts.isSetAccessorDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)
    : ts.isGetAccessorDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration));
  // Trust across MERGED declarations of one property must be unanimous. A
  // property symbol can carry several declarations (interface merging, an
  // intersection), and `find(has a marker)` asked whether ANY spelling of the
  // member is trusted — the same per-symbol fail-open that overload resolution
  // has for calls. There is no "resolved signature" for a property read, so the
  // fail-closed choice is the opposite search: an UNANNOTATED declaration wins,
  // because a member one interface leaves unclaimed can still be the one whose
  // getter runs.
  const declaration = eligible.find((candidate) => !readThrowsAnnotation(candidate, checker)) ?? eligible[0];
  // A `@throws {never}` getter whose value is a Promise is the same fail-open as
  // a trusted async call: the marker speaks for the READ, and a rejection
  // arrives later. `promisedType` is read from the access, which is the getter's
  // value type at this site.
  const async = carriesRejectionChannel(checker.getTypeAtLocation(access), checker);
  return foreignPolicyFromDeclaration(declaration, async, access, sourceFile, checker, diagnostics);
}

function foreignPolicyFromDeclaration(
  declaration: ts.Node | undefined,
  async: boolean,
  boundary: ts.Node,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): ForeignPolicy {
  const annotation = foreignThrowsAnnotation(declaration, async, boundary, sourceFile, checker, diagnostics);
  if (!annotation) return { kind: "panic", async, lowerable: false };
  if (annotation === "never") return { kind: "never", async, lowerable: false };
  if (!/^[A-Za-z_$][\w$]*$/.test(annotation)) {
    diagnostics.push(at(boundary, sourceFile, "SMITHERS1502", `foreign @throws {${annotation}} is not reifiable in this POC; use one imported Error class constructor`));
    return { kind: "panic", async, lowerable: false };
  }
  return { kind: "declared", errorName: annotation, async, lowerable: false };
}

/**
 * The single place a `@throws` claim is admitted at a foreign boundary.
 *
 * Two claims are refused here rather than believed:
 *
 *   * a declaration carrying MORE THAN ONE distinct `@throws` (see
 *     `readThrowsClaim`), which makes no single claim to honour;
 *   * `@throws {never}` on an ASYNC or `Promise`-returning binding.
 *
 * `specification/failures.mdx` §Foreign Exceptions defines the marker as
 * removing "the default panic case" for a *call*, and
 * `specification/compatibility.mdx` §Foreign Boundary makes that same call the
 * subject: "Calling an unannotated foreign runtime value MUST add the checked
 * `panic` case, because JavaScript and TypeScript may throw, REJECT, or violate
 * a declaration." An `async` function that fails does not throw at the call —
 * it returns, and rejects later — so a marker about the call describes a
 * different channel than the one that actually carries the failure. Believing
 * it there erased the rejection channel outright, while the UNTRUSTED spelling
 * of the very same binding correctly charges `Panic`
 * (`09-foreign-calls/foreign-rejection-becomes-panic`), which is what makes the
 * trusted direction the fail-open one.
 *
 * The marker is refused rather than silently ignored. Ignoring it would leave
 * an author's honest-looking claim doing nothing, with no way to tell a binding
 * whose trust was believed from one whose trust was dropped; refusing says so,
 * and the boundary still falls back to the panic case so the row stays true for
 * `inspect` even when the diagnostic is not fatal.
 */
function foreignThrowsAnnotation(
  declaration: ts.Node | undefined,
  async: boolean,
  boundary: ts.Node,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): string | undefined {
  const claim = readThrowsClaim(declaration, checker);
  if (claim.contradiction) {
    diagnostics.push(at(
      boundary,
      sourceFile,
      "SMITHERS1502",
      `this foreign declaration makes contradictory @throws claims (${
        claim.contradiction.map((text) => `{${text}}`).join(" and ")
      }); a binding cannot both claim never and declare a channel — keep one @throws tag`,
    ));
    return undefined;
  }
  if (claim.annotation === "never" && async) {
    diagnostics.push(at(
      boundary,
      sourceFile,
      "SMITHERS1502",
      "foreign @throws {never} cannot describe an async or Promise-returning binding: the marker removes the checked panic case for the CALL, and an async binding fails by rejecting afterwards; expose a synchronous trusted binding, or drop the marker and propagate the panic case",
    ));
    return undefined;
  }
  return claim.annotation;
}

function recordForeignBoundary(owner: SemanticFunction | undefined, policy: ForeignPolicy): void {
  if (!owner) return;
  addForeignFailures(owner.directFailures, policy);
}

function containsCallableValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): boolean {
  if (isSupportedFunctionLike(expression)) return true;
  // Type-level wrappers (the shared table) plus `!`, which passes a callable
  // through unchanged.
  const unwrapped = typeOnlyWrapperOperand(expression);
  if (unwrapped) return containsCallableValue(unwrapped, checker, seen);
  if (ts.isNonNullExpression(expression)) {
    return containsCallableValue(expression.expression, checker, seen);
  }
  const type = checker.getTypeAtLocation(expression);
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return true;
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) return true;
      if (ts.isPropertyAssignment(property)) return containsCallableValue(property.initializer, checker, new Set(seen));
      if (ts.isShorthandPropertyAssignment(property)) return containsCallableValue(property.name, checker, new Set(seen));
      if (ts.isSpreadAssignment(property)) return containsCallableValue(property.expression, checker, new Set(seen));
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some((element) => ts.isExpression(element) && containsCallableValue(element, checker, new Set(seen)));
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(referencedValueSymbol(expression, checker), checker);
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
    return Boolean(declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
      containsCallableValue(declaration.initializer, checker, seen));
  }
  return false;
}

function containsForeignExecutableValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  seen = new Set<ts.Symbol>(),
): boolean {
  if (foreignValueOrigin(expression, checker) && foreignValueCanExecute(expression, checker, callEdges)) return true;
  // Type-level wrappers (the shared table) plus `!`, which passes the value
  // through unchanged.
  const unwrapped = typeOnlyWrapperOperand(expression);
  if (unwrapped) return containsForeignExecutableValue(unwrapped, checker, callEdges, seen);
  if (ts.isNonNullExpression(expression)) {
    return containsForeignExecutableValue(expression.expression, checker, callEdges, seen);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return containsForeignExecutableValue(property.initializer, checker, callEdges, new Set(seen));
      if (ts.isShorthandPropertyAssignment(property)) return containsForeignExecutableValue(property.name, checker, callEdges, new Set(seen));
      if (ts.isSpreadAssignment(property)) return containsForeignExecutableValue(property.expression, checker, callEdges, new Set(seen));
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some((element) => ts.isExpression(element) &&
      containsForeignExecutableValue(element, checker, callEdges, new Set(seen)));
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(referencedValueSymbol(expression, checker), checker);
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
    return Boolean(declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
      containsForeignExecutableValue(declaration.initializer, checker, callEdges, seen));
  }
  return false;
}

function foreignValueCanExecute(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): boolean {
  const type = semanticExpressionShape(expression, checker, callEdges).successType ?? checker.getTypeAtLocation(expression);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
  if (type.isUnion()) return type.types.some((part) => foreignTypeCanExecute(part));
  return foreignTypeCanExecute(type);
}

function foreignTypeCanExecute(type: ts.Type): boolean {
  return type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0 ||
    (type.flags & ts.TypeFlags.Object) !== 0;
}

function createProgram(source: string, requestedName?: string): {
  fileName: string;
  sourceFile: ts.SourceFile;
  program: ts.Program;
  checker: ts.TypeChecker;
} {
  const requested = requestedName && !requestedName.startsWith("<")
    ? resolve(requestedName)
    : resolve(process.cwd(), "__smithers_memory__.sm");
  const fileName = requested.endsWith(".sm") ? `${requested}.ts` : requested;
  const preludeName = resolve(dirname(fileName), PRELUDE_NAME);
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...MANDATORY_CHECKER_OPTIONS,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.Preserve,
    allowImportingTsExtensions: true,
    types: [...AUTHORED_AMBIENT_TYPE_PACKAGES],
  };
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const preludeFile = ts.createSourceFile(preludeName, PRELUDE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const resolved = resolve(name);
    if (resolved === fileName) return sourceFile;
    if (resolved === preludeName) return preludeFile;
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => {
    const resolved = resolve(name);
    return resolved === fileName || resolved === preludeName || originalFileExists(name);
  };
  host.readFile = (name) => {
    const resolved = resolve(name);
    if (resolved === fileName) return source;
    if (resolved === preludeName) return PRELUDE;
    return originalReadFile(name);
  };
  const program = ts.createProgram({ rootNames: [fileName, preludeName], options: compilerOptions, host });
  return { fileName, sourceFile: program.getSourceFile(fileName) ?? sourceFile, program, checker: program.getTypeChecker() };
}

function collectFunctions(sourceFile: ts.SourceFile, checker: ts.TypeChecker): SemanticFunction[] {
  const functions: SemanticFunction[] = [];
  const usedNames = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (isSupportedFunctionLike(node) && node.body) {
      const baseName = functionDisplayName(node, sourceFile);
      const count = usedNames.get(baseName) ?? 0;
      usedNames.set(baseName, count + 1);
      const name = count === 0 ? baseName : `${baseName}#${count + 1}`;
      const declaredShape = functionShape(node, checker);
      functions.push({
        node,
        name,
        publicName: isPubliclyNamedFunction(node) ? baseName : undefined,
        exported: isExported(node),
        async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
        explicitReturn: Boolean(node.type),
        declaredShape,
        directFailures: new Set(declaredShape.channel.startsWith("result") ? declaredShape.failures : []),
        bodyFailures: new Set(),
        failures: new Set(declaredShape.channel.startsWith("result") ? declaredShape.failures : []),
        directRequirements: new Set(),
        requirements: new Set(),
        directCapabilityRequirements: new Set(),
        capabilityRequirements: new Set(),
        calls: [],
        provides: [],
        accessorUses: [],
        expectCalls: [],
        boundaryCallbacks: [],
        callbackValues: [],
        channelSites: [],
        capabilitySites: [],
        propagationSites: [],
        hasResultPropagation: false,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function isSupportedFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node);
}

/**
 * THE ONE TABLE for the children of a function-like declaration that are
 * evaluated in the scope AROUND it rather than inside it.
 *
 * A member's COMPUTED NAME is the whole table: `{ [key]() {} }` evaluates `key`
 * where the object literal is written, before the method exists, so `key`'s
 * coercion belongs to the ENCLOSING row. Every walk here stops at a function
 * boundary, and the function's own body walk starts at its BODY — so a computed
 * name was visited by nobody, and `nearestFunction` answered with the very
 * method the name names. Measured: `{ [obj]() { return 1 } }` over an `obj`
 * whose `toString()` reads a capability published `requirements: []`, checked
 * `ok: true` on BOTH backends, and panicked at run time with
 * `capability 'Db' was not provided`. Nine spellings did it — a method, a
 * getter, a setter, an `async` method and a generator method in an object
 * literal, and a method, getter, static method and `async` method in a class —
 * while the three member kinds that are NOT function-like (`{ [obj]: 1 }`,
 * `{ [obj]: () => 1 }`, `class S { [obj]: number }`) were charged correctly all
 * along, which is exactly the shape of a walk that stops at functions.
 *
 * Parameter defaults are deliberately NOT here: they are evaluated when the
 * function is CALLED, so they belong to the callee's own row, and they are their
 * own open question. Decorators are not here either: they are evaluated when the
 * CLASS DEFINITION is, and `implicitInvocations` already charges them at the
 * class node for that reason.
 */
function evaluatedOutsideFunction(node: ts.FunctionLikeDeclaration): readonly ts.Node[] {
  return node.name && ts.isComputedPropertyName(node.name) ? [node.name] : [];
}

function isPubliclyNamedFunction(node: ts.FunctionLikeDeclaration): boolean {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
    (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name));
}

function functionDisplayName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `<anonymous@${line + 1}:${character + 1}>`;
}

function functionShape(node: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): TypeShape {
  const signature = checker.getSignatureFromDeclaration(node);
  const type = node.type
    ? checker.getTypeFromTypeNode(node.type)
    : signature
      ? checker.getReturnTypeOfSignature(signature)
      : checker.getAnyType();
  // G7: the declared row is a property of the DECLARATION, not of its return
  // type, so it is attached here rather than inside `shapeOfType`, which is
  // asked about types that have no declaration at all.
  return { ...shapeOfType(type, checker), requirements: declaredRequirementRow(node) };
}

export function shapeOfType(type: ts.Type, checker: ts.TypeChecker): TypeShape {
  const promised = promisedType(type, checker);
  if (promised) {
    const inner = shapeOfType(promised, checker);
    return { ...inner, async: true };
  }
  const channels = compilerResultChannels(type, checker);
  if (channels) {
    return {
      channel: "result",
      async: false,
      failures: channels.error ? errorNames(channels.error, checker) : new Set(["Error"]),
      // A TYPE carries no requirement metadata of its own — the carrier is the
      // declaration's `@smithersEffects` tag. `DECISIONS.md` §Function model
      // locks the default this leaves behind: "An unannotated function type
      // carries the empty row."
      requirements: NO_REQUIREMENTS,
      successType: channels.success,
    };
  }
  return {
    channel: "plain",
    async: false,
    failures: new Set(),
    requirements: NO_REQUIREMENTS,
    successType: type,
  };
}

/**
 * Compiler-construct identity, asked of a TYPE: is this the compiler's own
 * `Result`, the ambient `Promise`, the ambient `Error`? Answered from the
 * declaration the checker resolved, never from the name the author spelled.
 *
 * `nominalTypeName` was here. It was
 * `aliasSymbol.getName() ?? getSymbol().getName()` with no declaring-file test
 * of any kind, and it decided all three channels. It was wrong in both
 * directions, and both directions shipped artifacts.
 *
 * Spelling read as identity — a user type named `Result` became the channel:
 *
 *     interface Result<A, E> { readonly value: A; readonly other: E }
 *     function make(): Result<string, number> { return { value: "x", other: 1 } }
 *     export function use(): string { return make().value }
 *
 * published `channel: "result"` with a failure row of `["number"]` — a row
 * member that is not even an Error — emitted `return __vsResultSuccess({...})`
 * into a function declared to return the author's own struct, and charged
 * SMITHERS1301 "Result value is not consumed" against a caller that only read
 * a field off it. A user `class Result` had `return __vsResultSuccess(undefined)`
 * spliced into its constructor body. The same name-only reading of `Promise`
 * unwrapped a user container, and the same reading of `Error` lifted
 * `throw new Boom()` — where `Boom` extends a user-declared `Error` — into a
 * failure channel instead of refusing the non-Error throw (SMITHERS1103) it is.
 *
 * Identity read as spelling — reading `aliasSymbol` FIRST made the opposite
 * mistake. `type R<A, E extends Error> = Result<A, E>` answered `"R"`, so
 * `declaredEffectRow` returned no error channel and the author was told to "use
 * Result<A, E>" (SMITHERS1101) for a declaration that already was one.
 *
 * The prelude declares `readonly __smithersResult: { success: A; error: E }` on
 * `Result` for exactly this question and nothing consulted it. It is strictly
 * better than a name plus a declaring-file test, for two reasons that are not
 * stylistic: `getPropertyOfType` resolves THROUGH a type alias, so the
 * SMITHERS1101 direction is fixed by the same mechanism rather than by a second
 * one; and the brand carries the INSTANTIATED channels, so
 * `type R<A> = Result<A, Missing>` used as `R<number>` reports `Missing`, where
 * the positional `aliasTypeArguments` read saw a one-element list, found no
 * second argument, and fell back to a bare `Error`.
 *
 * The brand is evidence only when the property resolves to the PRELUDE's
 * declaration of it. An author can spell `__smithersResult` themselves, and a
 * structural read would hand them the channel on request. That gate is the same
 * `isCompilerPrelude` the sound sites in this file already use
 * ({@link isContextConstructorType}, {@link extendsImportedContext},
 * {@link isLayerCall}, {@link isPreludeResultBoundaryCall},
 * {@link isPreludeResultNamespaceMember}).
 *
 * `Promise` and `Error` carry no brand and need none: they are ambient
 * declarations of the TypeScript standard library, which is the same thing
 * {@link isAmbientPromiseNamespace} already resolves them against.
 */
const RESULT_BRAND = "__smithersResult";

function isDeclaredIn(
  symbol: ts.Symbol | undefined,
  inFile: (file: ts.SourceFile) => boolean,
): boolean {
  return Boolean(symbol?.declarations?.some((declaration) => inFile(declaration.getSourceFile())));
}

/** Whether `symbol` is declared by the checker-only prelude. */
export function isCompilerPreludeSymbol(symbol: ts.Symbol | undefined): boolean {
  return isDeclaredIn(symbol, isCompilerPrelude);
}

/** The prelude's own `__smithersResult` brand carried by `type`, if it carries one. */
function compilerResultBrand(type: ts.Type, checker: ts.TypeChecker): ts.Symbol | undefined {
  const brand = checker.getPropertyOfType(type, RESULT_BRAND);
  return isCompilerPreludeSymbol(brand) ? brand : undefined;
}

/** Whether `type` is the compiler's `Result` channel, under any spelling. */
export function isCompilerResultType(type: ts.Type, checker: ts.TypeChecker): boolean {
  return compilerResultBrand(type, checker) !== undefined;
}

/** The instantiated success and error channels the prelude's brand carries. */
function compilerResultChannels(
  type: ts.Type,
  checker: ts.TypeChecker,
): { readonly success?: ts.Type; readonly error?: ts.Type } | undefined {
  const brand = compilerResultBrand(type, checker);
  if (brand === undefined) return undefined;
  const branded = checker.getTypeOfSymbol(brand);
  const read = (key: string): ts.Type | undefined => {
    const member = checker.getPropertyOfType(branded, key);
    return member ? checker.getTypeOfSymbol(member) : undefined;
  };
  return { success: read("success"), error: read("error") };
}

/**
 * Whether `type` is one of the named ambient types DECLARED BY the TypeScript
 * standard library.
 *
 * The prelude merges its own members into the global `Error` interface, so the
 * global still holds a library declaration and answers true. A `.sm` module that
 * declares its own `Error` or `Promise` shadows the global with a separate
 * symbol declared only in that module, and answers false. `aliasSymbol` is
 * deliberately not consulted: an alias of the ambient type is still the ambient
 * type, which is the SMITHERS1101 direction above.
 */
function isAmbientLibraryType(type: ts.Type, names: readonly string[]): boolean {
  const symbol = type.getSymbol() ?? (type as ts.TypeReference).target?.getSymbol();
  if (symbol === undefined || !names.includes(symbol.getName())) return false;
  return isDeclaredIn(symbol, isTypeScriptLibrary);
}

/** The distinguished panic member of a failure row. */
export const COMPILER_PANIC_ROW_NAME = "Panic";

/**
 * Whether `owner`'s failure row charges the COMPILER's `Panic`.
 *
 * A row is a set of strings. `addForeignFailures` and the `.expect(...)` rule
 * add the member `"Panic"` by literal, and `errorNamesOfType` mints the same
 * string for a user `class Panic extends Error`, so once both are in the set
 * nothing distinguishes them. `panicMaterializes` (`compile.ts`) reads exactly
 * that membership to decide whether a real `panic()` becomes a Result VALUE or
 * stays an unwinding throw, and with a user `Panic` in scope it chose wrongly:
 *
 *     class Panic extends Error {}
 *     export function force(k: string): Result<string, Panic> {
 *       if (k === "") throw new Panic()
 *       if (k === "!") Reflect.panic("boom")
 *       return k
 *     }
 *
 * lowered the `Reflect.panic` to `return __vsResultFailure(__vsPanicValue(...))`,
 * putting a runtime panic value into a channel whose only declared member is
 * the author's class — where no `error.is(Panic)` and no exhaustive `match`
 * will recognize it. That is precisely the fail-open `panicMaterializes`
 * documents itself as preventing, reached through the row's spelling rather
 * than through the "returns some Result" test it already rejected.
 *
 * The membership is trustworthy exactly while the spelling `Panic` at this
 * function's location IS the prelude's `Panic`, so that is what is asked, with
 * the same `isCompilerPrelude` gate the rest of this file uses. A module that
 * shadows `Panic` and also carries a compiler-minted panic member answers false
 * and unwinds; unwinding is what a plain-channel function already does with
 * `panic()` and what `catchPanic` catches, so the ambiguous case fails CLOSED
 * rather than emitting a value no handler can match.
 *
 * Reserving the row name instead — qualifying the author's `Panic` the way
 * `buildRowNaming` qualifies two colliding user modules — would fix every row
 * consumer at once, but it changes the serialized row alphabet the Go fork
 * mirrors. That is a wider, cross-backend change than this defect needs; this
 * predicate leaves every emitted row byte-identical.
 */
export function chargesCompilerPanic(owner: SemanticFunction, model: SemanticModel): boolean {
  if (!owner.failures.has(COMPILER_PANIC_ROW_NAME)) return false;
  const symbol = unalias(
    model.checker.resolveName(
      COMPILER_PANIC_ROW_NAME,
      owner.node,
      ts.SymbolFlags.Type | ts.SymbolFlags.Value,
      false,
    ),
    model.checker,
  );
  return isCompilerPreludeSymbol(symbol);
}

function typeArguments(type: ts.Type, checker: ts.TypeChecker): readonly ts.Type[] {
  const aliasArguments = (type as ts.TypeReference).aliasTypeArguments;
  if (aliasArguments?.length) return aliasArguments;
  if ((type.flags & ts.TypeFlags.Object) !== 0 && ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0) {
    return checker.getTypeArguments(type as ts.TypeReference);
  }
  return [];
}

const AMBIENT_PROMISE_TYPES = ["Promise", "PromiseLike"];

function promisedType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  if (!isAmbientLibraryType(type, AMBIENT_PROMISE_TYPES)) return undefined;
  return typeArguments(type, checker)[0] ?? checker.getAwaitedType(type);
}

/**
 * Module-qualified nominal row identities.
 *
 * A row member is serialized by its unqualified declaration name while that
 * name is unique across the analyzed project. When two modules declare the
 * same Error/Context name the identities would collide, so every colliding
 * declaration is serialized as `Name@module/path` instead. The qualifier is the
 * project-relative module path without its `.sm` extension, which is the same
 * module identity `stableErrorId` already uses for the runtime registration, so
 * the analysis row and the runtime nominal identity cannot drift apart.
 *
 * The naming is keyed by the checker that produced the symbols, so it stays
 * valid for the lowering pass that runs against the same program.
 */
interface RowNaming {
  readonly bySymbol: ReadonlyMap<ts.Symbol, string>;
}

const rowNamingByChecker = new WeakMap<ts.TypeChecker, RowNaming>();

/**
 * `[A-Za-z0-9._/-]` — every UTF-16 code unit that survives the qualifier
 * verbatim.
 *
 * `+` is deliberately outside it, and that is the whole reason the encoding
 * below is reversible: an unescaped `+` can never occur, so every `+` in a
 * qualifier starts exactly one five-unit escape. It is the same withholding
 * trick `escapeIdentityPath` (`../durable/site-id.ts`) uses, over a smaller
 * alphabet: `@` and `:` are verbatim there and escaped here, because a row
 * name is spelled `Name@qualifier` and keeping `@` out of the qualifier makes
 * the join unambiguous on its own, rather than only because a class name
 * happens to be a TypeScript identifier.
 */
function isRowQualifierUnit(unit: number): boolean {
  return (unit >= 0x30 && unit <= 0x39) || (unit >= 0x41 && unit <= 0x5a) ||
    (unit >= 0x61 && unit <= 0x7a) ||
    unit === 0x2e /* . */ || unit === 0x5f /* _ */ || unit === 0x2f /* / */ || unit === 0x2d /* - */;
}

/**
 * The qualifier is derived from a model's {@link identityFileName}, never from
 * the caller's raw spelling: a caller may name its sources by absolute path,
 * and a nominal row identity carrying `/Users/<someone>/checkout/...` is not a
 * nominal identity. The Go fork spells the same qualifier by trimming its
 * `/src/` virtual root (`compiler/forkbridge/lowering.go.txt`), so the two
 * backends agree only while this side stays root-relative too.
 *
 * A disambiguator that re-collides is not one. This function's predecessor
 * rewrote every unit outside `[A-Za-z0-9._/-]` to `_`, which is many-to-one and
 * on exactly the input it is reached for:
 *
 *     a b.sm  and  a_b.sm   ->  Boom@a_b
 *
 * Two modules in that relation each declaring `class Boom extends Error` were
 * handed ONE row name by the very mechanism that exists because their bare
 * names already collided. Downstream, `errorNamesOfType` returns a `Set`, so
 * the two rows merge into one member and `Error.match` exhaustiveness
 * (SMITHERS1253/1254) accepts a case for one as covering the other — a wrong
 * answer, silently, with no diagnostic anywhere on the path.
 *
 * `+XXXX` (four upper-case hex units, always four) fixes it the same way
 * `escapeIdentityPath` did: it is a bijection onto its image, so distinct
 * module paths cannot converge. A path spelled entirely in the alphabet is its
 * own escape, so every qualifier this project has ever minted is unchanged;
 * only the paths that were already colliding move.
 *
 * The units are UTF-16 CODE UNITS, and that is load-bearing across backends,
 * not a detail. The predecessor's `.replace(/…/g, "_")` had no `u` flag, so it
 * walked code units too — but the Go mirror's `for _, character := range
 * qualifier` walks RUNES and writes one `_` per rune. For an astral character
 * in a module path the two backends therefore disagreed outright: `x😀.sm`
 * minted `x__` here and `x_` in the fork. `stableErrorIdentity` and
 * `durableFailureIdentity` both already go through `utf16.Encode([]rune(…))`
 * for precisely this reason; this is the third site, and the fork's mirror now
 * does the same. No conformance case could have caught it: the corpus contains
 * no module path outside the alphabet AND no Error/Context class name declared
 * in two modules, so `buildRowNaming` never qualifies anything there at all.
 *
 * The `.sm` strip is injective on the accepted domain and only there:
 * `createProjectProgram` refuses a project source whose name does not end in
 * `.sm`, so `x.sm -> x` cannot meet an authored `x`.
 */
export function moduleRowQualifier(identityName: string): string {
  const trimmed = identityName.replace(/\.sm$/, "");
  let escaped = "";
  for (let index = 0; index < trimmed.length; index++) {
    const unit = trimmed.charCodeAt(index);
    escaped += isRowQualifierUnit(unit)
      ? trimmed[index]
      : `+${unit.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return escaped;
}

function rowNameForSymbol(
  symbol: ts.Symbol | undefined,
  fallback: string,
  checker: ts.TypeChecker,
): string {
  if (!symbol) return fallback;
  return rowNamingByChecker.get(checker)?.bySymbol.get(symbol) ?? fallback;
}

function buildRowNaming(entries: readonly ProjectEntry[], checker: ts.TypeChecker): RowNaming {
  const declarationsByName = new Map<string, Array<{ symbol: ts.Symbol; identityName: string }>>();
  for (const entry of entries) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name && node.heritageClauses?.length) {
        const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
        const isRowClass = isErrorType(checker.getTypeAtLocation(node.name), checker) ||
          extendsImportedContext(node, checker);
        if (symbol && isRowClass) {
          const values = declarationsByName.get(node.name.text) ?? [];
          values.push({ symbol, identityName: entry.identityName });
          declarationsByName.set(node.name.text, values);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(entry.sourceFile);
  }
  const bySymbol = new Map<ts.Symbol, string>();
  for (const [name, values] of declarationsByName) {
    const distinct = new Set(values.map((value) => value.symbol));
    if (distinct.size < 2) continue;
    // `Name@qualifier` is injective over (class name, module) and no further:
    // the class name is a TypeScript identifier so it holds no `@`, the
    // qualifier's alphabet excludes `@`, and `moduleRowQualifier` is a
    // bijection. What it cannot separate is two DISTINCT symbols with one name
    // in one module — `function a() { class Boom extends Error {} }` beside a
    // second `Boom` in another function of the same file. For Error rows that
    // program is already refused, by SMITHERS1150, which walks nested
    // declarations too; for a Context row reached through
    // `extendsImportedContext` it is not refused anywhere, and the two rows
    // still merge. That gap is narrower than the one above but it is real, and
    // it is named here rather than left for the next reader to rediscover.
    for (const value of values) {
      bySymbol.set(value.symbol, `${name}@${moduleRowQualifier(value.identityName)}`);
    }
  }
  return { bySymbol };
}

export function errorNamesOfType(type: ts.Type, checker: ts.TypeChecker): Set<string> {
  if (type.flags & ts.TypeFlags.Never) return new Set();
  if (type.isUnion()) {
    const names = new Set<string>();
    for (const part of type.types) for (const name of errorNamesOfType(part, checker)) names.add(name);
    return names;
  }
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const name = symbol?.getName();
  if (name && name !== "__type") return new Set([rowNameForSymbol(symbol, name, checker)]);
  const rendered = checker.typeToString(type);
  return new Set([rendered]);
}

const errorNames = errorNamesOfType;

function collectErrorDeclarations(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  source: string,
): ErrorDeclaration[] {
  const result: ErrorDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const type = checker.getTypeAtLocation(node.name);
      if (isErrorType(type, checker) && node.heritageClauses?.length) {
        result.push({
          name: node.name.text,
          fieldsSource: source.slice(node.members.pos, node.members.end),
          start: node.getStart(sourceFile),
          end: node.end,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/**
 * THE ONE ANSWER to "what does this type extend", for every walk that climbs a
 * heritage chain.
 *
 * `checker.getBaseTypes` is PARTIAL, and its precondition is much narrower than
 * `type.flags & Object`. It handles a tuple, then a symbol whose flags carry
 * `Class` or `Interface`, and for anything else it executes
 * `Debug.fail("type must be class or interface")` — an unhandled throw out of
 * the checker, which the CLI can only surface as a code-less, position-less
 * `SMITHERS_PROJECT_ERROR`. Worse, it reaches `type.symbol.flags` without a
 * guard, so a type with no symbol at all (a tuple *reference* such as
 * `readonly [number]`, whose `Tuple` flag lives on its target) throws a
 * TypeError from the same line.
 *
 * `Object` implies neither. An object literal, a `type X = { … }` alias, a
 * mapped type such as `Record<K, V>`, an anonymous function type, an
 * `Object.freeze` result, a `satisfies` expression and a tuple reference are
 * all `Object` and none of them is a class or an interface. Ordinary programs
 * produce every one of them — `throw { a: 1 }` and a plain
 * `{ match: () => "m" }` object took the compiler down through the two callers
 * below, which had each been taught the same insufficient `Object` test
 * separately.
 *
 * So the precondition is mirrored here, once, rather than at each call site.
 * Declining is the ACCURATE answer and not a fail-open: none of these shapes
 * has a heritage clause to read, so "no base types" is what they actually have,
 * and the callers' own rules then reach their ordinary verdicts — a thrown
 * object literal is not an Error and stays SMITHERS1103, a user object with a
 * `match` method is not a `Result` and compiles. The tuple arm the checker does
 * support is left to the checker, so every type that resolved before still
 * resolves identically.
 */
function baseTypesOf(type: ts.Type, checker: ts.TypeChecker): readonly ts.Type[] {
  if ((type.flags & ts.TypeFlags.Object) === 0) return [];
  if (((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Tuple) === 0) {
    const symbol = type.getSymbol();
    if (!symbol || (symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) === 0) return [];
  }
  return checker.getBaseTypes(type as ts.InterfaceType) ?? [];
}

const AMBIENT_ERROR_TYPES = ["Error"];

export function isErrorType(type: ts.Type, checker: ts.TypeChecker, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.isUnion()) return type.types.every((part) => isErrorType(part, checker, new Set(seen)));
  // A row-variable type parameter is an Error exactly when it is constrained to
  // one. An unconstrained parameter stays a non-Error throw (SMITHERS1103).
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint !== undefined && constraint !== type && isErrorType(constraint, checker, seen);
  }
  if (isAmbientLibraryType(type, AMBIENT_ERROR_TYPES)) return true;
  return baseTypesOf(type, checker).some((base) => isErrorType(base, checker, seen));
}

function collectFacts(
  fn: SemanticFunction,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  layerBindings: ReadonlyMap<ts.Symbol, ts.Expression>,
  diagnostics: PendingDiagnostic[],
  callEdges: Map<InvocationExpression, CallEdge>,
): void {
  const body = fn.node.body;
  if (!body) return;
  const authoredBoundary = isAuthoredResultBoundaryBody(fn.node, checker);

  const visit = (node: ts.Node, caughtByJavaScript = false): void => {
    if (node !== body && isSupportedFunctionLike(node)) {
      // A nested function is its own row — except for the parts of it that this
      // scope evaluates. See `evaluatedOutsideFunction`.
      for (const outside of evaluatedOutsideFunction(node)) visit(outside, caughtByJavaScript);
      return;
    }

    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, caughtByJavaScript || Boolean(node.catchClause));
      if (node.catchClause) visit(node.catchClause.block, caughtByJavaScript);
      if (node.finallyBlock) visit(node.finallyBlock, caughtByJavaScript);
      return;
    }

    // Determinism-sensitive ambient sites that CHARGE rather than refuse.
    // `specification/compatibility.mdx` §Determinism-Sensitive Members, rows
    // three and five. Charged here, in the per-function walk, because a row is
    // a property of the enclosing function; `checkHostGlobals` walks the whole
    // file and has no function to charge.
    for (const requirement of ambientRequirementCharges(node, checker)) {
      fn.directRequirements.add(requirement);
    }

    if (ts.isThrowStatement(node) && node.expression && !caughtByJavaScript) {
      const thrown = checker.getTypeAtLocation(node.expression);
      if (!isErrorType(thrown, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1103", "recoverable throw values must extend Error; use panic(...) for an unknown defect"));
      } else {
        for (const name of errorNames(thrown, checker)) fn.directFailures.add(name);
      }
    }

    if (ts.isCallExpression(node)) {
      if (isPromiseInstanceChain(node, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1401", "Promise instance .then(), .catch(), and .finally() are unavailable in authored .sm; consume the Promise with await"));
      }

      const capability = contextRequirement(node, checker);
      // The node this classification was made ABOUT, kept rather than dropped.
      // Nothing reads it yet; see `SemanticFunction.capabilitySites`.
      if (capability !== undefined) fn.capabilitySites.push({ call: node, receiver: capability });
      if (capability?.kind === "capability") {
        fn.directRequirements.add(capability.name);
        // A SITE, so the emitter has a `get` request to lower here. An ambient
        // charge reaches `directRequirements` only. @see directCapabilityRequirements
        fn.directCapabilityRequirements.add(capability.name);
      }
      if (capability?.kind === "ambiguous") {
        diagnostics.push(at(node, sourceFile, "SMITHERS2106", AMBIGUOUS_CONTEXT_RECEIVER_MESSAGE));
      }

      const panicExit = isPanicCall(node, checker);
      const callee = panicExit ? undefined : resolveLocalCallee(node, checker, functions, functionByNode);
      // Inside an authored Result.try/tryPromise callback the boundary itself
      // owns the throw scope, so foreign-policy adapter diagnostics are moot.
      const foreign = panicExit || callee
        ? undefined
        : foreignPolicy(node, checker, sourceFile, authoredBoundary ? [] : diagnostics);
      const propagatesFailure = panicExit || isReturnedOrPropagated(node);
      let instantiatedFailures: ReadonlySet<string> | undefined;
      let instantiatedRequirements: ReadonlySet<string> | undefined;
      if (callee && genericRowTemplate(callee, checker)) {
        const instantiation = instantiateEffectRow(node, checker);
        if (instantiation.ok) {
          instantiatedFailures = instantiation.failures;
          // G7: the requirement half travels with the failure half. It is
          // `undefined` rather than the empty set when the declaration
          // publishes nothing, so `inferRows` can tell "this site instantiated
          // an empty row" from "this site instantiated no row" without a second
          // flag — the same distinction `instantiatedFailures` already carries.
          if (instantiation.requirements.size > 0) instantiatedRequirements = instantiation.requirements;
          const uncovered = uncoveredCallbackRowNames(
            node,
            instantiation.failures,
            checker,
            functions,
            functionByNode,
          );
          if (uncovered.length > 0) {
            diagnostics.push(at(
              node,
              sourceFile,
              "SMITHERS1806",
              `instantiating '${callee.name}' here publishes the failure row ${
                formatSet(instantiation.failures)
              }, which a callback argument's declared ${uncovered.join(" | ")} cannot produce; correct the type arguments or widen the row`,
            ));
          }
        } else {
          diagnostics.push(at(
            node,
            sourceFile,
            "SMITHERS1803",
            `the failure row of generic call '${callee.name}' is a template over its type parameters and ${
              instantiation.unresolved.join(" | ")
            } is still unresolved at this call site; supply concrete type arguments or wrap the call in an explicitly checked non-generic function`,
          ));
        }
      }
      const edge: CallEdge = {
        node,
        callee,
        foreign,
        panicExit,
        propagatesFailure,
        authoredBoundary: authoredBoundary && Boolean(foreign),
        instantiatedFailures,
        instantiatedRequirements,
      };
      if (callee || foreign || panicExit) {
        fn.calls.push(edge);
        callEdges.set(node, edge);
      }
      if (panicExit) {
        // An authored `panic(...)`/`Reflect.panic(...)` exit does NOT enter the
        // recoverable failure row, and therefore cannot widen this function's
        // return type. `specification/failures.mdx`:
        //
        //   §Compiler Lifting  — "The distinguished `panic` case is tracked
        //     SEPARATELY from ordinary recoverable Error variants."
        //   §Foreign Exceptions — "Ordinary Result recovery MUST NOT swallow
        //     panic implicitly."
        //   §Panic Does Not Widen a Return Type — "Calling `panic(...)` MUST
        //     NOT force a function's return type to widen into
        //     `Result<A, Panic>`. ... A function that validates an argument,
        //     refuses a forgery, or asserts an invariant MUST therefore be able
        //     to abort with `panic(...)` while keeping a plain return type."
        //
        // `E` is the *expected*-error channel (reference/function-channels.mdx).
        // Charging `Panic` here put the panic inside `E`, where `unwrapOr`,
        // `recover`, and `match` consume it as an ordinary failure and it
        // disappears from the caller's row — the two MUSTs above, violated by
        // the mechanism that was supposed to serve them.
        //
        // The panic is still tracked, just not in this set: the call edge below
        // records `panicExit`, `isPanicExitCall` reads it back, `SMITHERS1503`
        // still constrains where it may appear, and the emitter still lowers it
        // (see `panicMaterializes` in compile.ts). What changes is only that it
        // no longer forces a Result channel onto its own declaration.
        //
        // The FOREIGN panic case is deliberately untouched: `addForeignFailures`
        // below still charges `Panic` for an unannotated foreign call, because
        // failures.mdx §Foreign Exceptions makes that a checked obligation the
        // caller "MUST propagate ... explicitly catch ... or use a trusted
        // adapter", and DECISIONS.md keeps it Locked and independent.
        if (!isSimplePanicExit(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1503", "panic(...) lowering is currently supported only as an expression statement or direct return"));
        }
      }
      if (foreign && propagatesFailure && !authoredBoundary) addForeignFailures(fn.directFailures, foreign);

      if (isExpectSyntax(node, checker)) fn.expectCalls.push(node);
      if (isPreludeResultBoundaryCall(node, checker)) {
        const boundaryBody = node.arguments[0];
        const callback = boundaryBody && isSupportedFunctionLike(boundaryBody)
          ? functionByNode.get(boundaryBody)
          : undefined;
        if (callback) fn.boundaryCallbacks.push(callback);
      }

      if (isLayerCall(node, checker, "provide")) {
        const layer = node.arguments[0];
        const callback = node.arguments[1];
        const resolved = layer ? resolveLayerExpression(layer, checker, layerBindings) : { values: new Set<string>(), complete: false };
        fn.provides.push({
          node,
          callback: callback && isSupportedFunctionLike(callback) ? functionByNode.get(callback) : undefined,
          callbackReference: callback ? resolveFunctionReference(callback, checker, functions, functionByNode) : undefined,
          provided: resolved.values,
          complete: resolved.complete,
        });
      }
    }

    // A tagged template and a `new` name their callee in the syntax and invoke
    // it, so they are ordinary calls for row purposes; see
    // `InvocationExpression` for the fail-open they closed. A CONSTRUCTOR
    // deliberately never propagates a failure: it cannot legally carry one
    // (a Result-returning constructor is SMITHERS1105, an inferred-fallible one
    // is SMITHERS1101), so the only channel that travels through `new` is the
    // requirement row.
    if (ts.isTaggedTemplateExpression(node) || ts.isNewExpression(node)) {
      const callee = resolveInvokedDeclaration(node, checker, functionByNode);
      if (callee) {
        const edge: CallEdge = {
          node,
          callee,
          propagatesFailure: ts.isTaggedTemplateExpression(node) &&
            isReturnedOrPropagated(node),
        };
        fn.calls.push(edge);
        callEdges.set(node, edge);
      }
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
      for (const callback of crossingCallbacks(node, checker, functions, functionByNode)) {
        fn.callbackValues.push(callback);
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      for (const accessor of accessorInvocations(node, checker, functionByNode)) fn.accessorUses.push(accessor);
    }
    if (ts.isBindingElement(node)) {
      for (const accessor of destructuredAccessorInvocations(node, checker, functionByNode)) {
        fn.accessorUses.push(accessor);
      }
    }
    for (const invoked of implicitInvocations(node, checker, functionByNode)) fn.accessorUses.push(invoked);

    if (ts.isReturnStatement(node) && node.expression) {
      fn.channelSites.push({ expression: node.expression, nonNull: false });
    }

    ts.forEachChild(node, (child) => visit(child, caughtByJavaScript));
  };
  visit(body);
  collectResultPropagations(body, fn);
}

/**
 * Record every postfix propagation site. The SHAPE of each one is read later,
 * inside the `inferRows` fixpoint; see `SemanticFunction.channelSites` for why
 * reading it here answered "plain" for exactly the inferred-fallible callees
 * the charge exists to catch.
 *
 * The walk itself still has to run after the whole body's call edges exist: a
 * foreign or inferred-fallible call keeps its authored TypeScript success type,
 * so only the semantic graph knows it produced a Result at all.
 */
function collectResultPropagations(body: ts.ConciseBody, fn: SemanticFunction): void {
  const visit = (node: ts.Node): void => {
    if (node !== body && isSupportedFunctionLike(node)) {
      for (const outside of evaluatedOutsideFunction(node)) visit(outside);
      return;
    }
    if (ts.isNonNullExpression(node)) {
      fn.channelSites.push({ expression: node.expression, nonNull: true });
      // The same site, as the `!` node itself. Read by nothing; see
      // `SemanticFunction.propagationSites`.
      fn.propagationSites.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

function resolveLocalCallee(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): SemanticFunction | undefined {
  const declaration = checker.getResolvedSignature(call)?.declaration;
  if (declaration) {
    const direct = functionByNode.get(declaration);
    if (direct) return direct;
  }
  const symbol = expressionSymbol(call.expression, checker);
  if (!symbol) return undefined;
  return functions.find((candidate) => functionSymbol(candidate.node, checker) === symbol);
}

/**
 * Whether a property/element access reads its property, writes it, or both.
 *
 * The distinction matters because a get/set pair is two separate declarations
 * with two separate rows: `box.mark = 1` executes only the setter.
 */
function accessDirection(access: ts.Expression): { readonly read: boolean; readonly write: boolean } {
  const parent = access.parent;
  if (ts.isBinaryExpression(parent) && parent.left === access) {
    const operator = parent.operatorToken.kind;
    if (operator === ts.SyntaxKind.EqualsToken) return { read: false, write: true };
    if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) {
      return { read: true, write: true };
    }
  }
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
    return { read: true, write: true };
  }
  if (ts.isDeleteExpression(parent)) return { read: false, write: false };
  return { read: true, write: false };
}

/**
 * The project accessors an ordinary property or element access invokes.
 *
 * Reading `box.size` CALLS the getter and writing `box.first = 1` CALLS the
 * setter. Neither spelling can turn the accessor into a value — there is no
 * syntax that names it without running it — so both are ordinary calls, and
 * `specification/requirements.mdx` §Inference governs them: "Calling a function
 * with unsatisfied requirements MUST add those capabilities to the caller's `R`
 * row. ... Requirement inference MUST be transitive through ordinary calls."
 * Without this edge an accessor's requirements vanished at every read, and the
 * only reason a cross-module get-only accessor did not fail open was that
 * `SMITHERS1802` happened to refuse it — while a same-module accessor, a
 * setter, and a get/set pair all compiled with the row silently dropped.
 *
 * The accessor's FAILURES are deliberately not charged here: a getter that
 * yields `Result<A, E>` hands the reader a Result *value*, which must-consume
 * and postfix propagation already govern, exactly as they do for a call whose
 * Result is not propagated.
 */
function accessorInvocations(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  checker: ts.TypeChecker,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly SemanticFunction[] {
  let symbol: ts.Symbol | undefined;
  if (ts.isPropertyAccessExpression(access)) {
    symbol = checker.getSymbolAtLocation(access.name);
  } else {
    const argument = access.argumentExpression;
    // A computed member is only statically known when its key is a literal.
    if (!argument || !ts.isStringLiteralLike(argument)) return [];
    symbol = checker.getSymbolAtLocation(argument) ??
      checker.getTypeAtLocation(access.expression).getProperty(argument.text);
  }
  const declarations = symbol?.declarations;
  if (!declarations?.length) return [];
  const direction = accessDirection(access);
  const invoked: SemanticFunction[] = [];
  for (const declaration of declarations) {
    const wanted = ts.isGetAccessorDeclaration(declaration)
      ? direction.read
      : ts.isSetAccessorDeclaration(declaration)
      ? direction.write
      : false;
    if (!wanted) continue;
    const accessor = functionByNode.get(declaration);
    if (accessor) invoked.push(accessor);
  }
  return invoked;
}

/**
 * The project getters an object destructuring pattern invokes.
 *
 * `const { size } = box` reads `size` exactly as `box.size` does, so it is the
 * same ordinary call and carries the same row. Only getters can be reached this
 * way; a binding pattern never writes.
 */
function destructuredAccessorInvocations(
  element: ts.BindingElement,
  checker: ts.TypeChecker,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly SemanticFunction[] {
  const pattern = element.parent;
  if (!ts.isObjectBindingPattern(pattern)) return [];
  // `const { ...rest } = box` names no property and reads EVERY remaining own
  // enumerable one, running each of their getters — the enumeration protocol,
  // in the declaration spelling the position table deliberately leaves to this
  // neighbouring rule.
  if (element.dotDotDotToken) {
    return ownEnumerableAccessors(checker.getTypeAtLocation(pattern), functionByNode);
  }
  const name = element.propertyName ?? element.name;
  if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) return [];
  const property = checker.getTypeAtLocation(pattern).getProperty(name.text);
  const invoked: SemanticFunction[] = [];
  for (const declaration of property?.declarations ?? []) {
    if (!ts.isGetAccessorDeclaration(declaration)) continue;
    const accessor = functionByNode.get(declaration);
    if (accessor) invoked.push(accessor);
  }
  return invoked;
}

/**
 * The checked getters an ENUMERATION of a value's own properties runs.
 *
 * `{ ...box }`, `({ ...rest } = box)` and `const { ...rest } = box` copy every
 * OWN ENUMERABLE property, which runs each of their getters — and only those.
 * A getter declared in a CLASS body lives on the prototype, is not an own
 * property, and is deliberately not charged: measured, `{ ...new C() }` on a
 * class with `get a()` produced `{}` and never called the getter, while the
 * object-literal spelling called it. Charging the class spelling would refuse a
 * program that runs.
 */
function ownEnumerableAccessors(
  type: ts.Type,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly SemanticFunction[] {
  const invoked: SemanticFunction[] = [];
  for (const property of type.getProperties()) {
    for (const declaration of property.declarations ?? []) {
      if (!ts.isGetAccessorDeclaration(declaration)) continue;
      if (!ts.isObjectLiteralExpression(declaration.parent)) continue;
      const accessor = functionByNode.get(declaration);
      if (accessor) invoked.push(accessor);
    }
  }
  return invoked;
}

/**
 * The checked function a tagged template or a `new` invokes.
 *
 * The checker is asked, exactly as `resolveLocalCallee` asks it for a call, so
 * `new Derived()` over a class with no constructor of its own resolves to the
 * BASE constructor it implicitly runs — the implicit-`super()` spelling needs
 * no separate case.
 */
function resolveInvokedDeclaration(
  node: ts.NewExpression | ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): SemanticFunction | undefined {
  const declaration = checker.getResolvedSignature(node)?.declaration;
  return declaration ? functionByNode.get(declaration) : undefined;
}

/** Every decorator a class definition evaluates: its own, its members', and its members' parameters'. */
function classDecorators(declaration: ts.ClassLikeDeclaration): readonly ts.Decorator[] {
  const found: ts.Decorator[] = [];
  const collect = (node: ts.Node): void => {
    for (const modifier of ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []) {
      if (ts.isDecorator(modifier)) found.push(modifier);
    }
    for (const decorator of ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []) {
      found.push(decorator);
    }
  };
  collect(declaration);
  for (const member of declaration.members) {
    collect(member);
    for (const parameter of ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)
      ? member.parameters
      : []) {
      collect(parameter);
    }
  }
  return found;
}

/** The arguments an invocation hands its callee; a tagged template's are its substitutions. */
function invocationArguments(node: InvocationExpression): readonly ts.Expression[] {
  if (ts.isTaggedTemplateExpression(node)) {
    return ts.isTemplateExpression(node.template)
      ? node.template.templateSpans.map((span) => span.expression)
      : [];
  }
  return node.arguments ?? [];
}

/**
 * The internal property name TypeScript gives a well-known-symbol member.
 *
 * `class It { *[Symbol.iterator]() {} }` declares a property whose escaped name
 * is `__@iterator@13` — the trailing id is the symbol declaration's, so
 * `getProperty("__@iterator")` finds nothing and the name has to be matched by
 * prefix. Measured on this tree's vendored TypeScript.
 */
const ITERATOR_MEMBER = "__@iterator";
const ASYNC_ITERATOR_MEMBER = "__@asyncIterator";
const TO_PRIMITIVE_MEMBER = "__@toPrimitive";
const HAS_INSTANCE_MEMBER = "__@hasInstance";

function typeMember(type: ts.Type, name: string): ts.Symbol | undefined {
  const direct = type.getProperty(name);
  if (direct) return direct;
  if (!name.startsWith("__@")) return undefined;
  return type.getProperties().find((property) => property.getName().startsWith(`${name}@`));
}

/**
 * THE ONE TABLE for "which checked function does this MEMBER run?".
 *
 * `typeMember` answers with a symbol, and a symbol's DECLARATION is the function
 * itself in exactly one spelling — the method shorthand `{ valueOf() {} }` and
 * its accessor sibling. Every other way of writing the same member puts a
 * non-function declaration in between, and the old one-hop
 * `functionByNode.get(declaration)` found nothing for all of them:
 * `{ valueOf: () => … }` and `{ valueOf: function () {} }` and
 * `{ ["valueOf"]: () => … }` declare a `PropertyAssignment`, `{ valueOf }` a
 * `ShorthandPropertyAssignment`, `class C { valueOf = () => … }` a
 * `PropertyDeclaration`, and `{ valueOf: impl }` names a function declared
 * somewhere else entirely.
 *
 * They are all the same member and all of them really run. Measured with a
 * runtime oracle over a 120-cell spelling x member matrix — every member
 * recording its own invocation and reading nothing, so the program compiles,
 * RUNS, and prints which member ECMAScript reached — 54 of the 114 measurable
 * cells were fail-open this way, on ALL EIGHT protocol members (`valueOf`,
 * `toString`, `toJSON`, `Symbol.toPrimitive`, `Symbol.iterator`,
 * `Symbol.asyncIterator`, `Symbol.hasInstance`, `then`). Each of the 54 checked
 * `ok: true` with `requirements: []` and panicked at run time with
 * `capability 'Db' was not provided`.
 *
 * So the checker is asked SECOND, exactly as `resolveFunctionReference` already
 * asks it for a callback value and `resolveLocalCallee` for a callee, and for
 * the reason written there: a function value's type carries call signatures and
 * a signature carries the declaration it came from, which "sees through every
 * indirection TypeScript itself sees through". That is the only way this
 * resolver and those two can agree about what one member names — and it is why
 * a new spelling is covered because the checker resolves it, not because
 * someone remembered to list it.
 *
 * The declaration lookup is kept FIRST rather than replaced, because it is the
 * only one that answers for a GETTER: the type of a `get valueOf()` symbol is
 * the getter's RETURN type, so the checker's answer there is the function the
 * getter hands BACK. Both run — `Get(obj, "valueOf")` then `Call` — so both are
 * charged, and the oracle confirms both are reached.
 *
 * Only positions that INVOKE the member may use this. A property READ does not
 * call what it reads (`const m = obj.valueOf` is pinned as a negative), which is
 * why `accessorInvocations` keeps its own, deliberately narrower, getter-only
 * lookup.
 */
function memberInvocations(
  type: ts.Type,
  member: string,
  location: ts.Node,
  checker: ts.TypeChecker,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly SemanticFunction[] {
  const symbol = typeMember(type, member);
  if (!symbol) return [];
  const invoked: SemanticFunction[] = [];
  const add = (declaration: ts.Declaration | undefined): void => {
    const fn = declaration && functionByNode.get(declaration);
    if (fn && !invoked.includes(fn)) invoked.push(fn);
  };
  for (const declaration of symbol.declarations ?? []) add(declaration);
  for (const signature of checker.getTypeOfSymbolAtLocation(symbol, location).getCallSignatures()) {
    add(signature.declaration);
  }
  return invoked;
}

/**
 * The four coercion positions that ask for a STRING; every other asks for a
 * number, or asks with no hint at all, which `ToPrimitive` treats as a number.
 *
 * The default is deliberately "not a string", so a coercion position nobody
 * classified here charges `valueOf` as well and fails CLOSED. Totality over the
 * grammar is `implicitInvocationProtocol`'s job and is not duplicated here —
 * this only refines a position that predicate has already called a coercion.
 */
function coercesWithStringHint(expression: ts.Expression): boolean {
  const parent = expression.parent as ts.Node | undefined;
  if (!parent) return false;
  if (ts.isTemplateSpan(parent)) return true;
  // `{ [E]: v }`, `o[E]` and `E in o` all run ToPropertyKey, which is a string hint.
  if (ts.isComputedPropertyName(parent)) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === expression) return true;
  return ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
    parent.left === expression;
}

const PRIMITIVE_TYPE_FLAGS = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike |
  ts.TypeFlags.BigIntLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.Undefined | ts.TypeFlags.Null;

/** `any`, `unknown`, an object type and a type variable all answer false, which is the closed answer. */
function isPrimitiveReturn(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.every(isPrimitiveReturn);
  return (type.flags & PRIMITIVE_TYPE_FLAGS) !== 0;
}

/**
 * Does `OrdinaryToPrimitive` STOP at this member, or fall through to the next?
 *
 * It stops as soon as one returns a primitive. That is not a detail: it is the
 * whole reason the walk cannot be shortened to "the member the hint prefers".
 * `Object.prototype.valueOf` returns the object ITSELF, so a number hint over an
 * object with no own `valueOf` always falls through and really does run
 * `toString` — measured: `+obj` on a `toString`-only object read the capability
 * and panicked. `Object.prototype.toString` returns a string, so a string hint
 * normally stops there and `valueOf` really is unreachable — but a project may
 * declare `toString(): object`, which TypeScript accepts, and then a string hint
 * falls through into `valueOf` — also measured, also a panic. Asking the
 * DECLARED return type is what keeps both of those right at once.
 */
function coercionStopsAt(
  type: ts.Type,
  member: "valueOf" | "toString",
  location: ts.Node,
  checker: ts.TypeChecker,
): boolean {
  const symbol = typeMember(type, member);
  if (!symbol) return member === "toString";
  const signatures = checker.getTypeOfSymbolAtLocation(symbol, location).getCallSignatures();
  if (signatures.length === 0) return false;
  return signatures.every((signature) => isPrimitiveReturn(signature.getReturnType()));
}

/**
 * The checked project functions an IMPLICIT protocol invocation runs.
 *
 * `[...it]`, `for (const x of it)`, `const [a] = it`, `` `${obj}` ``,
 * `JSON.stringify(obj)`, `await thenable` and `@deco` each CALL a function the
 * program never names, exactly as reading `box.size` calls its getter — and
 * `specification/requirements.mdx` §Inference governs them for the same reason
 * `accessorInvocations` exists: "Requirement inference MUST be transitive
 * through ordinary calls." Without this edge, ten spellings published
 * `requirements: []` for a function that reads a capability, checked `ok: true`
 * on BOTH backends, and panicked at run time with `capability 'Db' was not
 * provided`.
 *
 * Only REQUIREMENTS are charged, the same channel `accessorInvocations`
 * charges, and for the same reason: a protocol method cannot legally carry a
 * failure row here — a Result-returning one is SMITHERS1105 and an
 * inferred-fallible one is SMITHERS1101 — so there is no failure to travel, and
 * inventing one would put a `Result` where the protocol's own contract has
 * none.
 *
 * The lookup is self-limiting: it resolves a member to its DECLARATIONS and
 * keeps only those the project checked, so `for (const x of [1, 2])` and
 * `` `${"s"}` `` find `lib.es*.d.ts` declarations, match nothing, and cost
 * nothing.
 */
function implicitInvocations(
  node: ts.Node,
  checker: ts.TypeChecker,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly SemanticFunction[] {
  const invoked: SemanticFunction[] = [];
  const charge = (expression: ts.Expression | undefined, member: string): void => {
    if (!expression) return;
    // Parentheses and type assertions are stripped for the same reason
    // `checkImplicitForeignInvocation` strips them, in the same words:
    // `(obj as unknown as number) - 1` still runs `obj.valueOf()` at run time,
    // so asking the ASSERTION's type would let an author launder the row with
    // the same `as` the FOREIGN half of this protocol already refuses to
    // follow. `!` is deliberately not stripped: in `.sm` it is the checked
    // propagation boundary and it really does change the value.
    const value = withoutTypeAssertions(expression);
    invoked.push(
      ...memberInvocations(checker.getTypeAtLocation(value), member, value, checker, functionByNode),
    );
  };
  // Every iteration protocol spelling. `for await` reaches `Symbol.asyncIterator`
  // when the value has one and falls back to `Symbol.iterator` when it does not,
  // so both are charged.
  if (ts.isSpreadElement(node)) charge(node.expression, ITERATOR_MEMBER);
  if (ts.isForOfStatement(node)) {
    if (node.awaitModifier) charge(node.expression, ASYNC_ITERATOR_MEMBER);
    charge(node.expression, ITERATOR_MEMBER);
  }
  if (ts.isYieldExpression(node) && node.asteriskToken) charge(node.expression, ITERATOR_MEMBER);
  if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
    ts.isArrayBindingPattern(node.name)) {
    charge(node.initializer, ITERATOR_MEMBER);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isArrayLiteralExpression(node.left)) {
    charge(node.right, ITERATOR_MEMBER);
  }
  // Coercion to a primitive runs `Symbol.toPrimitive`, `valueOf` and `toString`
  // — the three members `IMPLICIT_INVOCATION_PROTOCOLS.coercion` already names —
  // and it runs them in ECMAScript's own order, stopping at the first that
  // yields a primitive. `valueOf` was in that list and had never been charged
  // anywhere, so every NUMBER-hint position published `requirements: []` for a
  // function that reads a capability: `+obj` checked `ok: true` on both backends
  // and panicked with `capability 'Db' was not provided`.
  //
  // The walk is modelled rather than flattened to "charge all three" because
  // flattening REFUSES programs that run: an object whose only capability-reading
  // member is `valueOf`, interpolated as `` `${obj}` ``, prints `[object Object]`
  // and never reads the capability. It is not shortened to "the member the hint
  // prefers" either, because the hint's first choice does not always answer;
  // `coercionStopsAt` carries both measurements.
  const coerce = (expression: ts.Expression | undefined, hint: "string" | "number"): void => {
    if (!expression) return;
    const value = withoutTypeAssertions(expression);
    const type = checker.getTypeAtLocation(value);
    // A value that has `Symbol.toPrimitive` runs THAT and nothing else — the
    // exotic path never consults `valueOf` or `toString` at all.
    if (typeMember(type, TO_PRIMITIVE_MEMBER)) {
      charge(expression, TO_PRIMITIVE_MEMBER);
      return;
    }
    for (const member of hint === "string" ? ["toString", "valueOf"] as const : ["valueOf", "toString"] as const) {
      charge(expression, member);
      if (coercionStopsAt(type, member, value, checker)) return;
    }
  };
  // THE ONE TABLE. `implicitInvocationProtocol` already answers "does this
  // POSITION run an arbitrary method on the value it holds", total over the
  // grammar, for the FOREIGN half of exactly this question — and its doc
  // comment says why it must stay one predicate: "the enumerated-call-site
  // shape is how this class keeps reopening". The authored half kept its own
  // two-entry list (a template span and binary `+`) and so was NOT total: `+`,
  // `-`, `~`, `++`/`--`, every arithmetic, relational, bitwise and compound
  // assignment operator, `==`/`!=`, a computed property key, `o[k]` and
  // `k in o` all published `requirements: []` for a function that reads a
  // capability, checked `ok: true` on BOTH backends, and panicked at run time.
  // Asking the same predicate makes the answer total by construction, and the
  // two halves can no longer disagree about what a coercion position is — the
  // tagged-template carve-out below is the table's, not a second copy of it.
  if (ts.isExpression(node)) {
    const protocol = implicitInvocationProtocol(node);
    if (protocol === "coercion") {
      // `x instanceof E` is in the position table because it INVOKES a member of
      // `E` with no call expression to see — but the member is
      // `Symbol.hasInstance`, not the coercion walk. Running the walk here
      // charged a static `toString` that `instanceof` never calls, which would
      // have refused a program that runs: measured, a class with a
      // capability-reading `static toString()` drew SMITHERS2102 at
      // `x instanceof Foo`. The foreign half needs only "some member runs";
      // the authored half has to name the right one.
      const parent = node.parent as ts.Node | undefined;
      if (parent && ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
        charge(node, HAS_INSTANCE_MEMBER);
      } else {
        coerce(node, coercesWithStringHint(node) ? "string" : "number");
      }
    }
    // `{ ...box }` and `({ ...rest } = box)` run every own enumerable getter,
    // with no property access in the source for `accessorInvocations` to see.
    // Measured: `const copy = { ...box }` where `box`'s getter reads a
    // capability published `requirements: []`, checked `ok: true`, and panicked.
    if (protocol === "enumeration") {
      const value = withoutTypeAssertions(node);
      invoked.push(...ownEnumerableAccessors(checker.getTypeAtLocation(value), functionByNode));
    }
  }
  if (ts.isAwaitExpression(node)) charge(node.expression, "then");
  // Every decorator in a class runs when the CLASS DEFINITION is evaluated, not
  // when the decorated member is called and not when the class is constructed —
  // so they are charged at the class node, in whatever scope the class
  // statement itself sits. Reading them at the `ts.Decorator` node put a method
  // decorator inside the method's own scope, where nothing ever runs it: `@deco`
  // over a capability-reading `deco` published `deco: { requirements: ["Db"] }`
  // and an empty row everywhere else, and the program panicked at import time.
  if (ts.isClassLike(node)) {
    for (const decorator of classDecorators(node)) {
      // A decorator FACTORY (`@deco("x")`) is two invocations: the factory call,
      // which is an ordinary `ts.CallExpression` the call graph already sees,
      // and the function it returns, which no declaration in the program names —
      // that half stays with the returned/stored-closure limitation recorded for
      // every other form.
      if (ts.isCallExpression(decorator.expression)) continue;
      for (const signature of checker.getTypeAtLocation(decorator.expression).getCallSignatures()) {
        const declaration = signature.declaration;
        const fn = declaration && functionByNode.get(declaration);
        if (fn) invoked.push(fn);
      }
    }
  }
  if (ts.isCallExpression(node)) {
    const selection = calleeSelection(node, checker);
    // `JSON.stringify(obj)` runs `obj.toJSON()` when the value declares one and
    // coerces otherwise. `String(x)` is the function spelling of a template
    // substitution. Both roots are matched by ambient identity, the same way
    // `Date["now"]()` and `Reflect.get` are.
    if (selection && selection.name === "stringify" && ts.isIdentifier(selection.receiver) &&
      selection.receiver.text === "JSON" && isAmbientGlobalReference(selection.receiver, checker)) {
      charge(node.arguments[0], "toJSON");
      coerce(node.arguments[0], "string");
    }
    // `String(x)` is the function spelling of a template substitution and
    // `Number(x)` is the function spelling of `+x`; both coerce their argument
    // with no operator in the source for the position table to classify.
    //
    // The callee is read through `withoutParentheses` — the same table
    // `calleeSelection` already uses for the `JSON.stringify` and `Math.*`
    // spellings just above — because `(Number)(obj)` and `(String)(obj)` coerce
    // exactly as the unparenthesised spellings do, measured at run time. The two
    // sibling ambient calls are ONE branch for the same reason: written as two,
    // one of them gets taught what the other knows and the pair silently drifts,
    // which is what happened here — the Go fork skipped parentheses on both and
    // the reference skipped them on neither, so both spellings diverged.
    const ambientCallee = withoutParentheses(node.expression);
    if (ts.isIdentifier(ambientCallee) && isAmbientGlobalReference(ambientCallee, checker)) {
      if (ambientCallee.text === "String") coerce(node.arguments[0], "string");
      if (ambientCallee.text === "Number") coerce(node.arguments[0], "number");
    }
    // Every `Math` method coerces every argument it is handed to a number.
    // `Math.abs(obj)` ran a capability-reading `valueOf` with the enclosing row
    // empty, exactly as `+obj` did.
    if (selection && ts.isIdentifier(selection.receiver) && selection.receiver.text === "Math" &&
      isAmbientGlobalReference(selection.receiver, checker)) {
      for (const argument of node.arguments) coerce(argument, "number");
    }
  }
  return invoked;
}

/**
 * The checked function a function-VALUED expression carries.
 *
 * Symbol identity alone is one hop deep: it answers only when the expression's
 * symbol IS a checked function's declaration symbol, so `hof(fallible)` was
 * caught and `const alias = fallible; hof(alias)` was not. Everything
 * downstream fails OPEN when this declines — no callback is found, so no
 * `Result` contract is required (SMITHERS1303), no async ownership is proven
 * (SMITHERS1404), no requirement is charged, and no `Result.try` boundary row
 * is published. Measured: the SMITHERS1303 canon written through one alias
 * checked clean, ran to exit 0, and the host observed the lifted `Result` as
 * its plain success value `{}` — the `Boom` disappeared. Seven spellings did
 * it (a `const` alias, a reassigned `let`, an object property, an array
 * element, a ternary, `.bind()`, and a destructured property), on both
 * backends.
 *
 * So the checker is asked second, exactly as this function's sibling
 * `resolveLocalCallee` already asks it for a CALLEE: a function value's type
 * carries call signatures, and a signature carries the declaration it came
 * from. That sees through every indirection TypeScript itself sees through,
 * which is the only way the two resolvers can agree on what
 * `const alias = f; alias()` and `hof(alias)` name.
 *
 * A value whose type offers SEVERAL distinct checked declarations (a union of
 * two different local functions, or an overload set) resolves to none of them
 * here — one row cannot stand for two — and the callers that must not accept an
 * unresolved callable say so themselves (`SMITHERS2103` for `Layer.provide`).
 */
function resolveFunctionReference(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): SemanticFunction | undefined {
  if (isSupportedFunctionLike(expression)) return functionByNode.get(expression);
  const symbol = expressionSymbol(expression, checker);
  const direct = symbol && functions.find((candidate) => functionSymbol(candidate.node, checker) === symbol);
  if (direct) return direct;
  const carried = signatureFunctions(expression, checker, functionByNode);
  return carried.length === 1 ? carried[0] : undefined;
}

/**
 * Every checked function this expression's call signatures were declared by.
 *
 * A MUTABLE binding is declined outright rather than read through its type. Two
 * function values with the same shape have the same TYPE, so TypeScript's
 * control-flow narrowing cannot separate them and the binding keeps the type it
 * was initialized with: `let cb = usesLog; cb = usesDb; hof(cb)` reports the
 * type of `usesLog`, which would charge the caller `Log` — a capability the
 * program never reads — while dropping the `Db` it does. A wrong row is worse
 * than no row, and it is the same reason `constantInitializer` reads only
 * `const` and SMITHERS1508 refuses a mutable foreign alias: a reassignment
 * makes the initializer no evidence at all about the value at the use.
 */
function signatureFunctions(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly SemanticFunction[] {
  if (namesMutableBinding(expression, checker)) return [];
  const found = new Set<SemanticFunction>();
  for (const signature of expressionTypeAt(expression, checker).getCallSignatures()) {
    const declaration = signature.declaration;
    const fn = declaration && functionByNode.get(declaration);
    if (fn) found.add(fn);
  }
  return [...found];
}

/** Whether this expression names a `let`/`var` binding, directly or through grouping. */
function namesMutableBinding(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const bare = withoutParentheses(expression);
  if (!ts.isIdentifier(bare)) return false;
  const declarations = unalias(referencedValueSymbol(bare, checker), checker)?.declarations ?? [];
  return declarations.some((declaration) =>
    ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) === 0);
}

function functionSymbol(node: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (node.name) return unalias(checker.getSymbolAtLocation(node.name), checker);
  if (ts.isVariableDeclaration(node.parent)) return unalias(checker.getSymbolAtLocation(node.parent.name), checker);
  return undefined;
}

function expressionSymbol(expression: ts.Expression, checker: ts.TypeChecker): ts.Symbol | undefined {
  const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  // `{ transform }` carries the same function value `{ transform: transform }`
  // does, but `getSymbolAtLocation` on the shorthand's name returns the object
  // literal's PROPERTY symbol, not the local it abbreviates. Without this the
  // two spellings disagreed: the explicit one drew SMITHERS1303 and the
  // shorthand compiled, ran, and returned a `Result` as the callee's plain
  // success value. `referencedValueSymbol` is the ONE place that knows this, so
  // a rule cannot acquire the divergence again by resolving the name itself —
  // which is how SMITHERS1508 and SMITHERS1601 still had it after
  // SMITHERS1303 and SMITHERS1802 were closed.
  if (ts.isIdentifier(location)) {
    const value = unalias(referencedValueSymbol(location, checker), checker);
    if (value) return value;
  }
  return unalias(checker.getSymbolAtLocation(location), checker);
}

function unalias(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!symbol) return undefined;
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * The enclosing expression a value FORWARDS THROUGH unchanged — the PARENT
 * direction of `typeOnlyWrapperOperand`, and the only place it is spelled.
 *
 * `typeOnlyWrapperOperand` is THE ONE TABLE for "what value is this really",
 * asked downward. Three walks asked the same question upward — "where does this
 * value end up" — and each restated the table by hand, so they drifted exactly
 * as the eight operand walks had: `callPropagates` stripped
 * paren/`as`/`<T>`/`await`, `isReturnedOrPropagated` stripped
 * paren/`as`/`await`, and the retired `foreignResultIsUsedAsValue` stripped
 * paren/`as`/`<T>`/`await`. None of the three knew `satisfies`, and the two
 * halves of one rule disagreed about `<T>x`.
 *
 * Measured before this existed, with an inferred-fallible callee that can only
 * produce `Boom` inside `outer(): Result<number, Calm>`:
 * `(inferred("bad") satisfies unknown)!` published `failures: ["Calm"]` and
 * reported NO SMITHERS1104 at all, while the byte-adjacent
 * `(inferred("bad") as unknown as number)!` reported it — the contract-omission
 * refusal fell through to an unmapped stock-TypeScript TS2322 over the emitted
 * module. `satisfies` is the purest laundering wrapper there is; it does not
 * even change the expression's type, so nothing downstream can notice it.
 *
 * Asking `typeOnlyWrapperOperand(parent) === current` is what makes the two
 * directions the SAME table rather than two tables that agree today. `await` is
 * added by this helper rather than by the shared table for the reason the table
 * itself records: it removes a Promise layer, which is a real change of value,
 * so it belongs to the callers that should walk it — and all three of these do,
 * because `await make()!` is the propagation spelling for an async producer.
 */
function forwardingParent(current: ts.Node): ts.Node | undefined {
  const parent = current.parent;
  if (!parent) return undefined;
  if (ts.isAwaitExpression(parent) && parent.expression === current) return parent;
  return ts.isExpression(parent) && typeOnlyWrapperOperand(parent) === current ? parent : undefined;
}

/**
 * Does this value leave the function, either by `return` or through the postfix
 * propagation boundary?
 *
 * One walk, where there were two. `callPropagates` and `isReturnedOrPropagated`
 * asked this same question with different wrapper sets and the first fell back
 * to the second, so the answer was the union of two drifting tables rather than
 * one table.
 */
function isReturnedOrPropagated(node: ts.Node): boolean {
  let current: ts.Node = node;
  for (;;) {
    const forwarded = forwardingParent(current);
    if (forwarded) {
      current = forwarded;
      continue;
    }
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isReturnStatement(parent)) return true;
    return ts.isNonNullExpression(parent) && parent.expression === current;
  }
}

function inferRows(
  functions: readonly SemanticFunction[],
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): void {
  for (const fn of functions) {
    for (const failure of fn.directFailures) fn.bodyFailures.add(failure);
    for (const requirement of fn.directRequirements) fn.requirements.add(requirement);
    for (const requirement of fn.directCapabilityRequirements) fn.capabilityRequirements.add(requirement);
  }
  /**
   * Propagate one requirement row into `fn`, keeping the capability half in
   * step with it.
   *
   * ONE helper rather than a second loop beside each of the six edges below,
   * because the two sets have to travel the SAME edges with the SAME
   * subtraction. A `Layer.provide` that supplies `Db` removes `Db` from both,
   * and a second pass that forgot the subtraction would leave a function
   * resumable after its capabilities were provided — which is exactly the
   * `main` case that must stay an ordinary function so a test, a CLI, or the
   * conformance harness can call it and get a value.
   */
  const propagate = (
    fn: SemanticFunction,
    source: SemanticFunction,
    names: Iterable<string>,
    provided?: ReadonlySet<string>,
  ): boolean => {
    let moved = false;
    for (const name of names) {
      if (provided?.has(name)) continue;
      moved = add(fn.requirements, name) || moved;
      if (source.capabilityRequirements.has(name)) {
        moved = add(fn.capabilityRequirements, name) || moved;
      }
    }
    return moved;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      for (const call of fn.calls) {
        if (!call.callee) continue;
        if (call.propagatesFailure) {
          // A polymorphic callee contributes its site-instantiated row, never
          // its template, so two call sites cannot merge each other's rows.
          for (const failure of call.instantiatedFailures ?? call.callee.failures) {
            changed = add(fn.bodyFailures, failure) || changed;
          }
        }
        changed = propagate(fn, call.callee, call.callee.requirements) || changed;
      }
      // Reading or writing a property backed by an accessor CALLS it, so its
      // requirements are transitive exactly as an ordinary call's are
      // (`specification/requirements.mdx` §Inference). See accessorInvocations
      // for why the accessor's failure row is not charged here.
      for (const accessor of fn.accessorUses) {
        changed = propagate(fn, accessor, accessor.requirements) || changed;
      }
      // `.expect(...)` consumes a Result but converts its error variant into a
      // panic; that distinguished channel must stay visible on the caller.
      for (const expectCall of fn.expectCalls) {
        const receiver = (expectCall.expression as ts.PropertyAccessExpression).expression;
        if (semanticExpressionShape(receiver, checker, callEdges).channel.startsWith("result")) {
          changed = add(fn.bodyFailures, COMPILER_PANIC_ROW_NAME) || changed;
        }
      }
      // An authored Result.try/tryPromise boundary owns its callback's throw
      // scope but still executes the callback's capability requirements.
      for (const callback of fn.boundaryCallbacks) {
        changed = propagate(fn, callback, callback.requirements) || changed;
      }
      // A callback handed across a call boundary is invoked inside that call,
      // so its capabilities are this body's capabilities. See
      // `SemanticFunction.callbackValues`.
      for (const callback of fn.callbackValues) {
        changed = propagate(fn, callback, callback.requirements) || changed;
      }
      for (const provide of fn.provides) {
        const callback = provide.callback ?? provide.callbackReference;
        if (!callback) continue;
        changed = propagate(fn, callback, callback.requirements, provide.provided) || changed;
      }
      // Propagated and returned expressions are charged HERE rather than during
      // collection, because their channel is `effectiveChannel(callee)` — a
      // quantity this loop is still computing. See
      // `SemanticFunction.channelSites`.
      for (const site of fn.channelSites) {
        const shape = semanticExpressionShape(site.expression, checker, callEdges);
        if (!shape.channel.startsWith("result")) continue;
        if (site.nonNull && !fn.hasResultPropagation) {
          fn.hasResultPropagation = true;
          changed = true;
        }
        for (const failure of shape.failures) changed = add(fn.bodyFailures, failure) || changed;
      }
      const contract = fn.explicitReturn && fn.declaredShape.channel.startsWith("result");
      const target = contract ? fn.declaredShape.failures : fn.bodyFailures;
      for (const failure of target) changed = add(fn.failures, failure) || changed;
    }
  }
}

function checkFunctionContracts(
  functions: readonly SemanticFunction[],
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  for (const fn of functions) {
    const isResult = fn.declaredShape.channel.startsWith("result");
    const hasFailures = fn.bodyFailures.size > 0;
    if (fn.explicitReturn && !isResult && hasFailures) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1101", `explicit return type cannot represent recoverable failures ${formatSet(fn.bodyFailures)}; use Result<A, E>${fn.async ? " inside Promise" : ""}`));
    }
    if (fn.explicitReturn && isResult) {
      const extra = difference(fn.bodyFailures, fn.declaredShape.failures);
      if (extra.size > 0) {
        diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1104", `Result contract omits reachable failures ${formatSet(extra)}`));
      }
    }
    if (fn.exported && hasFailures && !fn.explicitReturn) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1102", "exported fallible functions must spell Result<A, E> (or Promise<Result<A, E>>) in their public contract"));
    }
    if ((ts.isConstructorDeclaration(fn.node) || ts.isGetAccessorDeclaration(fn.node) || ts.isSetAccessorDeclaration(fn.node)) && hasFailures) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1105", "constructors and accessors cannot carry a Result channel in this POC; move the fallible work into an ordinary method"));
    }
    if (fn.node.asteriskToken && hasFailures) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1106", "fallible generators are deferred until generator/Result control-flow semantics are specified"));
    }
    if (fn.hasResultPropagation && !isResult && fn.bodyFailures.size === 0) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1202", "postfix ! propagation requires an enclosing Result-returning function"));
    }
    // A row that names one of this declaration's own type parameters is a
    // template. Templates are only instantiable through a spelled `Result`
    // contract, so a leaked row variable without one fails closed here rather
    // than serializing a type-parameter name as a nominal row member.
    if (fn.node.typeParameters?.length && !genericRowTemplate(fn, checker)) {
      const leaked = fn.node.typeParameters
        .map((parameter) => parameter.name.text)
        .filter((name) => fn.bodyFailures.has(name))
        .sort(compareText);
      if (leaked.length > 0) {
        diagnostics.push(at(
          fn.node,
          fn.node.getSourceFile(),
          "SMITHERS1803",
          `the failure row of generic '${fn.name}' depends on its type parameter${leaked.length > 1 ? "s" : ""} ${
            leaked.join(" | ")
          } but no Result contract spells that row; declare Result<A, ${leaked.join(" | ")}> so each call site can instantiate it`,
        ));
      }
    }
    checkNestedChannels(fn, checker, diagnostics);
  }
}

function checkNestedChannels(fn: SemanticFunction, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  if (!fn.node.type) return;
  const text = checker.typeToString(checker.getTypeFromTypeNode(fn.node.type));
  if (/Result<\s*Result</.test(text)) {
    diagnostics.push(at(fn.node.type, fn.node.getSourceFile(), "SMITHERS1203", "nested Result normalization is not specified; make the conversion explicit"));
  }
}

export function effectiveChannel(fn: SemanticFunction): FunctionChannel {
  if (fn.declaredShape.channel !== "plain") return fn.declaredShape.channel;
  return fn.failures.size > 0 ? "result" : "plain";
}

function add(set: Set<string>, value: string): boolean {
  const before = set.size;
  set.add(value);
  return set.size !== before;
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set([...left].filter((value) => !right.has(value)));
}

function formatSet(values: ReadonlySet<string>): string {
  return [...values].sort().join(" | ") || "never";
}

function foreignPolicy(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  diagnostics: PendingDiagnostic[],
): ForeignPolicy | undefined {
  const signature = checker.getResolvedSignature(call);
  const declaration = signature?.declaration;
  const origin = foreignValueOrigin(call.expression, checker);
  if (!origin) return undefined;

  const resultType = signature ? checker.getReturnTypeOfSignature(signature) : checker.getTypeAtLocation(call);
  const async = Boolean(promisedType(resultType, checker));
  // The claim is READ first and REPORTED after SMITHERS1507, so that the
  // order-safety diagnostic keeps its established position in the pending list.
  const held: PendingDiagnostic[] = [];
  const annotation = foreignThrowsAnnotation(
    declaration,
    carriesRejectionChannel(resultType, checker),
    call,
    sourceFile,
    checker,
    held,
  );
  const stableCallee = isStableForeignCallee(call.expression, checker);
  // Two conditions, both about PROVENANCE. The third — "the checked result of
  // this call is used as a value here" — was about PLACEMENT: it existed because
  // a `Result.try(...)` wrapper had to be hoisted in front of the statement, and
  // the wrapper is an expression that stays where it was written. It is retired
  // with `SMITHERS1204`; see `DECISIONS.md` §Typed failures.
  const lowerable = stableCallee && !origin.uncheckedResult;
  if (!lowerable) {
    diagnostics.push(at(
      call,
      sourceFile,
      "SMITHERS1507",
      "this foreign callee is not a stable reference the compiler can read once, or its result is already an unchecked foreign value; bind the callee to a const and propagate the checked result with postfix !, or continue through an explicitly typed local adapter",
    ));
  }
  for (const pending of held) diagnostics.push(pending);

  if (!annotation) return { kind: "panic", async, lowerable };
  if (annotation === "never") return { kind: "never", async, lowerable };
  if (!/^[A-Za-z_$][\w$]*$/.test(annotation)) {
    diagnostics.push(at(call, sourceFile, "SMITHERS1502", `foreign @throws {${annotation}} is not reifiable in this POC; use one imported Error class constructor`));
    return { kind: "panic", async, lowerable };
  }
  const errorValuePath = foreignErrorValuePath(annotation, declaration, call, checker);
  if (!errorValuePath) {
    diagnostics.push(at(
      call,
      sourceFile,
      "SMITHERS1502",
      `foreign @throws {${annotation}} has no checker-matching Error constructor value in scope; import that Error class (named, aliased, or through a namespace) or provide an adapter`,
    ));
    return { kind: "panic", async, lowerable };
  }
  return { kind: "declared", errorName: annotation, errorValuePath, async, lowerable };
}

function isStableForeignCallee(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  // A type-level wrapper does not make a callee any less stable: it is erased
  // and the same binding is read once at the same point. The table is shared;
  // see `typeOnlyWrapperOperand`.
  const unwrapped = typeOnlyWrapperOperand(expression);
  if (unwrapped) return isStableForeignCallee(unwrapped, checker);
  // A postfix propagation boundary turns a checked foreign Result back into
  // its callable success value. The operator is recognized from its AST kind;
  // there is no member spelling whose text could be forged or shadowed.
  if (ts.isNonNullExpression(expression)) return true;
  if (ts.isIdentifier(expression)) return true;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return isStableForeignCallee(expression.expression, checker);
  }
  return false;
}

/**
 * The ambient `Reflect.panic` member, as the panic intrinsic is spelled without
 * an import. A `Reflect` declared in the file under analysis is the author's
 * own object and resolves to itself.
 */
function isAmbientReflectPanic(
  selection: MemberSelection,
  origin: ts.SourceFile,
  checker: ts.TypeChecker,
): boolean {
  if (!ts.isIdentifier(selection.receiver) || selection.receiver.text !== "Reflect" ||
    selection.name !== "panic") return false;
  const declarations = checker.getSymbolAtLocation(selection.receiver)?.declarations ?? [];
  return declarations.length > 0 &&
    !declarations.some((declaration) => declaration.getSourceFile() === origin) &&
    declarations.some((declaration) =>
      isCompilerPrelude(declaration.getSourceFile()) || isTypeScriptLibrary(declaration.getSourceFile()));
}

/** The imported `panic` intrinsic, named by an identifier. */
function isImportedPanicIntrinsic(reference: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(reference)) return false;
  const symbol = unalias(checker.getSymbolAtLocation(reference), checker);
  return symbol?.getName() === "panic" && Boolean(symbol.declarations?.some((declaration) =>
    isCompilerPrelude(declaration.getSourceFile())));
}

function isPanicCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call, checker);
  if (selection) return isAmbientReflectPanic(selection, call.getSourceFile(), checker);
  return isImportedPanicIntrinsic(call.expression, checker);
}

/**
 * Whether an expression in a TEMPLATE TAG position denotes the panic intrinsic.
 *
 * The two leaf tests are `isPanicCall`'s own, so the tag spelling and the call
 * spelling recognize the same intrinsic. What is added around them is the walk
 * that a tag position needs and a callee position does not: `panic` reached
 * through a type-only wrapper or a `const` value alias still IS `panic` at run
 * time, and every such spelling degrades identically (§ below), so a recognizer
 * that missed one would leave that spelling silently broken. The wrapper table
 * is `typeOnlyWrapperOperand` — THE ONE TABLE — and the binding step is
 * `constantInitializer`, the same `const`-only step `contextReceiver` uses and
 * for the same reason: a reassigned `let` is no evidence about the value here.
 */
function isPanicTemplateTag(tag: ts.Expression, checker: ts.TypeChecker, depth = 0): boolean {
  if (depth > 16) return false;
  const unwrapped = typeOnlyWrapperOperand(tag);
  if (unwrapped) return isPanicTemplateTag(unwrapped, checker, depth + 1);
  const selection = memberSelection(tag, checker);
  if (selection) return isAmbientReflectPanic(selection, tag.getSourceFile(), checker);
  if (isImportedPanicIntrinsic(tag, checker)) return true;
  if (!ts.isIdentifier(tag)) return false;
  const initializer = constantInitializer(tag, checker);
  return initializer ? isPanicTemplateTag(initializer, checker, depth + 1) : false;
}

const PANIC_TEMPLATE_TAG_MESSAGE =
  "panic(...) is a call, not a template tag; a tagged `panic` receives the template parts as an array, " +
  "so the authored text becomes the panic's cause and the message degrades to the generic 'Smithers panic'. " +
  "Write panic(`...`) instead";

/**
 * Refuse the panic intrinsic written as a TEMPLATE TAG.
 *
 * `specification/failures.mdx` writes the intrinsic as `panic(...)` and writes
 * no tagged-template spelling, and the language's own runtime confirms why: the
 * tag form hands `makePanic` a `TemplateStringsArray`, which is not a string,
 * so the authored text is demoted into `cause` and the message becomes the
 * generic "Smithers panic". Measured before this rule, on both backends:
 * ``panic`authored message` `` checked clean and aborted with
 * `Panic: Smithers panic` and `[cause]: [ 'authored message' ]`, while
 * `panic("authored message")` aborted with `Panic: authored message`.
 *
 * The code is `SMITHERS1503` — the diagnostic that already answers "this is the
 * panic operation, in a spelling the lowering does not support" — reported at
 * the whole tagged expression, exactly where the call form is reported. Minting
 * a code for the second member of a family that already has one is how a
 * catalogue stops being an index.
 *
 * The shape is the one `SMITHERS1604` settled this round on the `crypto`
 * precedent: refuse the OPERATION, leave the NAME resolvable. `panic` stays
 * importable, callable, and assignable — `const p = panic; p("x")` still
 * compiles and still aborts with its authored message — and only the tag
 * position is refused. This reading is deliberately the conservative and
 * reversible one: the specification is silent, and a refusal can be relaxed
 * into an acceptance by a later decision, where a degraded acceptance already
 * shipped cannot be taken back from programs relying on it.
 */
function checkPanicSpellings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && isPanicTemplateTag(node.tag, checker)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1503", PANIC_TEMPLATE_TAG_MESSAGE));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function isPanicExitCall(call: ts.CallExpression, model: SemanticModel): boolean {
  return Boolean(model.callEdges.get(call)?.panicExit);
}

function isSimplePanicExit(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return ts.isExpressionStatement(current.parent) || ts.isReturnStatement(current.parent) ||
    (ts.isArrowFunction(current.parent) && current.parent.body === current);
}

/**
 * What ONE declaration claims about its throw channel.
 *
 * `contradiction` is populated when a single declaration carries more than one
 * distinct `@throws` claim. Such a declaration makes no usable claim at all, so
 * `annotation` is left undefined and the boundary falls back to the panic case.
 */
interface ThrowsClaim {
  readonly annotation: string | undefined;
  readonly tag: ts.JSDocTag | undefined;
  readonly contradiction: readonly string[] | undefined;
}

const NO_THROWS_CLAIM: ThrowsClaim = { annotation: undefined, tag: undefined, contradiction: undefined };

function readThrowsAnnotation(
  declaration: ts.Node | undefined,
  checker: ts.TypeChecker,
): string | undefined {
  return readThrowsClaim(declaration, checker).annotation;
}

function throwsTagsOf(declaration: ts.Node): readonly ts.JSDocTag[] {
  return ts.getJSDocTags(declaration).filter((tag) =>
    tag.tagName.text === "throws" && !isModuleInitializationTag(tag));
}

/**
 * A trust claim belongs to the SIGNATURE the call resolved to, never to the
 * symbol as a whole.
 *
 * Overload signatures are separate declarations of one symbol, so a
 * `symbol.declarations.flatMap(getJSDocTags).find(throws)` search answers "does
 * ANY spelling of this name carry a marker", which is not a question any rule
 * here asks. `specification/compatibility.mdx` §Foreign Boundary attaches the
 * opt-out to the thing being called — "Trusted `@throws {never}` metadata opts
 * out; `@throws {T}` declares a more precise channel" — and TypeScript's own
 * JSDoc surfacing agrees: hovering an overloaded call shows the resolved
 * overload's comment, not a union of every overload's. A search across the
 * symbol lets ONE marked overload certify every other overload of the same
 * name, including the unmarked, throwing one a call actually resolves to.
 * The callers therefore hand this function `checker.getResolvedSignature(...)
 * .declaration`, and the only fallback kept is the degenerate one that cannot
 * confuse two signatures: a symbol with exactly one declaration.
 *
 * Two `@throws` tags on ONE declaration are a contradiction, not a list to pick
 * the head of. `{never}` followed by `{TypeError}` said "cannot throw" and then
 * named a channel; taking the first tag trusted the binding AND dropped the
 * declared channel, while the identical pair in the opposite order refused it.
 * The same two claims must not give opposite verdicts, and only one of those
 * orders failed closed, so a declaration that makes more than one distinct
 * claim now makes none and is reported at the boundary that reads it.
 */
function readThrowsClaim(declaration: ts.Node | undefined, checker: ts.TypeChecker): ThrowsClaim {
  if (!declaration) return NO_THROWS_CLAIM;
  const direct = throwsTagsOf(declaration);
  if (direct.length > 0) return claimOfTags(direct);
  const name = "name" in declaration ? (declaration as ts.NamedDeclaration).name : undefined;
  const symbol = name ? checker.getSymbolAtLocation(name) : undefined;
  const declarations = symbol?.declarations ?? [];
  const only = declarations.length === 1 ? declarations[0] : undefined;
  return only && only !== declaration ? claimOfTags(throwsTagsOf(only)) : NO_THROWS_CLAIM;
}

function claimOfTags(tags: readonly ts.JSDocTag[]): ThrowsClaim {
  if (tags.length === 0) return NO_THROWS_CLAIM;
  const texts = tags.map((tag) => jsDocThrowsText(tag) ?? "");
  const distinct = [...new Set(texts)];
  if (distinct.length > 1) return { annotation: undefined, tag: undefined, contradiction: distinct };
  return { annotation: jsDocThrowsText(tags[0]), tag: tags[0], contradiction: undefined };
}

function isModuleInitializationTag(tag: ts.JSDocTag): boolean {
  // `@module` disambiguates the file-initialization trust claim from a
  // function-level `@throws` tag when the first statement is callable.
  //
  // Exact case, and the same spelling `hasLeadingModuleNoThrowMarker` accepts —
  // literally the same pattern object, so the two cannot drift. This guard's
  // whole job is to recognize the comment that rule treats as a module header,
  // so the two must agree byte for byte: a comment that is a module claim for
  // one rule and an ordinary function doc for the other is the incoherence, not
  // a safety margin. `@MODULE` is not a module header, so a `@throws {never}`
  // beside it is the author's own function-level claim.
  return MODULE_MARKER.test(tag.parent.getText());
}

function jsDocThrowsText(tag: ts.JSDocTag | undefined): string | undefined {
  if (!tag) return undefined;
  const typeExpression = (tag as ts.JSDocThrowsTag).typeExpression?.type;
  if (typeExpression) return typeExpression.getText().trim();
  const comment = typeof tag.comment === "string" ? tag.comment : undefined;
  const braced = comment?.match(/^\s*\{([^}]+)\}/);
  return braced?.[1]?.trim();
}

/**
 * Does this type carry a DEFERRED failure channel — a rejection?
 *
 * Separate from `promisedType`, deliberately. `promisedType` drives lowering
 * (`Result.try` versus `Result.tryPromise`) and its answer is part of the
 * emitted program; this predicate only decides whether a `@throws {never}` claim
 * can be honoured, so it may be strictly wider without moving a single emitted
 * byte. Wider in two ways the narrow one misses, both of which were fail-open:
 * a UNION with a `Promise` constituent (`string | Promise<string>`), and a
 * structural THENABLE that is never named `Promise` at all. Both reject, and a
 * marker about the call cannot describe either.
 */
function carriesRejectionChannel(type: ts.Type, checker: ts.TypeChecker): boolean {
  for (const part of typeConstituents(type)) {
    if (promisedType(part, checker)) return true;
    const then = part.getProperty("then");
    if (!then) continue;
    const thenType = checker.getTypeOfSymbol(then);
    if (thenType.getCallSignatures().length > 0) return true;
  }
  return false;
}

function foreignErrorValuePath(
  annotation: string,
  declaration: ts.Node | undefined,
  location: ts.Node,
  checker: ts.TypeChecker,
): readonly string[] | undefined {
  const tag = readThrowsClaim(declaration, checker).tag;
  const typeNode = (tag as ts.JSDocThrowsTag | undefined)?.typeExpression?.type;
  const annotationType = typeNode ? checker.getTypeAtLocation(typeNode) : undefined;
  const expected = annotationType
    ? unalias(annotationType.aliasSymbol ?? annotationType.getSymbol(), checker)
    : undefined;
  const sourceFile = location.getSourceFile();

  const matches = (node: ts.Identifier): boolean => {
    const symbol = checker.getSymbolAtLocation(node);
    const resolved = unalias(symbol, checker);
    if (expected && resolved !== expected) return false;
    const valueType = checker.getTypeAtLocation(node);
    return valueType.getConstructSignatures().some((signature) =>
      isErrorType(checker.getReturnTypeOfSignature(signature), checker));
  };

  const exact = checker.resolveName(annotation, location, ts.SymbolFlags.Value, false);
  if (exact) {
    const resolved = unalias(exact, checker);
    const valueType = checker.getTypeOfSymbolAtLocation(exact, location);
    if ((!expected || resolved === expected) && valueType.getConstructSignatures().some((signature) =>
      isErrorType(checker.getReturnTypeOfSignature(signature), checker))) return [annotation];
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    if (statement.importClause.name && matches(statement.importClause.name)) return [statement.importClause.name.text];
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if (matches(specifier.name)) return [specifier.name.text];
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      const moduleSymbol = unalias(checker.getSymbolAtLocation(bindings.name), checker);
      if (!moduleSymbol) continue;
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const resolved = unalias(exported, checker);
        if (expected ? resolved !== expected : exported.getName() !== annotation) continue;
        const name = exported.getName();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) return [bindings.name.text, name];
      }
    }
  }
  return undefined;
}

function addForeignFailures(target: Set<string>, policy: ForeignPolicy): void {
  if (policy.kind === "panic") target.add(COMPILER_PANIC_ROW_NAME);
  if (policy.kind === "declared" && policy.errorName) {
    target.add(policy.errorName);
    target.add(COMPILER_PANIC_ROW_NAME);
  }
}

function importedModuleOfExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): string | undefined {
  return foreignValueOrigin(expression, checker, seen)?.moduleName;
}

interface ForeignValueOrigin {
  readonly moduleName: string;
  /** ESM namespace reads are safe live-binding selection, not user accessors. */
  readonly namespaceObject: boolean;
  /** The value is the success of a call that will lower to Result and has not been propagated. */
  readonly uncheckedResult: boolean;
}

function foreignValueOrigin(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seenSymbols = new Set<ts.Symbol>(),
): ForeignValueOrigin | undefined {
  // A wrapper that changes only the type cannot change where the value came
  // from. The table is shared with every other value walk; see
  // `typeOnlyWrapperOperand` for why they may not keep separate copies of it.
  const unwrapped = typeOnlyWrapperOperand(expression);
  if (unwrapped) return foreignValueOrigin(unwrapped, checker, seenSymbols);
  // `await` is not in that table because it removes a Promise layer, which is a
  // real change of value; it is walked here because the awaited value still
  // came from wherever the promise did.
  if (ts.isAwaitExpression(expression)) {
    return foreignValueOrigin(expression.expression, checker, seenSymbols);
  }
  if (ts.isNonNullExpression(expression)) {
    const origin = foreignValueOrigin(expression.expression, checker, seenSymbols);
    return origin && { ...origin, namespaceObject: false, uncheckedResult: false };
  }

  if (ts.isIdentifier(expression)) {
    const alias = referencedValueSymbol(expression, checker);
    const imported = importOrigin(alias, checker);
    if (imported) return imported;

    const symbol = unalias(alias, checker);
    if (!symbol || seenSymbols.has(symbol)) return undefined;
    seenSymbols.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find((candidate) =>
      ts.isVariableDeclaration(candidate) || ts.isBindingElement(candidate));
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return foreignValueOrigin(declaration.initializer, checker, seenSymbols);
    }
    if (declaration && ts.isBindingElement(declaration)) {
      return bindingElementOrigin(declaration, checker, seenSymbols);
    }
    return undefined;
  }

  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const receiver = foreignValueOrigin(expression.expression, checker, new Set(seenSymbols));
    if (receiver) return { ...receiver, namespaceObject: false };

    const symbolLocation = ts.isPropertyAccessExpression(expression)
      ? expression.name
      : expression.argumentExpression;
    const symbol = unalias(symbolLocation ? checker.getSymbolAtLocation(symbolLocation) : undefined, checker);
    if (symbol && !seenSymbols.has(symbol)) {
      seenSymbols.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isPropertyAssignment(declaration)) {
          const origin = foreignValueOrigin(declaration.initializer, checker, new Set(seenSymbols));
          if (origin) return origin;
        }
        if (ts.isShorthandPropertyAssignment(declaration)) {
          const value = checker.getShorthandAssignmentValueSymbol(declaration);
          const origin = originOfSymbolValue(value, checker, new Set(seenSymbols));
          if (origin) return origin;
        }
        if (ts.isPropertyDeclaration(declaration) && declaration.initializer) {
          const origin = foreignValueOrigin(declaration.initializer, checker, new Set(seenSymbols));
          if (origin) return origin;
        }
      }
    }
    return storedElementOrigin(expression, checker, seenSymbols);
  }

  if (ts.isCallExpression(expression)) {
    const origin = foreignValueOrigin(expression.expression, checker, seenSymbols);
    if (!origin) return undefined;
    const annotation = readThrowsAnnotation(checker.getResolvedSignature(expression)?.declaration, checker);
    return { moduleName: origin.moduleName, namespaceObject: false, uncheckedResult: annotation !== "never" };
  }
  if (ts.isNewExpression(expression)) {
    const origin = foreignValueOrigin(expression.expression, checker, seenSymbols);
    return origin && { moduleName: origin.moduleName, namespaceObject: false, uncheckedResult: false };
  }
  // A selecting operator carries the provenance of the operand it yields, and
  // which operand that is is not decidable here — so every operand that can be
  // the value is folded in, which is the fail-closed direction. This is the
  // shared table `contextReceiver` uses; see `valueBranches` for why the two
  // walks may not keep separate copies of it.
  const branches = valueBranches(expression);
  if (branches) {
    let folded: ForeignValueOrigin | undefined;
    for (const branch of branches) {
      const origin = foreignValueOrigin(branch, checker, new Set(seenSymbols));
      if (!origin) continue;
      folded = folded === undefined ? origin : {
        moduleName: folded.moduleName,
        namespaceObject: folded.namespaceObject && origin.namespaceObject,
        uncheckedResult: folded.uncheckedResult || origin.uncheckedResult,
      };
    }
    return folded;
  }
  return undefined;
}

function importOrigin(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ForeignValueOrigin | undefined {
  if (!symbol) return undefined;
  const resolved = unalias(symbol, checker);
  if (resolved?.declarations?.some((declaration) => {
    const file = declaration.getSourceFile();
    return file.fileName.endsWith(".sm.ts") || isTrustedCompilerGeneratedRuntime(file);
  })) {
    return undefined;
  }
  for (const declaration of symbol.declarations ?? []) {
    let importDeclaration: ts.ImportDeclaration | undefined;
    let namespaceObject = false;
    if (ts.isImportSpecifier(declaration) && ts.isImportDeclaration(declaration.parent.parent.parent)) {
      importDeclaration = declaration.parent.parent.parent;
    } else if (ts.isNamespaceImport(declaration) && ts.isImportDeclaration(declaration.parent.parent)) {
      importDeclaration = declaration.parent.parent;
      namespaceObject = true;
    } else if (ts.isImportClause(declaration) && ts.isImportDeclaration(declaration.parent)) {
      importDeclaration = declaration.parent;
    }
    if (importDeclaration && ts.isStringLiteral(importDeclaration.moduleSpecifier)) {
      const moduleName = importDeclaration.moduleSpecifier.text;
      // Only exact compiler intrinsics are trusted; an npm package that merely
      // starts with the letters "smithers" (e.g. `smithersutils`) is foreign.
      if (!isCompilerIntrinsicSpecifier(moduleName)) return { moduleName, namespaceObject, uncheckedResult: false };
    }
  }
  return undefined;
}

function originOfSymbolValue(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
  seenSymbols: Set<ts.Symbol>,
): ForeignValueOrigin | undefined {
  if (!symbol) return undefined;
  const imported = importOrigin(symbol, checker);
  if (imported) return imported;
  const resolved = unalias(symbol, checker);
  if (!resolved || seenSymbols.has(resolved)) return undefined;
  seenSymbols.add(resolved);
  const declaration = resolved.valueDeclaration ?? resolved.declarations?.find(ts.isVariableDeclaration);
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
    ? foreignValueOrigin(declaration.initializer, checker, seenSymbols)
    : undefined;
}

function bindingElementOrigin(
  binding: ts.BindingElement,
  checker: ts.TypeChecker,
  seenSymbols: Set<ts.Symbol>,
): ForeignValueOrigin | undefined {
  const pattern = binding.parent;
  const declaration = pattern.parent;
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined;
  if (ts.isObjectBindingPattern(pattern)) {
    const key = binding.propertyName ?? binding.name;
    if (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key)) {
      const selected = objectLiteralMember(declaration.initializer, key.text, checker);
      if (selected) return foreignValueOrigin(selected, checker, seenSymbols);
    }
  }
  // Destructuring a genuinely foreign receiver invokes foreign property access;
  // the boundary pass rejects it, but retaining provenance prevents later calls
  // through the bound value from becoming invisible.
  return foreignValueOrigin(declaration.initializer, checker, seenSymbols);
}

function storedElementOrigin(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  checker: ts.TypeChecker,
  seenSymbols: Set<ts.Symbol>,
): ForeignValueOrigin | undefined {
  const key = ts.isPropertyAccessExpression(access)
    ? access.name.text
    : access.argumentExpression && (ts.isStringLiteral(access.argumentExpression) || ts.isNumericLiteral(access.argumentExpression))
      ? access.argumentExpression.text
      : undefined;
  if (key === undefined) return undefined;
  const selected = objectLiteralMember(access.expression, key, checker);
  return selected ? foreignValueOrigin(selected, checker, seenSymbols) : undefined;
}

function objectLiteralMember(
  expression: ts.Expression,
  key: string,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): ts.Expression | undefined {
  // Type-level wrappers (the shared table) plus `!`: `({ p: v } satisfies T).p`
  // and `({ p: v } as T)!.p` both select the same literal member.
  const unwrapped = typeOnlyWrapperOperand(expression);
  if (unwrapped) return objectLiteralMember(unwrapped, key, checker, seen);
  if (ts.isNonNullExpression(expression)) {
    return objectLiteralMember(expression.expression, key, checker, seen);
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    if (!symbol || seen.has(symbol)) return undefined;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return objectLiteralMember(declaration.initializer, key, checker, seen);
    }
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))
        ? property.name.text
        : undefined;
      if (name !== key) continue;
      if (ts.isPropertyAssignment(property)) return property.initializer;
      if (ts.isShorthandPropertyAssignment(property)) return property.name;
    }
  }
  if (ts.isArrayLiteralExpression(expression) && /^\d+$/.test(key)) return expression.elements[Number(key)];
  return undefined;
}

function isCompilerPrelude(file: ts.SourceFile): boolean {
  return file.fileName.endsWith(PRELUDE_NAME);
}

function isTypeScriptLibrary(file: ts.SourceFile): boolean {
  return file.hasNoDefaultLib || /[\\/]typescript[^/\\]*[\\/]lib[\\/]lib\.[^/\\]+\.d\.ts$/.test(file.fileName);
}

/**
 * Whether this identifier only NAMES something, so it reads no value.
 *
 * The ES2015 shorthand property is the one form that does both with one token:
 * `{ process }` is the `name` of its `ShorthandPropertyAssignment` *and* a
 * reference to `process`. Treating it as a declaration name skips the very
 * check the reference needs, so `Object.freeze({ process })` slipped past
 * `SMITHERS1601` while `Object.freeze({ process: process })` was refused — and
 * the value read back out of it (`ns.process.platform`) worked.
 * `ambientAuthorityUses` already carved the shorthand back out for the
 * `Date`/`Math`/`performance`/`crypto` rule; the carve-out belongs here, where
 * both callers get it and neither can drift from the other.
 */
function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  return ("name" in parent && (parent as ts.NamedDeclaration).name === node) ||
    ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent);
}

/**
 * The symbol an identifier READS, which is not always the symbol it resolves to.
 *
 * The name of an ES2015 shorthand property assignment declares a property and
 * reads a value with one token, and `checker.getSymbolAtLocation` answers the
 * *property* — a symbol whose only declaration is the `ShorthandPropertyAssignment`
 * itself. Every provenance walk that follows a symbol to its declaration
 * therefore dead-ends on `{ handler }` while following `{ handler: handler }`
 * all the way to the foreign module it came from, and the two spellings of one
 * program decide differently. TypeScript supplies
 * `getShorthandAssignmentValueSymbol` for exactly this, and the shorthand is a
 * *fail-open* dead end: the walk answers "not foreign" rather than "unknown".
 *
 * `isAmbientGlobalReference` already reads the marker this way, so a host global
 * in a shorthand (`{ process }`) has always been caught; the value-provenance
 * walks did not, which is what let a foreign callable through. The Go fork reads
 * it this way in `isAmbientGlobalReference` and in `containsForeignExecutableValue`.
 */
function referencedValueSymbol(identifier: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
}

function isPropertyNameNode(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node);
}

/** One member selection: `receiver.name` or, identically, `receiver["name"]`. */
export interface MemberSelection {
  readonly receiver: ts.Expression;
  readonly name: string;
  /**
   * The node that SPELLS the member. A symbol resolves here for the dotted
   * spelling and for a literal key, and for nothing else; ask
   * `selectedMemberSymbol` for the member's symbol rather than resolving this
   * node directly.
   */
  readonly nameNode: ts.Node;
}

/**
 * The member a `.name` or `["name"]` access selects.
 *
 * `x["m"]` is the SAME member access as `x.m` in TypeScript semantics — same
 * resolved property symbol, same emitted call — so every compiler-recognized
 * member has to be recognized through both spellings or the computed spelling
 * is a hole. Both directions matter: recognizing only the dotted spelling let
 * `Clock["context"]()` compile with an empty requirement row and panic at
 * runtime, and let `Layer["provide"]` skip its capability check; it also
 * reported false must-consume errors for `result["match"]({...})` and
 * `Result["all"]([...])`, which discharge the obligation exactly as the dotted
 * spellings do.
 *
 * The criterion is the one `05-context-rows/a-non-literal-computed-capability-access-has-no-statically-known-member`
 * states: a key is a member selection when it "resolves to the same property
 * symbol" — and the CHECKER answers that, where `ts.isStringLiteralLike`
 * answers a question about spelling instead. The two are not the same question,
 * and the gap was measured: `Clock[("context")]()`,
 * `Clock["context" satisfies string]()`, `Clock[<"context">"context"]()`,
 * `Clock[("context") as const]()`, `(Clock)[("context")]()`, and `Clock[KEY]()`
 * for `const KEY = "context"` (and for an alias of that alias) all resolve to
 * the same property symbol, all published `requirements: []`, all checked
 * `ok: true`, and all PANICKED with `capability 'Clock' was not provided` — the
 * exact program the corpus certifies as SMITHERS2102. Seven spellings; the
 * sibling declaration-side walk (`objectLiteralMember`) had already learned the
 * const-alias key.
 *
 * A key whose type is the WIDE `string` still selects no statically known
 * member and is still not a selection: `Clock[key]()` for a `string` parameter,
 * `Clock["cont" + "ext"]()`, and `Clock["context" as string]()` (whose
 * assertion widens the literal away) each stay TS7053 over the emitted module,
 * because a compiler-owned receiver has no string index signature. Asking the
 * checker for a string LITERAL type is what draws that line in the same place
 * TypeScript draws it, rather than one wrapper away from it.
 */
export function memberSelection(node: ts.Node, checker: ts.TypeChecker): MemberSelection | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return { receiver: node.expression, name: node.name.text, nameNode: node.name };
  }
  if (!ts.isElementAccessExpression(node) || !node.argumentExpression) return undefined;
  const name = staticKeyName(node.argumentExpression, checker);
  return name === undefined
    ? undefined
    : { receiver: node.expression, name, nameNode: node.argumentExpression };
}

/**
 * The single member an expression names statically, or `undefined` when it
 * names no single member.
 *
 * THE ONE ANSWER to "which member is this key", shared by `memberSelection` and
 * by the destructuring half (`bindingMemberNames`). A string LITERAL type is
 * the criterion, because that is exactly when TypeScript resolves the access to
 * one property symbol; a widening `string` names nothing and must stay
 * `undefined`, which is what keeps `Clock[key]()` a TS7053 rather than a
 * silently recognized call.
 */
function staticKeyName(key: ts.Expression, checker: ts.TypeChecker): string | undefined {
  if (ts.isStringLiteralLike(key)) return key.text;
  const type = checker.getTypeAtLocation(key);
  return type.isStringLiteral() ? type.value : undefined;
}

/**
 * The property symbol a selection actually resolves to.
 *
 * `checker.getSymbolAtLocation` answers the member only where the member is
 * SPELLED — the `.name` of a property access, or a literal element-access key.
 * On `Clock[KEY]` it answers the symbol of `KEY`, and on `Clock[("context")]`
 * it answers nothing at all, so a rule that resolved `nameNode` directly went
 * blind at exactly the spellings `memberSelection` now recognizes. Asking the
 * RECEIVER's type for the member closes it, and closes it by symbol identity:
 * a user object with a same-spelled member still resolves to its own
 * declaration and can never stand in for a compiler-owned one.
 */
function selectedMemberSymbol(
  selection: MemberSelection,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const spelled = unalias(checker.getSymbolAtLocation(selection.nameNode), checker);
  if (spelled?.getName() === selection.name) return spelled;
  return unalias(checker.getTypeAtLocation(selection.receiver).getProperty(selection.name), checker);
}

/**
 * The member selection of a call's callee, when the callee selects a member.
 *
 * Parentheses around the callee are unwrapped because they change nothing:
 * `(Db.context)()` is the same member access, the same `this` binding and the
 * same emitted call as `Db.context()` — ECMAScript only detaches a member's
 * receiver through an assignment, a comma, or an argument position, never
 * through grouping. Reading `call.expression` raw made the parenthesized
 * spelling record NO requirement row while `checkContextReferences` refused it
 * as "detached" and told the author to invoke it directly as
 * `Capability.context()` — advice the program was already following. The row is
 * recordable here, so it is recorded, and `isZeroArgumentCallee` looks through
 * the same grouping so the two answers cannot disagree.
 */
function calleeSelection(call: ts.CallExpression, checker: ts.TypeChecker): MemberSelection | undefined {
  return memberSelection(withoutParentheses(call.expression), checker);
}

/** Strip grouping parentheses, which never change the value of an expression. */
function withoutParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isInTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    const parent: ts.Node = current.parent;
    if (ts.isTypeNode(parent)) return true;
    if (ts.isExpression(parent) || ts.isStatement(parent) || ts.isSourceFile(parent)) return false;
    current = parent;
  }
  return false;
}

/**
 * What a `Capability.context()` receiver identifies.
 *
 * `specification/requirements.mdx` §Context Access: "The receiver MUST identify
 * a `Context` subclass strongly enough for the compiler to record its nominal
 * key." `capability` is that receiver. `ambiguous` is a receiver that reaches
 * the language's `Context.context` without pinning ONE key, and it is a
 * refusal (`SMITHERS2106`), not an empty row: the runtime keys the lookup on
 * the constructor the receiver evaluates to, so an unpinned receiver produces a
 * checked program that reads a capability its row does not name.
 */
export type ContextReceiver =
  | { readonly kind: "capability"; readonly name: string }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "none" };

const AMBIGUOUS_RECEIVER: ContextReceiver = { kind: "ambiguous" };
const NO_RECEIVER: ContextReceiver = { kind: "none" };

/**
 * The operand expressions whose runtime value can BECOME this expression's.
 *
 * `undefined` means "this expression selects no operand" — it is a leaf as far
 * as provenance is concerned, not an expression with zero branches.
 *
 * THE ONE TABLE. Every provenance walk over a selecting operator has to use
 * this and only this, because the two walks that own provenance —
 * `contextReceiver` (which capability a `.context()` receiver names) and
 * `foreignValueOrigin` (which module a value came from) — were written
 * separately and drifted: the receiver walk learned `??`, `||` and `&&` and the
 * foreign walk did not, so `(untrusted ?? trusted)(v)` published
 * `requirements: []`, `failures: []` and no diagnostic while `untrusted(v)`
 * was refused — and a raw host `Error` escaped a checked function. Two
 * characters silenced SMITHERS1507, SMITHERS1509, SMITHERS1504, SMITHERS1506
 * and the foreign `Panic` row all at once, and the Go fork refused the same
 * program, so it was a live backend divergence in which the reference was
 * wrong.
 *
 * Its sibling is `typeOnlyWrapperOperand`, THE ONE TABLE for wrappers that
 * change only the type (`(x)`, `x as T`, `<T>x`, `x satisfies T`). The two
 * tables answer different questions — "which operand can be the value" versus
 * "is this a wrapper around the value" — and both were drifted apart across
 * their callers by exactly the same mechanism, one round apart.
 *
 * Why the syntax and not the checker type: TypeScript subtype-reduces a union
 * of structurally identical constituents to the first one, so
 * `(flag ? Db : Log).context()` — with `Db` and `Log` two distinct capabilities
 * that happen to share a shape — has the checker type `typeof Db` and nothing
 * in the TYPE remembers `Log`. Measured: that program checked `ok: true` with
 * `requirements: ["Db"]`, a `Layer.provide` of `Db` satisfied the declared row,
 * and it panicked with `capability 'Log' was not provided`. The branches are
 * still in the SYNTAX, so the syntax is asked first and the type is only
 * consulted for expressions that select nothing.
 */
function valueBranches(expression: ts.Expression): readonly ts.Expression[] | undefined {
  if (ts.isConditionalExpression(expression)) return [expression.whenTrue, expression.whenFalse];
  if (ts.isBinaryExpression(expression)) {
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.QuestionQuestionToken:
      case ts.SyntaxKind.BarBarToken:
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return [expression.left, expression.right];
      // The value of `(a, b)` and of `(c = Db)` is the right operand alone.
      case ts.SyntaxKind.CommaToken:
      case ts.SyntaxKind.EqualsToken:
        return [expression.right];
      default:
        return undefined;
    }
  }
  return undefined;
}

/**
 * Fold syntactic branch resolutions into one verdict.
 *
 * A branch that carries no capability evidence at all is skipped rather than
 * treated as disagreement: the left operand of `flag && Db` is a boolean and
 * the discarded arm of `c ?? Db` is `undefined`, and neither can be the
 * receiver of a capability read. Two branches that name DIFFERENT capabilities
 * are the ambiguity this rule exists to refuse.
 */
function agreeOnCapability(parts: readonly ContextReceiver[]): ContextReceiver {
  let found: string | undefined;
  for (const part of parts) {
    if (part.kind === "none") continue;
    if (part.kind === "ambiguous") return AMBIGUOUS_RECEIVER;
    if (found === undefined) found = part.name;
    else if (found !== part.name) return AMBIGUOUS_RECEIVER;
  }
  return found === undefined ? NO_RECEIVER : { kind: "capability", name: found };
}

/** The nominal row identity of a class declaration that extends `Context`. */
function capabilityOfClassLike(
  declaration: ts.ClassLikeDeclaration,
  checker: ts.TypeChecker,
): ContextReceiver {
  if (!extendsImportedContext(declaration, checker)) return NO_RECEIVER;
  // A class EXPRESSION extending `Context` has a nominal key no `Layer` can
  // name, so a read through it can never be provided; that is a refusal.
  if (!declaration.name || !ts.isClassDeclaration(declaration)) return AMBIGUOUS_RECEIVER;
  return {
    kind: "capability",
    name: rowNameForSymbol(
      unalias(checker.getSymbolAtLocation(declaration.name), checker),
      declaration.name.text,
      checker,
    ),
  };
}

/** Whether this type's construct signatures produce a `Context` instance. */
function isContextConstructorType(type: ts.Type, checker: ts.TypeChecker): boolean {
  for (const signature of type.getConstructSignatures()) {
    const instance = signature.getReturnType().getSymbol();
    const declaration = instance?.declarations?.find(ts.isClassLike);
    if (!declaration) continue;
    if (extendsImportedContext(declaration, checker)) return true;
    // The bound is often `Context` itself, which extends nothing.
    if (declaration.name?.text === "Context" && isCompilerPrelude(declaration.getSourceFile())) return true;
  }
  return false;
}

function contextReceiverOfType(
  type: ts.Type,
  checker: ts.TypeChecker,
  seen: Set<ts.Type>,
): ContextReceiver {
  if (seen.has(type)) return NO_RECEIVER;
  seen.add(type);
  if (type.isUnion()) {
    const parts = type.types
      .filter((part) => (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) === 0)
      .map((part) => contextReceiverOfType(part, checker, seen));
    // Unlike a syntactic branch, a union constituent that is not a capability
    // IS evidence the receiver does not pin one key: it is a value this
    // receiver can actually hold.
    if (parts.some((part) => part.kind !== "none") && parts.some((part) => part.kind === "none")) {
      return AMBIGUOUS_RECEIVER;
    }
    return agreeOnCapability(parts);
  }
  if (type.isIntersection()) {
    const parts = type.types.map((part) => contextReceiverOfType(part, checker, seen));
    return parts.some((part) => part.kind !== "none") ? AMBIGUOUS_RECEIVER : NO_RECEIVER;
  }
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    if (!constraint || constraint === type) return NO_RECEIVER;
    // A type parameter bounded by `typeof Db` is still substitutable by a
    // SUBCLASS of `Db`, whose nominal key is a different one, so a bound never
    // pins the key even when it names exactly one class.
    const bound = contextReceiverOfType(constraint, checker, seen);
    if (bound.kind !== "none") return AMBIGUOUS_RECEIVER;
    return isContextConstructorType(constraint, checker) ? AMBIGUOUS_RECEIVER : NO_RECEIVER;
  }
  const declaration = type.getSymbol()?.declarations?.find(ts.isClassLike);
  return declaration ? capabilityOfClassLike(declaration, checker) : NO_RECEIVER;
}

/**
 * Resolve the capability a `.context()` receiver identifies.
 *
 * Syntax first (see `valueBranches`), then the checker type. A type
 * assertion is asked about its OPERAND first, because `as` changes the type and
 * never the value: `(Db as any).context()` and
 * `(Db as unknown as { context(): Db }).context()` both call `Db`'s inherited
 * static at runtime, and both recorded an empty row while doing it. The
 * asserted type is still the fallback for an operand that carries no capability
 * evidence of its own, which is what keeps `(x as typeof Db).context()` — an
 * author's explicit claim about an opaque value — recording `Db`.
 *
 * It has a SECOND caller: the `Layer.succeed` capability argument in
 * `resolveLayerExpression`. The runtime registers a layer under the constructor
 * that argument evaluates to and resolves `.context()` by the constructor its
 * receiver evaluates to, so a layer's PROVIDED set and a body's REQUIRED set
 * are one fact about one program and have to be computed by one function. They
 * were computed by two, and the two disagreed in OPPOSITE directions on the two
 * backends — one certifying a capability the runtime never registers, the other
 * refusing a program that runs. Anything changed here changes both sides of
 * `Layer.provide` at once, which is the point.
 */
export function contextReceiver(receiver: ts.Expression, checker: ts.TypeChecker, depth = 0): ContextReceiver {
  if (depth > 16) return AMBIGUOUS_RECEIVER;
  const branches = valueBranches(receiver);
  if (branches) {
    return agreeOnCapability(branches.map((branch) => contextReceiver(branch, checker, depth + 1)));
  }
  if (ts.isParenthesizedExpression(receiver)) return contextReceiver(receiver.expression, checker, depth + 1);
  // `super.context()` in a static method invokes the inherited static with
  // `this` bound to the CONTAINING class, never to the superclass, so the
  // checker type of `super` (`typeof Db`) is the one key the read can never
  // have. Measured: `class S2 extends Db { static read() { return
  // super.context()... } }` recorded `["Db"]`, a `Db` layer satisfied the row,
  // and the program panicked with `capability 'S2' was not provided`. It is
  // `this.context()` spelled differently, so it resolves the same way.
  if (receiver.kind === ts.SyntaxKind.SuperKeyword) {
    const owner = enclosingClass(receiver);
    return owner ? capabilityOfClassLike(owner, checker) : AMBIGUOUS_RECEIVER;
  }
  // These are the `typeOnlyWrapperOperand` entries (minus the parenthesis
  // handled above) plus `!`, but they are spelled out here rather than taken
  // from that table because this walk does not merely pass through them: an
  // operand that carries no capability evidence falls through to the ASSERTED
  // type below, which is what keeps `(x as typeof Db).context()` recording
  // `Db`. If the table gains an entry, this list has to gain it too.
  if (ts.isAsExpression(receiver) || ts.isTypeAssertionExpression(receiver) ||
    ts.isSatisfiesExpression(receiver) || ts.isNonNullExpression(receiver)) {
    const operand = contextReceiver(receiver.expression, checker, depth + 1);
    if (operand.kind !== "none") return operand;
  }
  if (ts.isIdentifier(receiver)) {
    // A `const` binding IS its initializer, and the initializer still spells
    // the branches the binding's declared type has already reduced away:
    // `const c = flag ? Db : Log` has the checker type `typeof Db` when the two
    // capabilities share a shape, so reading the binding's type alone recorded
    // `Db` for a receiver that is `Log` half the time.
    const initializer = constantInitializer(receiver, checker);
    if (initializer) {
      const bound = contextReceiver(initializer, checker, depth + 1);
      if (bound.kind !== "none") return bound;
    }
  }
  const fromType = contextReceiverOfType(checker.getTypeAtLocation(receiver), checker, new Set());
  if (fromType.kind !== "none") return fromType;
  if (ts.isIdentifier(receiver)) {
    const declaration = unalias(checker.getSymbolAtLocation(receiver), checker)
      ?.declarations?.find(ts.isClassLike);
    if (declaration) return capabilityOfClassLike(declaration, checker);
  }
  return NO_RECEIVER;
}

/** The class declaration a node is lexically inside, if any. */
function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isClassLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * The initializer of a `const` binding this identifier names.
 *
 * `let` is excluded: a reassignment makes the initializer no evidence at all
 * about the value at the read.
 */
function constantInitializer(reference: ts.Identifier, checker: ts.TypeChecker): ts.Expression | undefined {
  const declarations = unalias(checker.getSymbolAtLocation(reference), checker)?.declarations ?? [];
  if (declarations.length !== 1) return undefined;
  const [declaration] = declarations;
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined;
  if (!ts.isVariableDeclarationList(declaration.parent)) return undefined;
  const isConstant = (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
  return isConstant ? declaration.initializer : undefined;
}

/** Whether this symbol is the prelude's `Context.context`. */
function isPreludeContextSymbol(symbol: ts.Symbol | undefined): boolean {
  if (symbol?.getName() !== "context") return false;
  return Boolean(symbol.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile())));
}

/** Whether this member selection resolves to the prelude's `Context.context`. */
function isPreludeContextMember(selection: MemberSelection, checker: ts.TypeChecker): boolean {
  return isPreludeContextSymbol(selectedMemberSymbol(selection, checker));
}

/**
 * Classify a call as a capability read.
 *
 * `undefined` means "not a context call". It is deliberately NOT the answer for
 * a context call whose receiver is illegal — that was the fail-open this rule
 * closes, and it is now `ambiguous`.
 */
export function contextRequirement(call: ts.CallExpression, checker: ts.TypeChecker): ContextReceiver | undefined {
  const selection = calleeSelection(call, checker);
  if (!selection || selection.name !== "context" || call.arguments.length !== 0) {
    return undefined;
  }
  const resolved = contextReceiver(selection.receiver, checker);
  if (resolved.kind !== "none") return resolved;
  // The receiver named nothing, but the member itself may still resolve to the
  // language's own `context` (a bare type parameter with no usable bound gets
  // here). That is a context call with no recordable key: refuse it.
  return isPreludeContextMember(selection, checker) ? AMBIGUOUS_RECEIVER : undefined;
}

const AMBIGUOUS_CONTEXT_RECEIVER_MESSAGE =
  "the receiver of context() must identify exactly one Context subclass; this receiver can evaluate to a different capability at runtime, so no nominal key can be recorded";

function extendsImportedContext(declaration: ts.ClassLikeDeclaration, checker: ts.TypeChecker): boolean {
  const heritage = declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
  for (const typeNode of heritage?.types ?? []) {
    const symbol = unalias(checker.getSymbolAtLocation(typeNode.expression), checker);
    if (symbol?.getName() === "Context") {
      const moduleName = importedModuleOfExpression(typeNode.expression, checker);
      if (moduleName === "smthrs/context" || symbol.declarations?.some((item) => isCompilerPrelude(item.getSourceFile()))) return true;
    }
    const base = symbol?.declarations?.find(ts.isClassDeclaration);
    if (base && extendsImportedContext(base, checker)) return true;
  }
  return false;
}

function isPromiseInstanceChain(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call, checker);
  if (!selection) return false;
  if (!["then", "catch", "finally"].includes(selection.name)) return false;
  return Boolean(promisedType(checker.getTypeAtLocation(selection.receiver), checker));
}

/**
 * The layer expression each binding names, for `const` bindings only.
 *
 * `resolveLayerExpression` treats a binding's initializer as its value forever,
 * and that is only true of a binding that cannot be reassigned. Recording
 * `let`/`var` too made `Layer.provide` certify a closure it does not have:
 *
 *   let app: Layer<typeof Db> | Layer<typeof Log> = Layer.succeed(Db, db)
 *   app = Layer.succeed(Log, log)
 *   Layer.provide(app, () => needsDb())
 *
 * checked `ok: true` with `provided = {Db}` and an empty missing set, and
 * panicked with `capability 'Db' was not provided`. The same happens through a
 * `var` and through a reassignment inside a helper, and it was silent on both
 * backends. `specification/requirements.mdx` §Satisfaction (Locked) — "When the
 * compiler knows the complete closure, an unsatisfied capability MUST be a
 * compile error" — is a claim about a closure the compiler actually knows.
 *
 * This is the rule `checkForeignValueBoundaries` already applies two thousand
 * lines earlier for the same reason ("a mutable alias cannot retain foreign
 * panic provenance in this POC"). Everything not recorded here lands on the
 * fail-closed SMITHERS2104 path, so a mutable layer binding is refused rather
 * than resolved from a stale initializer.
 */
function collectLayerBindings(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Map<ts.Symbol, ts.Expression> {
  const result = new Map<ts.Symbol, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
      if (symbol) result.set(symbol, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/**
 * `Layer.provide(layer, body)`, in every spelling the analysis already accepts.
 *
 * Exported for the emitter, which has to recognize the SAME call the
 * requirement subtraction recognized — a provide
 * that `checkLayerSatisfaction` certified and the emitter did not lower would
 * publish an empty requirement row over a computation with no handler under it.
 * One predicate, so the two answers cannot drift.
 */
export function isLayerProvideCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  return isLayerCall(call, checker, "provide");
}

function isLayerCall(call: ts.CallExpression, checker: ts.TypeChecker, method: string): boolean {
  const selection = calleeSelection(call, checker);
  if (!selection || selection.name !== method) return false;
  const moduleName = importedModuleOfExpression(selection.receiver, checker);
  if (moduleName === "smthrs/provider") return true;
  const symbol = unalias(checker.getSymbolAtLocation(selection.receiver), checker);
  return symbol?.getName() === "Layer" && Boolean(symbol.declarations?.some((item) => isCompilerPrelude(item.getSourceFile())));
}

/**
 * Which capabilities a layer expression provides, and whether that set is
 * complete enough to certify a `Layer.provide`.
 *
 * The walk is over SYNTAX, not over the checker type, for the reason
 * `valueBranches` records: the type of a layer can be asserted into something
 * the runtime does not provide, and only the syntax still spells the
 * `Layer.succeed` that decides what the runtime actually registers. That makes
 * a type-only wrapper irrelevant here BY CONSTRUCTION — `x as Layer<typeof Log>`
 * registers whatever `x` registers — so every one of them has to be walked
 * through. It used to look through parentheses ALONE, so
 * `Layer.succeed(Db, db) satisfies Layer<typeof Db>` was refused SMITHERS2104
 * while the byte-identical program with the two erased words deleted was
 * accepted and ran; `as`, `as const`, `<T>x`, `as unknown as T` and every
 * combination were refused the same way, and a `Layer.provide` genuinely
 * missing a capability answered with the blunt SMITHERS2104 instead of the
 * SMITHERS2101 that names it. This is the ninth walk to have spelled its own
 * wrapper chain and the sixth to have got it wrong; it now uses
 * `typeOnlyWrapperOperand`, THE ONE TABLE, so it cannot drift again.
 *
 * `!` is deliberately NOT looked through, exactly as that table has it: in this
 * language `!` is Result propagation, `SMITHERS1207` already refuses it on a
 * non-Result, and a layer reached through one is left on the fail-closed
 * SMITHERS2104 path.
 *
 * The `const`-only binding rule (`collectLayerBindings`) is untouched and must
 * stay untouched: looking through a type-only wrapper says nothing about
 * whether the binding under it can be reassigned, and a reassigned `let` layer
 * is still opaque in every spelling.
 */
function resolveLayerExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ts.Expression>,
  seen = new Set<ts.Symbol>(),
): { values: Set<string>; complete: boolean } {
  const unwrapped = typeOnlyWrapperOperand(expression);
  if (unwrapped) return resolveLayerExpression(unwrapped, checker, bindings, seen);
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    const initializer = symbol && bindings.get(symbol);
    if (!symbol || !initializer || seen.has(symbol)) return { values: new Set(), complete: false };
    seen.add(symbol);
    return resolveLayerExpression(initializer, checker, bindings, seen);
  }
  if (!ts.isCallExpression(expression) || !calleeSelection(expression, checker)) {
    return { values: new Set(), complete: false };
  }
  if (isLayerCall(expression, checker, "succeed")) {
    // The capability argument is asked exactly the question `contextReceiver`
    // already answers — "which ONE `Context` class does this expression
    // evaluate to?" — so it is answered by that function rather than by a
    // second walk that agrees with it today. The runtime registers the layer
    // under the constructor the argument EVALUATES to and `.context()` looks it
    // up by the constructor its receiver EVALUATES to, so the provided set and
    // the required set are one fact about one program; computing them with two
    // resolvers is how they came apart.
    //
    // What that reuse buys, measured before the change (`X01`-`X04`):
    //
    //   * `Layer.succeed(Db as unknown as typeof Cfg, cfg)` — the retired
    //     resolver here asked the ASSERTED TYPE for its class symbol on the Go
    //     fork and recorded `Cfg`; the program checked `ok: true` and PANICKED
    //     with `unsatisfied Context requirement`. Syntax first answers `Db`, so
    //     the missing `Cfg` is the precise SMITHERS2101.
    //   * `const Alias = Db; Layer.succeed(Alias, db)` — a `const` value alias
    //     is not a class DECLARATION, so the retired resolver fell back to the
    //     identifier's TEXT and recorded the phantom row `Alias`; the program
    //     was refused SMITHERS2101 "missing Db" while the Go fork accepted it
    //     and RAN. `contextReceiver` reads the `const` initializer and answers
    //     `Db`.
    //   * `Layer.succeed(<any>Db, db)` — accepted here, refused SMITHERS2104 on
    //     the fork, which read the erased type. The operand is asked first, so
    //     both now accept it.
    //   * `Layer.succeed(flag ? Db : Twin, db)` — TypeScript subtype-reduces
    //     `typeof Db | typeof Twin` to `typeof Db`, so nothing in the TYPE
    //     remembers `Twin`; only the syntax still spells both arms. Ambiguous
    //     is a refusal, not a row.
    //
    // An argument that pins no single class lands on the fail-closed
    // SMITHERS2104 path this function's `bool` already owns — the same answer
    // the resolver gives every other expression it cannot see through. No new
    // code is minted here: `SMITHERS2106` is the refusal for an unpinned
    // `.context()` RECEIVER, where the alternative is a silent capability read;
    // the alternative here is a layer whose closure is unproven, which is what
    // SMITHERS2104 says.
    const argument = expression.arguments[0];
    const capability = argument ? contextReceiver(argument, checker) : NO_RECEIVER;
    if (capability.kind !== "capability") return { values: new Set(), complete: false };
    return { values: new Set([capability.name]), complete: true };
  }
  if (isLayerCall(expression, checker, "merge")) {
    const values = new Set<string>();
    let complete = true;
    for (const argument of expression.arguments) {
      const part = resolveLayerExpression(argument, checker, bindings, new Set(seen));
      for (const value of part.values) values.add(value);
      complete &&= part.complete;
    }
    return { values, complete };
  }
  return { values: new Set(), complete: false };
}

function checkLayerSatisfaction(
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  layerBindings: ReadonlyMap<ts.Symbol, ts.Expression>,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const checked = new Set<ts.CallExpression>();
  const check = (edge: ProvideEdge): void => {
    if (checked.has(edge.node)) return;
    checked.add(edge.node);
    const callback = edge.callback ?? edge.callbackReference;
    if (!callback) {
      diagnostics.push(at(edge.node, sourceFile, "SMITHERS2103", "Layer.provide callback must resolve to a checked local function in this POC"));
      return;
    }
    if (!edge.complete) {
      diagnostics.push(at(edge.node.arguments[0] ?? edge.node, sourceFile, "SMITHERS2104", "Layer expression is opaque; this POC cannot prove its provided capability closure"));
      return;
    }
    // Requirement rows are nominal `Context` capabilities only. There is no
    // built-in member to exempt here: `TypeScript` was withdrawn as a
    // requirement (specification/compatibility.mdx, "TypeScript Target", and
    // specification/type-system.mdx), so what is left after subtracting the
    // layer's provided closure is exactly the unprovided capabilities.
    const missing = difference(callback.requirements, edge.provided);
    if (missing.size > 0 && !nearestFunction(edge.node)) {
      diagnostics.push(at(edge.node, sourceFile, "SMITHERS2101", `Layer.provide is missing ${formatSet(missing)}`));
    }
  };
  for (const fn of functions) {
    if (fn.node.getSourceFile() !== sourceFile) continue;
    for (const edge of fn.provides) check(edge);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isLayerCall(node, checker, "provide") && !checked.has(node)) {
      const layer = node.arguments[0];
      const callbackExpression = node.arguments[1];
      const resolved = layer ? resolveLayerExpression(layer, checker, layerBindings) : { values: new Set<string>(), complete: false };
      check({
        node,
        callback: callbackExpression && isSupportedFunctionLike(callbackExpression) ? functionByNode.get(callbackExpression) : undefined,
        callbackReference: callbackExpression ? resolveFunctionReference(callbackExpression, checker, functions, functionByNode) : undefined,
        provided: resolved.values,
        complete: resolved.complete,
      });
    }
    if (ts.isCallExpression(node) && !nearestFunction(node)) {
      const callee = resolveLocalCallee(node, checker, functions, functionByNode);
      if (callee && callee.requirements.size > 0 && !isInsideLayerCallback(node, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS2102", `top-level call has unsatisfied requirements ${formatSet(callee.requirements)}`));
      }
    }
    // Module evaluation has no enclosing function row, so `collectFacts` never
    // sees a capability read written directly at top level. The indirect form
    // — a top-level call to a function whose row names the capability — is
    // refused above; the direct one compiled clean and panicked at run time
    // with `capability 'Db' was not provided`, and a callback handed to a
    // top-level higher-order call did the same.
    if (!nearestFunction(node) && !isInsideLayerCallback(node, checker)) {
      if (ts.isCallExpression(node)) {
        const direct = contextRequirement(node, checker);
        if (direct?.kind === "capability") {
          diagnostics.push(at(node, sourceFile, "SMITHERS2102", `top-level call has unsatisfied requirements ${direct.name}`));
        }
        if (direct?.kind === "ambiguous") {
          diagnostics.push(at(node, sourceFile, "SMITHERS2106", AMBIGUOUS_CONTEXT_RECEIVER_MESSAGE));
        }
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
        for (const callback of crossingCallbacks(node, checker, functions, functionByNode)) {
          if (callback.requirements.size > 0) {
            diagnostics.push(at(node, sourceFile, "SMITHERS2102", `top-level call has unsatisfied requirements ${formatSet(callback.requirements)}`));
          }
        }
      }
      // Module evaluation runs a top-level `` tag`x` `` and `new C()` exactly as
      // it runs a call, and with no enclosing row to charge; see
      // `InvocationExpression`.
      if (ts.isTaggedTemplateExpression(node) || ts.isNewExpression(node)) {
        const invoked = resolveInvokedDeclaration(node, checker, functionByNode);
        if (invoked && invoked.requirements.size > 0) {
          diagnostics.push(at(node, sourceFile, "SMITHERS2102", `top-level call has unsatisfied requirements ${formatSet(invoked.requirements)}`));
        }
      }
    }
    // A top-level accessor read or write invokes the accessor at module
    // evaluation just as a call does, and there is no enclosing function row to
    // carry its capabilities either. The same is true of every implicit
    // protocol invocation — a top-level `[...it]` runs the authored iterator.
    if (!nearestFunction(node) && !isInsideLayerCallback(node, checker)) {
      const accessors = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
        ? accessorInvocations(node, checker, functionByNode)
        : ts.isBindingElement(node)
        ? destructuredAccessorInvocations(node, checker, functionByNode)
        : [];
      for (const accessor of [...accessors, ...implicitInvocations(node, checker, functionByNode)]) {
        if (accessor.requirements.size > 0) {
          diagnostics.push(at(node, sourceFile, "SMITHERS2102", `top-level call has unsatisfied requirements ${formatSet(accessor.requirements)}`));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * `Context.context` may only be INVOKED, never referenced.
 *
 * The requirement row is recorded at the call site from the receiver, so every
 * spelling that separates the member from its receiver erases the row while
 * keeping the capability read: `Reflect.apply(Db.context, Db, [])` checked
 * `ok: true` with `requirements: []`, ran, and returned the provided `Db`
 * service. The `.call`/`.apply`/`.bind`/alias spellings were refused only
 * INCIDENTALLY, by the stock type check over the emitted module (the prelude's
 * `this`-parameter makes a detached receiver unresolvable) — not by any rule,
 * which is why `smithers inspect` reported `ok: true, requirements: []` for a
 * file `smithers check` refused, and why the Go fork's looser prelude typing
 * accepted all four.
 *
 * Making it a semantic rule states the contract once: the member is a call, not
 * a value. Type positions (`typeof Db.context`) read nothing and stay legal.
 */
function checkContextReferences(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const detached = (node: ts.Node): void => {
    diagnostics.push(at(
      node,
      sourceFile,
      "SMITHERS2107",
      "Capability.context is a compiler-recognized capability read, not a value; a detached reference (call/apply/bind, an alias, or handing it to another function) loses the requirement row — invoke it directly as Capability.context()",
    ));
  };
  const visit = (node: ts.Node): void => {
    const selection = memberSelection(node, checker);
    if (selection && selection.name === "context" && !isInTypePosition(node) &&
      isPreludeContextMember(selection, checker) && !isZeroArgumentCallee(node)) {
      detached(node);
    }
    // `Reflect.get(Db, "context")` is the reflective spelling of `Db["context"]`
    // and reaches the same member with no member-access node in the program at
    // all: measured accepted with `requirements: []`, and it RAN, returning the
    // provided service. `Reflect` is in `UNIVERSAL_GLOBALS`, so the spelling is
    // reachable. A COMPUTED key (`Reflect.get(Db, key)`) is deliberately not
    // matched here — it names no statically known member — and reflective
    // laundering through the rest of `Object`/`Reflect` stays open; closing it
    // by construction would mean constraining where a `Context` subclass may
    // appear as a value at all, which the specification does not settle.
    if (ts.isCallExpression(node) && node.arguments.length >= 2 &&
      isReflectiveMemberRead(node, checker) &&
      ts.isStringLiteralLike(node.arguments[1]!) && node.arguments[1]!.text === "context" &&
      contextReceiver(node.arguments[0]!, checker).kind !== "none") {
      detached(node);
    }
    // `const { context } = Db` detaches the member with no member-access node
    // to see it, which is why the reference refused it only through the
    // emitted-TypeScript type check and the fork accepted it outright.
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent)) {
      const nameNode = node.propertyName ?? node.name;
      const source = node.parent.parent.initializer;
      if (source && ts.isIdentifier(nameNode) && nameNode.text === "context" &&
        isPreludeContextSymbol(checker.getTypeAtLocation(source).getProperty("context"))) {
        detached(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * A builtin that reads one named member off a value handed to it.
 *
 * Recognized by the ambient global's name, the same way `Date["now"]()` is:
 * both roots are in `UNIVERSAL_GLOBALS`, so a local shadow would resolve
 * elsewhere and is excluded by the symbol check.
 */
function isReflectiveMemberRead(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call, checker);
  if (!selection || !ts.isIdentifier(selection.receiver)) return false;
  const root = selection.receiver.text;
  const member = selection.name;
  const reflective = (root === "Reflect" && member === "get") ||
    (root === "Object" && member === "getOwnPropertyDescriptor");
  if (!reflective) return false;
  const declarations = unalias(checker.getSymbolAtLocation(selection.receiver), checker)?.declarations ?? [];
  return declarations.length === 0 ||
    declarations.some((declaration) =>
      isTypeScriptLibrary(declaration.getSourceFile()) || isCompilerPrelude(declaration.getSourceFile()));
}

/**
 * Whether this node is the callee of a zero-argument call, and nothing else.
 *
 * Grouping parentheses are walked through: `(Db.context)()` still has the
 * member access as the direct callee of the call, so it is an invocation and
 * not a detached reference. Refusing it was an over-correction — the row IS
 * recordable there (see `calleeSelection`), and SMITHERS2107 exists for the
 * spellings that genuinely separate the member from its call, which all put
 * some OTHER node between the two: an argument list, an object or array
 * literal, a `return`, an assignment, or `.call`/`.apply`/`.bind`.
 */
function isZeroArgumentCallee(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  return Boolean(parent) && ts.isCallExpression(parent) && parent.expression === current &&
    parent.arguments.length === 0;
}

function checkCallbackOwnership(
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node) && !ts.isTaggedTemplateExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    // A tagged template hands its substitutions to the tag exactly as a call
    // hands its arguments: `` hostTag`x${cb}` `` is `hostTag(parts, cb)`, so an
    // inferred-fallible `cb` crosses the same boundary and needs the same
    // contract. Reading `node.arguments` alone made SMITHERS1303 and
    // SMITHERS1404 silent on the template spelling.
    for (const argument of invocationArguments(node)) {
      // The contract check follows the function *values* the argument carries,
      // not the argument's syntactic shape; see collectCallbackValues.
      for (const carried of collectCallbackValues(argument)) {
        const callback = isSupportedFunctionLike(carried)
          ? functionByNode.get(carried)
          : ts.isExpression(carried)
            ? resolveFunctionReference(carried, checker, functions, functionByNode)
            : undefined;
        if (!callback || callback.bodyFailures.size === 0 || hasResultContract(callback)) continue;
        const isProvideCallback = ts.isCallExpression(node) && isLayerCall(node, checker, "provide") &&
          node.arguments[1] === argument;
        diagnostics.push(at(
          carried,
          sourceFile,
          isProvideCallback ? "SMITHERS2105" : "SMITHERS1303",
          isProvideCallback
            ? "fallible Layer.provide callbacks need an explicit Result (or Promise<Result>) contract so the provided computation keeps its failure channel"
            : "an inferred-fallible function value cannot cross a callback boundary; add an explicit Result contract or handle its failures before passing it",
        ));
      }
      // Async invocation ownership (SMITHERS1404) is a separate rule about
      // *started* work, and it is deliberately left on the argument itself.
      // Widening its reach the way the contract check above is widened is not
      // this rule's question and would change which programs it accepts. A
      // tagged template IS an argument position, though — the substitution is
      // handed to the tag and started there — so the two spellings of the same
      // handover answer alike. `new` stays out, as it always has.
      if (ts.isNewExpression(node)) continue;
      const callback = isSupportedFunctionLike(argument)
        ? functionByNode.get(argument)
        : resolveFunctionReference(argument, checker, functions, functionByNode);
      if (!callback) continue;
      const isProvideCallback = ts.isCallExpression(node) &&
        isLayerCall(node, checker, "provide") && node.arguments[1] === argument;
      if (callback.async) {
        const consumedProvide = isProvideCallback && producerConsumed(node, "promise", checker, callEdges);
        // Result.tryPromise invokes its body exactly once and awaits it, so
        // the boundary itself owns the async callback's lifetime.
        const ownedBoundaryBody = ts.isCallExpression(node) && node.arguments[0] === argument &&
          calleeSelection(node, checker)?.name === "tryPromise" &&
          isPreludeResultBoundaryCall(node, checker);
        if (!consumedProvide && !ownedBoundaryBody) {
          diagnostics.push(at(
            argument,
            sourceFile,
            "SMITHERS1404",
            "async callback invocation ownership is not proven here; use an explicit structured-concurrency combinator or await/return a recognized Layer.provide computation",
          ));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * A callback boundary is a *value* edge, not a syntactic argument position.
 *
 * `match({ error: cb })` hands `cb` to the callee exactly as `map(cb)` does, and
 * the callee invokes it exactly the same way — so the contract that makes the
 * handover safe has to be required in both spellings. Reading only the top-level
 * argument node let an inferred-fallible function cross the boundary inside an
 * object or array literal, where its lowered `Result` return became the callee's
 * plain success value (specification/failures.mdx, "Compiler Lifting").
 *
 * Function *bodies* are never entered: a callback nested inside another
 * callback's body is a boundary of its own and is checked at its own call site.
 * A spread element's operand is followed but an object spread is not — its
 * members are not syntactically present, so nothing here can name them.
 */
/**
 * Every checked function value this call, `new` or tagged template hands across
 * its argument boundary.
 *
 * The same value edge `checkCallbackOwnership` walks for SMITHERS1303 and
 * SMITHERS1404, so the three channels cannot drift apart on which handovers
 * they see. The `Layer.provide` computation is the one argument excluded: its
 * row is reconciled against the layer's provided closure by
 * `checkLayerSatisfaction`, and charging it here would republish exactly the
 * capabilities the provide site satisfies.
 */
function crossingCallbacks(
  node: InvocationExpression,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly SemanticFunction[] {
  const carriedFunctions: SemanticFunction[] = [];
  const provideComputation = ts.isCallExpression(node) && isLayerCall(node, checker, "provide")
    ? node.arguments[1]
    : undefined;
  for (const argument of invocationArguments(node)) {
    if (argument === provideComputation) continue;
    for (const carried of collectCallbackValues(argument)) {
      const callback = isSupportedFunctionLike(carried)
        ? functionByNode.get(carried)
        : ts.isExpression(carried)
          ? resolveFunctionReference(carried, checker, functions, functionByNode)
          : undefined;
      if (callback) carriedFunctions.push(callback);
    }
  }
  return carriedFunctions;
}

function collectCallbackValues(argument: ts.Expression): readonly ts.Node[] {
  const carried: ts.Node[] = [];
  const walk = (node: ts.Expression): void => {
    // Type-level wrappers (the shared table) plus `!`.
    const unwrapped = typeOnlyWrapperOperand(node);
    if (unwrapped) {
      walk(unwrapped);
      return;
    }
    if (ts.isNonNullExpression(node)) {
      walk(node.expression);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) walk(property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) carried.push(property.name);
        else if (isSupportedFunctionLike(property)) carried.push(property);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isOmittedExpression(element)) continue;
        walk(ts.isSpreadElement(element) ? element.expression : element);
      }
      return;
    }
    carried.push(node);
  };
  walk(argument);
  return carried;
}

/**
 * True when this function's `Result` channel is one a consumer can rely on.
 *
 * A spelled contract always qualifies. An *unannotated* function's shape is the
 * TypeScript checker's inferred return type, and the checker still reads postfix
 * `!` with the non-null-assertion meaning that specification/failures.mdx,
 * "Propagation", abolishes: "`!` MUST NOT retain TypeScript's non-null assertion
 * meaning in `.sm`". A propagating callback therefore *appears* to return the
 * very Result it extracts a plain value out of, which silenced this check on
 * exactly the shape it exists to refuse. An inferred contract is trusted only
 * when no propagation contributed to it.
 */
function hasResultContract(fn: SemanticFunction): boolean {
  if (!fn.declaredShape.channel.startsWith("result")) return false;
  return fn.explicitReturn || !fn.hasResultPropagation;
}

function isInsideLayerCallback(node: ts.Node, checker: ts.TypeChecker): boolean {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    if (isSupportedFunctionLike(current) && ts.isCallExpression(current.parent) &&
      isLayerCall(current.parent, checker, "provide") && current.parent.arguments[1] === current) return true;
    current = current.parent;
  }
  return false;
}

/**
 * The type an element read would have had if `noUncheckedIndexedAccess` were
 * off, when — and only when — that option is what added the `| undefined`.
 *
 * `noUncheckedIndexedAccess` is mandatory (compatibility.mdx §Mandatory:
 * "`arr[2]` MUST be `T | undefined`; an index is a lookup that can find
 * nothing"), and turning it on is what put this function here. Under it,
 * `results[i]` over a `Result<A, E>[]` is `Result<A, E> | undefined`, the `!`
 * provenance walk saw a union carrying no `__smithersResult` brand — a union
 * property resolves only when every constituent has it, and `undefined` has
 * none — and refused `results[i]!` as SMITHERS1207 "postfix ! requires a Result
 * operand". Two conformance cases moved on exactly that:
 * `07-must-consume/an-array-literal-of-results-is-consumed-through-an-index-read`
 * and `07-must-consume/a-returned-result-collection-is-consumed-by-an-index-read`.
 *
 * That refusal was the wrong one of the three things that disagreed. The
 * mandated option and the propagation rule contradicted each other, and
 * compatibility.mdx asserted a third thing — that `arr[i]!` "compiles only when
 * `arr` holds Results" — which the option made unsatisfiable. The value at
 * `results[i]` IS a Result; it was widened by the option the specification
 * itself mandates, not by anything the author wrote.
 *
 * THE DISTINCTION THIS DRAWS, and why it is not "strip `| undefined` from every
 * operand". The absence axis stays intact: `!` is the error axis and `?.`/`??`
 * are the absence axis, so a `Result<A, E> | undefined` the AUTHOR wrote is
 * still not a `!` operand. The two are told apart by the container's index
 * type, which the option does not widen — only the access site is widened. So
 * the `| undefined` is dropped only when the container's own element type does
 * not already admit `undefined`:
 *
 *   * `Result<A, E>[]` — index type `Result<A, E>`, access `Result<A, E> |
 *     undefined`. Option-added. Dropped, and `arr[i]!` compiles.
 *   * `(Result<A, E> | undefined)[]` — index type `Result<A, E> | undefined`,
 *     access the same. Authored. Kept, and `arr[i]!` stays SMITHERS1207.
 *   * `string[]` — index type `string`. Dropped, leaving `string`, which is not
 *     a Result, so `arr[i]!` stays SMITHERS1207 for the ordinary reason.
 *   * `[Result<A, E>, string]` — a heterogeneous tuple. Reading the ACCESS type
 *     and dropping is what makes `pair[0]!` compile while `pair[1]!` does not;
 *     computing the shape from the index type instead would have collapsed both
 *     to `Result<A, E> | string` and refused the first as well.
 *
 * Returns undefined when there is nothing to do — no `undefined` constituent,
 * no index information, or an index type that admits `undefined` — leaving the
 * caller on the type the checker reported.
 */
/**
 * The type of `expression`, with the `| undefined` `noUncheckedIndexedAccess`
 * adds to an element READ removed when the option is what added it.
 *
 * THE ONE DOOR for "what is this expression really?", because more than one walk
 * asks. The `!` provenance walk asks it through {@link semanticExpressionShape};
 * {@link signatureFunctions} asks it to find the checked function a value names,
 * and a union carrying `undefined` answers `getCallSignatures() === []` for the
 * same structural reason a union carrying `undefined` answers no
 * `__smithersResult` brand. Measured: `const list = [capability]; hof(list[0] as
 * () => unknown)` stopped resolving `capability`, so the caller lost its `Db`
 * row and its SMITHERS1303 callback contract and drew SMITHERS1101 instead —
 * one option, two walks, one cause. Routing both through this function is what
 * keeps a third walk from regrowing the same bug.
 */
function expressionTypeAt(expression: ts.Expression, checker: ts.TypeChecker): ts.Type {
  if (ts.isElementAccessExpression(expression)) {
    const narrowed = unwidenedIndexedAccessType(expression, checker);
    if (narrowed) return narrowed;
  }
  return checker.getTypeAtLocation(expression);
}

function unwidenedIndexedAccessType(
  access: ts.ElementAccessExpression,
  checker: ts.TypeChecker,
): ts.Type | undefined {
  const accessType = checker.getTypeAtLocation(access);
  const present = checker.getNonNullableType(accessType);
  if (present === accessType) return undefined;
  const containerType = checker.getTypeAtLocation(access.expression);
  const indexType = checker.getIndexTypeOfType(containerType, ts.IndexKind.Number) ??
    checker.getIndexTypeOfType(containerType, ts.IndexKind.String);
  // No index information means nothing here can tell an option-added
  // `| undefined` from an authored one, and an index type that is already
  // nullable means the author wrote it. Both leave the reported type alone.
  if (!indexType || checker.getNonNullableType(indexType) !== indexType) return undefined;
  return present;
}

/**
 * Whether an element read's `| undefined` was added by
 * `noUncheckedIndexedAccess` and has been seen through by the provenance walk.
 *
 * The lowering asks this because it has to ASSERT in the emitted TypeScript what
 * the provenance walk PROVED about the authored `.sm`. `found[0]!` over a
 * `Result<A, E>[]` lowers to `__vsInspectResult(found[0])`, and the emitted
 * module set is checked by a stock TypeScript under the same mandatory options —
 * where `found[0]` is `Result<A, E> | undefined` and `__vsInspectResult` takes a
 * `Result<A, E>`, so the generated program was rejected with TS2345 even though
 * the authored program is legal. The emitted `!` is TypeScript's own non-null
 * assertion, in generated TypeScript, which is the one place in this compiler
 * where that meaning still exists: compatibility.mdx removes it from `.sm`, not
 * from the language `.sm` lowers to.
 */
export function isUnwidenedIndexedAccess(expression: ts.Expression, model: SemanticModel): boolean {
  return ts.isElementAccessExpression(expression) &&
    unwidenedIndexedAccessType(expression, model.checker) !== undefined;
}

export function semanticExpressionShape(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  seenSymbols = new Set<ts.Symbol>(),
): TypeShape {
  // A type-level wrapper leaves the channel alone: `f() satisfies Result<A, E>`
  // is still the same call in the same channel. The table is shared; see
  // `typeOnlyWrapperOperand`. `!` is NOT in it and keeps its own branch below,
  // because it genuinely changes the channel.
  const unwrapped = typeOnlyWrapperOperand(expression);
  if (unwrapped) return semanticExpressionShape(unwrapped, checker, callEdges, seenSymbols);
  if (ts.isElementAccessExpression(expression)) {
    const narrowed = unwidenedIndexedAccessType(expression, checker);
    if (narrowed) return shapeOfType(narrowed, checker);
  }
  if (ts.isNonNullExpression(expression)) {
    const operand = semanticExpressionShape(expression.expression, checker, callEdges, seenSymbols);
    // `!` extracts from a Result. `Promise<Result<A, E>>` is a Promise, not a
    // Result — type-system.mdx: "Awaiting the call removes only the Promise
    // layer" — so `!` alone cannot extract from one, and treating it as an
    // extraction would hand the caller a plain value that is really an
    // un-awaited Promise.
    if (operand.channel.startsWith("result") && !operand.async) {
      return {
        channel: "plain",
        async: false,
        failures: new Set(),
        // `!` removes the FAILURE channel and nothing else. The requirement row
        // survives the extraction, exactly as `successType` does: propagating a
        // failure out of a call does not discharge the capabilities that call
        // needed.
        requirements: operand.requirements,
        successType: operand.successType,
      };
    }
    // The validation pass reports SMITHERS1207 for this removed TypeScript
    // assertion meaning. Preserve the operand shape here so no later analysis
    // can accidentally treat the invalid assertion as a successful extraction.
    return operand;
  }
  if (ts.isAwaitExpression(expression)) {
    const inner = semanticExpressionShape(expression.expression, checker, callEdges, seenSymbols);
    return { ...inner, async: false };
  }
  // A tagged template is an invocation, so it has the shape of what its tag
  // hands back: `` tag`bad` `` where `tag` returns `Result<string, Boom>` drops
  // a Result on the floor exactly as `tag(parts)` does, and must-consume has to
  // see it.
  if (ts.isCallExpression(expression) || ts.isTaggedTemplateExpression(expression)) {
    const edge = callEdges.get(expression);
    if (edge?.callee) {
      const callee = edge.callee;
      const channel = effectiveChannel(callee);
      return {
        channel,
        async: callee.async,
        failures: edge.instantiatedFailures ?? callee.failures,
        // The INFERRED row of the resolved callee, which is strictly better
        // information than the declared one whenever the callee's body is in
        // this compilation — and it always is on this arm, because that is what
        // `edge.callee` means.
        requirements: edge.instantiatedRequirements ?? callee.requirements,
        successType: callee.declaredShape.successType,
      };
    }
    if (edge?.foreign && edge.foreign.kind !== "never" && !edge.authoredBoundary) {
      const original = shapeOfType(checker.getTypeAtLocation(expression), checker);
      const failures = new Set<string>();
      addForeignFailures(failures, edge.foreign);
      // A foreign boundary is by definition not a `.sm` declaration this
      // compiler emitted, so it publishes no row of its own.
      return {
        channel: "result",
        async: edge.foreign.async,
        failures,
        requirements: NO_REQUIREMENTS,
        successType: original.successType,
      };
    }
    // **G7.** No edge: `collectFacts` records one only when the callee resolves
    // locally, is foreign, or is a panic exit, so a call into a `.d.ts` THIS
    // COMPILER EMITTED records nothing and used to fall through to a bare type
    // with the empty row. The declaration published its own row; read it.
    if (ts.isCallExpression(expression)) {
      const declared = declaredRequirementRow(checker.getResolvedSignature(expression)?.declaration);
      if (declared.size > 0) {
        return { ...shapeOfType(checker.getTypeAtLocation(expression), checker), requirements: declared };
      }
    }
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    if (symbol && !seenSymbols.has(symbol)) {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        seenSymbols.add(symbol);
        return semanticExpressionShape(declaration.initializer, checker, callEdges, seenSymbols);
      }
    }
  }
  return shapeOfType(checker.getTypeAtLocation(expression), checker);
}

export function expressionShape(expression: ts.Expression, model: SemanticModel): TypeShape {
  return semanticExpressionShape(expression, model.checker, model.callEdges);
}

export function isResultPropagationExpression(
  expression: ts.NonNullExpression,
  model: SemanticModel,
): boolean {
  return isResultPropagation(expression, model.checker, model.callEdges);
}

/**
 * Postfix `!` propagates only from a `Result` operand.
 *
 * `Promise<Result<A, E>>` is not one: compatibility.mdx locks "postfix `!`
 * requires a `Result` operand", and type-system.mdx locks that `await` is what
 * removes the Promise layer. `(await lookup(k))!` is the spelling that works;
 * `lookup(k)!` is a non-Result operand and is refused with SMITHERS1207, the
 * same way every other non-Result operand is.
 */
function isResultPropagation(
  expression: ts.NonNullExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): boolean {
  const shape = semanticExpressionShape(expression.expression, checker, callEdges);
  return shape.channel.startsWith("result") && !shape.async;
}

function isRetiredResultUnwrap(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): boolean {
  const selection = calleeSelection(call, checker);
  if (!selection || selection.name !== "unwrap" || call.arguments.length !== 0) return false;
  return semanticExpressionShape(selection.receiver, checker, callEdges).channel.startsWith("result");
}

function isExpectSyntax(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  return calleeSelection(call, checker)?.name === "expect";
}

/** @internal The receiver of an `expect` call, for the lowering pass. */
export function expectReceiver(call: ts.CallExpression, checker: ts.TypeChecker): ts.Expression | undefined {
  return isExpectSyntax(call, checker) ? calleeSelection(call, checker)!.receiver : undefined;
}

function isResultExpectCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): boolean {
  const selection = calleeSelection(call, checker);
  if (!selection || selection.name !== "expect") return false;
  return semanticExpressionShape(selection.receiver, checker, callEdges).channel.startsWith("result");
}

export function isResultExpectExpression(call: ts.CallExpression, model: SemanticModel): boolean {
  return isResultExpectCall(call, model.checker, model.callEdges);
}

/** An authored `Result.try(...)` / `Result.tryPromise(...)` call on the prelude `Result` value. */
function isPreludeResultBoundaryCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call, checker);
  if (!selection) return false;
  const method = selection.name;
  if (method !== "try" && method !== "tryPromise") return false;
  const receiver = selection.receiver;
  if (!ts.isIdentifier(receiver) || receiver.text !== "Result") return false;
  const symbol = unalias(checker.getSymbolAtLocation(receiver), checker);
  return Boolean(symbol?.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile())));
}

/** The inline callback whose body an authored `Result.try`/`tryPromise` boundary owns. */
function isAuthoredResultBoundaryBody(node: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  const parent = node.parent;
  return ts.isCallExpression(parent) && parent.arguments[0] === node &&
    isPreludeResultBoundaryCall(parent, checker);
}

type ProducedKind = "plain" | "result" | "promise" | "promise-result";

function producedKind(expression: ts.Expression, checker: ts.TypeChecker, edges: ReadonlyMap<InvocationExpression, CallEdge>): ProducedKind {
  const shape = semanticExpressionShape(expression, checker, edges);
  if (shape.async) return shape.channel.startsWith("result") ? "promise-result" : "promise";
  return shape.channel.startsWith("result") ? "result" : "plain";
}

function checkMustConsume(
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const references = collectReferences(sourceFile, checker);
  const variableChecked = new Set<ts.Symbol>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) {
      const kind = producedKind(node, checker, callEdges);
      if (kind !== "plain" && !producerConsumed(node, kind, checker, callEdges, references)) {
        diagnostics.push(at(node, sourceFile, kind === "result" ? "SMITHERS1301" : "SMITHERS1402",
          kind === "result"
            ? "Result value is not consumed; return, match, transform, inspect, or propagate it with postfix !"
            : "started Promise is not consumed with await, return, or an awaited recognized combinator"));
      }
    }
    if (ts.isNewExpression(node) && isPromiseType(checker.getTypeAtLocation(node), checker)) {
      if (!producerConsumed(node, "promise", checker, callEdges, references)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1402", "started Promise is not consumed with await, return, or an awaited recognized combinator"));
      }
    }
    // The receiving half of a container transfer; see `heldObligation`. A
    // producer that hands back a CONTAINER of Results or started Promises is
    // charged for it exactly as one that hands back a Result is, and the same
    // `bindingConsumes`/`collectionConsumed` surface decides its fate — so
    // `Result.all(pack())` and `pack()[0]!` stay clean while `pack().length`
    // and a bound `const arr = pack()` nobody reads out of are refused.
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const held = heldObligation(node, checker, callEdges, references);
      if (held && !ownershipConsumed(node, true, {
        kind: held,
        checker,
        edges: callEdges,
        fromProducer: true,
        seen: new Set(),
        references,
      })) {
        diagnostics.push(at(node, sourceFile, held === "result" ? "SMITHERS1301" : "SMITHERS1402",
          held === "result"
            ? "this call hands back a collection of Results that is not consumed; read one back out with postfix !, pass the collection to Result.all, or return it"
            : "this call hands back started Promises that are not consumed; await a recognized Promise combinator over the collection, or return it"));
      }
    }
    if (ts.isAwaitExpression(node)) {
      const awaited = semanticExpressionShape(node.expression, checker, callEdges);
      if (awaited.async && awaited.channel.startsWith("result") &&
        !producerConsumed(node, "result", checker, callEdges, references)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1301", "await removes only Promise; the resulting Result must still be returned, matched, transformed, inspected, or propagated with postfix !"));
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
      const kind = producedKind(node.initializer, checker, callEdges);
      if (symbol && kind !== "plain" && !variableChecked.has(symbol)) {
        variableChecked.add(symbol);
        const usages = (references.get(symbol) ?? []).filter((identifier) => identifier !== node.name);
        const consumed = usages.some((identifier) => referenceConsumes(identifier, kind, checker, callEdges, references));
        if (!consumed) {
          diagnostics.push(at(node.name, sourceFile, kind === "result" ? "SMITHERS1302" : "SMITHERS1403",
            kind === "result"
              ? `Result '${node.name.text}' is never consumed`
              : `Promise '${node.name.text}' is never consumed with await or return`));
        }
      }
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
      const kind = producedKind(node.name, checker, callEdges);
      const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
      if (symbol && kind === "result" && !variableChecked.has(symbol)) {
        variableChecked.add(symbol);
        const usages = (references.get(symbol) ?? []).filter((identifier) => identifier !== node.name);
        if (!usages.some((identifier) => referenceConsumes(identifier, kind, checker, callEdges, references))) {
          diagnostics.push(at(node.name, sourceFile, "SMITHERS1302", `Result parameter '${node.name.text}' is never consumed`));
        }
      }
    }
    if (ts.isNonNullExpression(node)) {
      const owner = nearestFunction(node);
      const info = owner && functionByNode.get(owner);
      if (isResultPropagation(node, checker, callEdges)) {
        if (!info || (!info.declaredShape.channel.startsWith("result") && info.failures.size === 0)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1202", "postfix ! propagation requires an enclosing Result-returning function"));
        } else if (repeatedlyEvaluatedPosition(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1703", "postfix ! propagation in a loop condition or incrementor is evaluated once per iteration, and the shipped lowering hoists its failure exit in front of the loop, which would run it a different number of times; assign before the loop or propagate inside its body"));
        } else if (conditionallyEvaluatedPosition(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1204", "postfix ! in a conditionally evaluated operand would have its failure exit hoisted to the enclosing statement by the shipped lowering, which would run it when the authored program would not have evaluated the operand at all; assign the Result to a local and propagate it unconditionally"));
        } else if (precededByUnhoistedEffect(node, checker, callEdges)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1204", "postfix ! after another effect in the same statement would have its failure exit hoisted in front of that effect by the shipped lowering, which would evaluate this operand too early; assign the Result to a local first, or propagate before the other effect"));
        }
      } else {
        diagnostics.push(at(
          node,
          sourceFile,
          "SMITHERS1207",
          "postfix ! requires a Result operand; TypeScript non-null assertions are unavailable in .sm",
        ));
      }
    }
    if (ts.isCallExpression(node) && isRetiredResultUnwrap(node, checker, callEdges)) {
      diagnostics.push(at(
        node,
        sourceFile,
        "SMITHERS1206",
        "Result.unwrap() is no longer the propagation spelling; use postfix !",
      ));
    }
    if (ts.isCallExpression(node) && isResultExpectCall(node, checker, callEdges)) {
      // `expect` lowers to the same hoisted guard as `!`, so it inherits the
      // same two residual positions and nothing else. See
      // `conditionallyEvaluatedPosition`.
      if (repeatedlyEvaluatedPosition(node)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1703", "Result.expect() in a loop condition or incrementor is evaluated once per iteration, and the shipped lowering hoists its panic exit in front of the loop, which would run it a different number of times; assign before the loop or expect inside its body"));
      } else if (conditionallyEvaluatedPosition(node)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1204", "Result.expect() in a conditionally evaluated operand would have its panic exit hoisted to the enclosing statement by the shipped lowering, which would run it when the authored program would not have evaluated the operand at all; assign the Result to a local and expect it unconditionally"));
      } else if (precededByUnhoistedEffect(node, checker, callEdges)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1204", "Result.expect() after another effect in the same statement would have its panic exit hoisted in front of that effect by the shipped lowering, which would evaluate this receiver too early; assign the Result to a local first, or expect before the other effect"));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectReferences(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Map<ts.Symbol, ts.Identifier[]> {
  const result = new Map<ts.Symbol, ts.Identifier[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = unalias(checker.getSymbolAtLocation(node), checker);
      if (symbol) {
        const values = result.get(symbol) ?? [];
        values.push(node);
        result.set(symbol, values);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/**
 * The container literal a value in `current` is STORED INTO, or undefined.
 *
 * Array and tuple elements, spreads of either kind, and object-literal property
 * values. A shorthand property (`{ r }`) is an identifier reference and reaches
 * the same place through `referenceConsumes`.
 */
function containerLiteralFor(current: ts.Node, parent: ts.Node): ts.Expression | undefined {
  if (ts.isArrayLiteralExpression(parent)) return parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === current &&
    ts.isObjectLiteralExpression(parent.parent)) return parent.parent;
  if (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent)) return parent.parent;
  if (ts.isSpreadAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) return parent.parent;
  return undefined;
}

/**
 * Whether a type still carries a must-consume channel — a Result or a started
 * Promise — somewhere inside it.
 *
 * This is what decides whether a container literal really STORES the value it
 * was handed. `return [make("ada")]` from a `Result<number, Missing>[]`
 * function stores it: the array's own type carries the channel, so ownership
 * moves to the array. `return [shout("hello")]` from a `string[]` function
 * does NOT: `shout` is an untrusted foreign call the compiler LIFTS to
 * `Result<string, Panic>` while its declaration still says `string`, so the
 * array's type is `string[]` and the checked failure is dropped on the way in.
 * That is a discard however it is spelled, and it stays SMITHERS1301
 * (09-foreign-calls/foreign-module-without-a-trust-marker pins it).
 *
 * Imprecision here is fail-closed in both directions: a false answer refuses at
 * the element, a true answer keeps the obligation alive and refuses unless a
 * real consumption follows.
 */
function holdsProducedChannel(type: ts.Type, checker: ts.TypeChecker, depth = 0): boolean {
  return heldChannel(type, checker, depth) !== undefined;
}

/**
 * WHICH must-consume channel a type still carries, or undefined for none.
 *
 * `holdsProducedChannel` is this same walk read as a yes/no. The answer has to
 * name the channel because it is asked at BOTH ends of an ownership transfer
 * and the two ends need the same diagnostic: a container of Results is a
 * SMITHERS1301 when it is dropped and a container of started Promises is a
 * SMITHERS1402, exactly as the direct producers are.
 *
 * A started Promise wins over a Result inside it (`Promise<Result<A, E>>` is a
 * Promise) because `await` is what removes the Promise layer, and the un-awaited
 * value is the more urgent obligation — `specification/type-system.mdx`,
 * "Awaiting the call removes only the Promise layer".
 */
function heldChannel(type: ts.Type, checker: ts.TypeChecker, depth = 0): "result" | "promise" | undefined {
  if (depth > 3) return undefined;
  if (type.isUnion() || type.isIntersection()) {
    for (const member of type.types) {
      const held = heldChannel(member, checker, depth + 1);
      if (held) return held;
    }
    return undefined;
  }
  const shape = shapeOfType(type, checker);
  if (shape.async) return "promise";
  if (shape.channel.startsWith("result")) return "result";
  if (checker.isArrayType(type) || checker.isTupleType(type) || checker.isArrayLikeType(type)) {
    for (const argument of typeArguments(type, checker)) {
      const held = heldChannel(argument, checker, depth + 1);
      if (held) return held;
    }
    return undefined;
  }
  // Only object LITERAL shapes are scanned member by member. A nominal class
  // or interface instance is never the container literal this test is asked
  // about, and walking every member of one (`Console`, a DOM type) would cost
  // far more than the answer is worth. Not scanning it answers "no", which is
  // the refusing direction.
  if ((type.flags & ts.TypeFlags.Object) === 0) return undefined;
  if (((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) === 0) return undefined;
  for (const property of checker.getPropertiesOfType(type)) {
    const held = heldChannel(checker.getTypeOfSymbol(property), checker, depth + 1);
    if (held) return held;
  }
  return undefined;
}

/**
 * The obligation a PRODUCER hands its receiver as a CONTAINER — a value that is
 * not itself a Result or a started Promise but still holds one — or undefined
 * when it hands none.
 *
 * This is the receiving half of the transfer `ownershipConsumed` performs when a
 * `return` discharges a stored collection. That discharge is only sound if
 * somebody is charged on the other side, and until this existed nobody was:
 * `producedKind` answers `"plain"` for `readonly Result<A, E>[]`, so a callee
 * that moved its Results into a container and returned them had its obligation
 * cancelled and the caller never inherited it. `save(2)` could throw
 * `SaveFailed`, the failure never reach the row, never be consumed, and the
 * program exit 0 reporting success — on both backends.
 *
 * It is deliberately the COMPLEMENT of the transfer rule rather than a widening
 * of it. `07-must-consume/a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard`
 * pins that a store transfers ownership only when the CONTAINER'S OWN TYPE still
 * carries the channel; this asks the same question of the value a call hands
 * back, so a call whose declared type has dropped the channel — the lifted
 * `number[]` in that case — is charged at the element as it always was, never
 * here.
 *
 * Three producers are excluded, each because charging them would double-report
 * one mistake or contradict a settled site:
 *
 *   * a value that IS a Result or a `Promise<Result>` — already charged by the
 *     direct rule above, at this very position;
 *   * a started Promise that was never consumed — likewise already charged
 *     (SMITHERS1402), so its container is not a second diagnostic;
 *   * a recognized `Promise` combinator, which `collectionConsumed` already
 *     defines as OWNING everything handed to it. Its product is therefore the
 *     consumed one, and `07-must-consume/the-ambient-promise-all-discharges-a-bound-promise`
 *     pins that `await Promise.all([started])` followed by `.map(consume)` is a
 *     complete program.
 */
function heldObligation(
  producer: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<InvocationExpression, CallEdge>,
  references: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>,
): ProducedKind | undefined {
  const kind = producedKind(producer, checker, edges);
  if (kind === "result" || kind === "promise-result") return undefined;
  const type = checker.getTypeAtLocation(producer);
  let carried = type;
  if (kind === "promise") {
    if (!producerConsumed(producer, kind, checker, edges, references)) return undefined;
    if (isRecognizedPromiseCombinatorCall(producer, checker)) return undefined;
    carried = promisedType(type, checker) ?? type;
  }
  return heldChannel(carried, checker);
}

/** Shared state for one ownership walk. */
interface OwnershipWalk {
  readonly kind: ProducedKind;
  readonly checker: ts.TypeChecker;
  readonly edges: ReadonlyMap<InvocationExpression, CallEdge>;
  /** True for the walk that starts at the producer, false for a reference. */
  readonly fromProducer: boolean;
  /** Bindings already followed, so a self-referential chain terminates. */
  readonly seen: Set<ts.Symbol>;
  /** Identifier occurrences by symbol; absent when the caller has no index. */
  readonly references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>;
}

/**
 * Does the obligation on a produced Result/Promise get discharged from here?
 *
 * The specification's rule is that a Result MUST NOT be *silently discarded*
 * "without returning, matching, transforming, inspecting, or unwrapping it"
 * (failures.mdx) and that "an ignored Result MUST be a compile error"
 * (type-system.mdx). Neither forwarding a value nor storing it is a discard, so
 * the walk climbs to whichever enclosing value the produced value BECOMES and
 * lets that value's position answer. Two kinds of climb:
 *
 *   FORWARDING — the enclosing expression IS the value: parentheses,
 *   `as`/`satisfies`/`<T>` assertions, either branch of a conditional, and the
 *   concise body of an arrow (which is a `return` spelled without the keyword;
 *   the braced form has always discharged here). Kind and obligation unchanged.
 *
 *   STORAGE — the value is placed into a container literal that really carries
 *   the channel (`holdsProducedChannel`). Ownership moves to the container,
 *   which is a COLLECTION of Results rather than a Result, so `!` and the
 *   receiver consumers no longer apply to it; `collection` records the
 *   transfer and `collectionConsumed` decides the collection's fate. This is
 *   what specification compatibility.mdx promises when it says `arr[i]!`
 *   "compiles only when `arr` holds Results": building the array is not the
 *   discard, and reading an element back out with `!` is the consumption.
 *
 * A stored collection does NOT escape by being bound: `bindingConsumes` walks
 * the binding's own references, so `const arr = [make()]` that is never
 * consumed is still refused at the element positions, exactly as before.
 */
function ownershipConsumed(start: ts.Node, held: boolean, walk: OwnershipWalk): boolean {
  const { kind, checker, edges } = walk;
  let current: ts.Node = start;
  let collection = held;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;

    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) || ts.isTypeAssertionExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && (parent.whenTrue === current || parent.whenFalse === current)) {
      current = parent;
      continue;
    }
    if (ts.isNonNullExpression(parent) && parent.expression === current) {
      // `!` discharges a Result by extracting from it. On anything else — a
      // collection, or an un-awaited `Promise<Result<…>>` — it extracts
      // nothing (SMITHERS1207 reports that separately), so the value passes
      // through unchanged and its position still has to answer.
      if (!collection && kind === "result") return true;
      current = parent;
      continue;
    }

    // `await` removes only the Promise layer. A COLLECTION that was waiting
    // inside one is still owed afterwards — type-system.mdx says exactly this
    // of `Promise<Result<A, E>>`: "Awaiting the call removes only the Promise
    // layer" — so the obligation forwards to the awaited value's position
    // instead of ending at the await. A Result or a Promise in its own right
    // does NOT come here: awaiting one of those is a discharge and is decided
    // by the kind-specific rules below, unchanged.
    if (collection && ts.isAwaitExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }

    // Storage transfers ownership only when the container really stores the
    // channel; see `holdsProducedChannel`. When it does not, nothing moved and
    // the ordinary rules below decide, exactly as they did before this walk
    // understood containers at all.
    const container = containerLiteralFor(current, parent);
    if (container && holdsProducedChannel(checker.getTypeAtLocation(container), checker)) {
      current = container;
      collection = true;
      continue;
    }

    if (ts.isReturnStatement(parent)) return !collection || transferReachesCaller(parent, checker);
    // A concise arrow body is a return: the obligation lands on this
    // function's contract and therefore on its callers.
    if (isSupportedFunctionLike(parent) && parent.body === current) {
      return !collection || transferReachesCaller(parent, checker);
    }

    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      if (collection) return bindingConsumes(parent, walk);
      // Binding a Result names it; the binding's own SMITHERS1302 check then
      // owns it. Re-binding a Result THROUGH a reference discharges nothing,
      // which is why only the producer walk stops here.
      if (walk.fromProducer) return true;
    } else if (collection) {
      return collectionConsumed(current, parent, walk);
    } else if (kind === "promise" || kind === "promise-result") {
      if (ts.isAwaitExpression(parent)) return true;
      if (isInsideRecognizedPromiseCombinator(current, checker)) {
        return combinatorConsumed(current, checker, edges, walk.references);
      }
    } else if (kind === "result") {
      if (walk.fromProducer && memberSelection(parent, checker)?.receiver === current &&
        ts.isCallExpression(parent.parent) && parent.parent.expression === parent &&
        isRetiredResultUnwrap(parent.parent, checker, edges)) return true;
      if (isConsumedResultReceiver(current, parent, checker)) return true;
      if (isInsideResultAll(current, checker)) return true;
    }
    return false;
  }
}

/**
 * Does returning this COLLECTION actually hand the obligation to the caller?
 *
 * A `return` is not a discharge; it is a TRANSFER, and a transfer conserves the
 * obligation only when the value that leaves is one the receiving side is
 * charged for. For a Result or a Promise that is automatic — the caller's own
 * SMITHERS1301/1402 is charged at the call. For a container it is a question,
 * and it is the SAME question `heldObligation` asks of the call: does the type
 * the caller receives still carry a must-consume channel?
 *
 * Asking one predicate at both ends is what makes the two halves agree by
 * construction. `function f(): unknown { return [make()] }` is the shape that
 * proves it matters: the array literal really does hold the channel, so the
 * store transfers, but `unknown` is what the caller sees and no rule can charge
 * it — the obligation would leave the callee and arrive nowhere, which is
 * precisely the laundering this pair of rules exists to stop.
 *
 * An unresolvable signature answers `true`, keeping the acceptance this rule had
 * before it existed: a refusal we cannot justify is the over-correcting
 * direction, and the producer side stays fail-closed regardless because a caller
 * whose type still carries the channel is charged there.
 */
function transferReachesCaller(node: ts.Node, checker: ts.TypeChecker): boolean {
  const owner = isSupportedFunctionLike(node) ? node : nearestFunction(node);
  if (!owner) return false;
  const signature = checker.getSignatureFromDeclaration(owner);
  if (!signature) return true;
  return holdsProducedChannel(checker.getReturnTypeOfSignature(signature), checker);
}

/**
 * A collection of Results reached a binding: the obligation follows the
 * binding, so at least one of its references must consume it.
 *
 * A destructuring pattern scatters the elements into bindings this analysis
 * does not track, so the obligation stays where it is rather than being
 * silently released.
 */
function bindingConsumes(declaration: ts.VariableDeclaration, walk: OwnershipWalk): boolean {
  if (!ts.isIdentifier(declaration.name) || !walk.references) return false;
  const symbol = unalias(walk.checker.getSymbolAtLocation(declaration.name), walk.checker);
  if (!symbol || walk.seen.has(symbol)) return false;
  walk.seen.add(symbol);
  return (walk.references.get(symbol) ?? []).some((identifier) =>
    identifier !== declaration.name && ownershipConsumed(identifier, true, { ...walk, fromProducer: false }));
}

/**
 * The discharge surface for a COLLECTION that holds Results or Promises.
 *
 * Deliberately narrow: only the sites the specification settles. A recognized
 * collection combinator (`Result.all`, the ambient `Promise` combinators) owns
 * everything handed to it, and reading a held value back out puts the
 * obligation onto the value that was read — which is exactly the `arr[i]!`
 * spelling compatibility.mdx promises compiles. Everything else — `arr.length`,
 * `for (const r of arr)`, handing the array to a user function — still refuses,
 * unchanged from before this rule existed, because no specification sentence
 * says what consuming a collection means at those sites.
 */
function collectionConsumed(current: ts.Node, parent: ts.Node, walk: OwnershipWalk): boolean {
  const { checker, edges } = walk;
  if (isInsideResultAll(current, checker)) return true;
  if (isInsideRecognizedPromiseCombinator(current, checker)) {
    return combinatorConsumed(current, checker, edges, walk.references);
  }
  if ((!ts.isPropertyAccessExpression(parent) && !ts.isElementAccessExpression(parent)) ||
    parent.expression !== current) return false;
  const shape = semanticExpressionShape(parent, checker, edges);
  if (shape.channel.startsWith("result")) {
    const kind: ProducedKind = shape.async ? "promise-result" : "result";
    return ownershipConsumed(parent, false, { ...walk, kind, fromProducer: false });
  }
  return holdsProducedChannel(checker.getTypeAtLocation(parent), checker) &&
    ownershipConsumed(parent, true, walk);
}

function producerConsumed(
  expression: ts.Expression,
  kind: ProducedKind,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<InvocationExpression, CallEdge>,
  references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>,
): boolean {
  return ownershipConsumed(expression, false,
    { kind, checker, edges, fromProducer: true, seen: new Set(), references });
}

function referenceConsumes(
  identifier: ts.Identifier,
  kind: ProducedKind,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<InvocationExpression, CallEdge>,
  references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>,
): boolean {
  return ownershipConsumed(identifier, false,
    { kind, checker, edges, fromProducer: false, seen: new Set(), references });
}

/**
 * The locked receiver surface that discharges a Result ownership obligation.
 *
 * Matched by MEMBER SPELLING, and soundly so, because every caller has already
 * established that the RECEIVER is a compiler-owned Result-channel value. The
 * only question left is which member of a value that is already the compiler's
 * was selected. Contrast `isInsideResultAll`, where the receiver is not
 * established and the spelling test was a real fail-open.
 *
 * Declaration identity is not available here, unlike in the Go backend, which
 * recognizes this surface AFTER lowering where the checker sees a real
 * `Result<A, E>`. This analyzer runs on the AUTHORED `.sm` source, where a
 * lifted call still carries its authored success type, and a strict test
 * demonstrably reports false SMITHERS1301s in two different ways:
 *
 *   - the member resolves NOWHERE — `helper("x").unwrap()` on a foreign
 *     JavaScript import whose declared return type is `number`; and, worse,
 *   - the member resolves to the WRONG declaration — for an unannotated
 *     function inferred as `Result<string, Missing>`, `lookup("ada").match(...)`
 *     resolves to `String.prototype.match` in lib.es5.d.ts, a perfectly real
 *     symbol that is simply not the compiler's.
 *
 * Both are ordinary authored programs; the second is a conformance case. So the
 * receiver surface stays on spelling, deliberately, and the security property
 * comes from the receiver precondition rather than from the member name.
 *
 * The spellings are DERIVED from `RESULT_MEMBER_SIGNATURES`, the same table the
 * prelude interface is generated from, so the set the checker declares and the
 * set the ownership walk discharges cannot disagree. Hand-maintaining both is
 * what left `flatten` and `tapBoth` implemented on the runtime and unreachable
 * from `.sm`. Every declared instance member discharges: each one either
 * inspects the Result, transforms it into another Result that carries its own
 * obligation, or eliminates it.
 */
const RESULT_CONSUMERS: ReadonlySet<string> = new Set(RESULT_MEMBER_SIGNATURES.map(resultMemberName));

// A callback that RETURNS a Result used to need its own recognized-combinator
// list here, because only `andThen`/`recover` flatten what their callback
// returns. That list only ever governed the CONCISE arrow spelling: the braced
// `(v) => { return lookup(v) }` has always discharged through the ordinary
// return rule, in every callback position, so the two spellings of the same
// function disagreed. The ownership walk now treats a concise body as the
// return it is, which is what makes them agree. The residual — returning an
// unconsumed Result into a callback whose contract discards it, such as
// `forEach` — is unchanged by that, predates it in the braced spelling, and is
// a rule about `return` rather than about arrow syntax.

/**
 * Members of the compiler-owned `Result` namespace value that discharge an
 * obligation for the Results passed to them. `try`/`tryPromise` are excluded:
 * they ADOPT a throw scope rather than consuming an already-computed Result.
 */
const RESULT_NAMESPACE_CONSUMERS = new Set(["all"]);

/**
 * The prelude declaration a member name resolves to, or undefined when the
 * member is not declared by this analyzer's own prelude. Authority is checker
 * symbol identity, so a user object with a same-spelled member resolves to its
 * own declaration and can never stand in for a compiler-owned combinator.
 */
function preludeMemberDeclaration(
  selection: MemberSelection,
  checker: ts.TypeChecker,
): ts.MethodSignature | undefined {
  const declaration = selectedMemberSymbol(selection, checker)?.declarations
    ?.find((candidate) => isCompilerPrelude(candidate.getSourceFile()));
  return declaration !== undefined && ts.isMethodSignature(declaration) && ts.isIdentifier(declaration.name)
    ? declaration
    : undefined;
}

/**
 * A member of the prelude's `Result` namespace value (`declare const Result`).
 * A user object with an `all` member never matches here.
 */
function isPreludeResultNamespaceMember(
  selection: MemberSelection,
  checker: ts.TypeChecker,
  members: ReadonlySet<string>,
): boolean {
  const declaration = preludeMemberDeclaration(selection, checker);
  if (declaration === undefined || !ts.isTypeLiteralNode(declaration.parent)) return false;
  const owner = declaration.parent.parent;
  return ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) && owner.name.text === "Result" &&
    members.has((declaration.name as ts.Identifier).text);
}

function isConsumedResultReceiver(current: ts.Node, parent: ts.Node, checker: ts.TypeChecker): boolean {
  const selection = memberSelection(parent, checker);
  return selection !== undefined && selection.receiver === current &&
    RESULT_CONSUMERS.has(selection.name) &&
    ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
}

/**
 * An argument of the compiler-owned `Result.all(...)`.
 *
 * Resolved to the prelude's own declaration, never to the spelling `Result`.
 * This is the one discharge site with NO receiver precondition — nothing else
 * has established that the callee is the compiler's — so a user's
 * `const Result = { all: (x) => x }` previously satisfied the obligation and an
 * unconsumed Result escaped with no SMITHERS1301/SMITHERS1302. The Go backend
 * resolves the same site through `resultNamespaceCall`, i.e. prelude
 * declaration identity, and is correct.
 */
function isInsideResultAll(node: ts.Node, checker: ts.TypeChecker): boolean {
  let current = node;
  while (ts.isArrayLiteralExpression(current.parent) || ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(current as ts.Expression)) return false;
  const selection = calleeSelection(parent, checker);
  return selection !== undefined &&
    isPreludeResultNamespaceMember(selection, checker, RESULT_NAMESPACE_CONSUMERS);
}

/**
 * The ambient `Promise` global, resolved to its TypeScript library declaration.
 *
 * The same rule `isInsideResultAll` applies to the compiler's own `Result`
 * namespace, for the same reason: this is a discharge site with no receiver
 * precondition, so the spelling alone decided it. A local
 * `const Promise = { async all(values) { return values } }` shadows the global,
 * returns a real Promise — which defeats the `promisedType` test below on its
 * own — and previously discharged a must-consume Promise obligation.
 */
function isAmbientPromiseNamespace(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(node) || node.text !== "Promise") return false;
  return Boolean(unalias(checker.getSymbolAtLocation(node), checker)?.declarations
    ?.some((declaration) => isTypeScriptLibrary(declaration.getSourceFile())));
}

const PROMISE_COMBINATORS = ["all", "allSettled", "race", "any", "allKeyed", "allSettledKeyed"];

/**
 * A call OF a recognized ambient `Promise` combinator, resolved to the
 * TypeScript library's own `Promise` and not to a local of the same spelling.
 * One list, asked from two directions: `isInsideRecognizedPromiseCombinator`
 * asks whether a value is being handed TO one, and `heldObligation` asks whether
 * a value came OUT of one.
 */
function isRecognizedPromiseCombinatorCall(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (!ts.isCallExpression(node)) return false;
  const selection = calleeSelection(node, checker);
  if (!selection || !isAmbientPromiseNamespace(selection.receiver, checker)) return false;
  return PROMISE_COMBINATORS.includes(selection.name) &&
    Boolean(promisedType(checker.getTypeAtLocation(node), checker));
}

function isInsideRecognizedPromiseCombinator(node: ts.Node, checker: ts.TypeChecker): boolean {
  let current = node;
  while (ts.isArrayLiteralExpression(current.parent) || ts.isObjectLiteralExpression(current.parent) || ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(current as ts.Expression)) return false;
  return isRecognizedPromiseCombinatorCall(parent, checker);
}

function combinatorConsumed(
  node: ts.Node,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<InvocationExpression, CallEdge>,
  references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>,
): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const selection = ts.isCallExpression(current) ? calleeSelection(current, checker) : undefined;
    if (selection && isAmbientPromiseNamespace(selection.receiver, checker)) {
      return producerConsumed(current as ts.CallExpression, "promise", checker, edges, references);
    }
    current = current.parent;
  }
  return false;
}

function isPromiseType(type: ts.Type, checker: ts.TypeChecker): boolean {
  return Boolean(promisedType(type, checker));
}

/**
 * The residue of the withdrawn placement rule, narrowed to what is still true.
 *
 * `specification/failures.mdx` §Refusal Conditions withdrew the statement-walk:
 * the failure exit is a delegated suspension, which is an expression in every
 * position, so no *placement* is unsound in principle. What survives is not a
 * rule about placement but a fact about the SHIPPED lowering, which spells that
 * exit as an early `return` and therefore has to hoist a guard to the enclosing
 * statement. Hoisting is only order-preserving where the operand is evaluated
 * unconditionally and exactly once, so exactly two positions are still refused:
 *
 *   * a conditionally evaluated operand — the right side of `&&`, `||` and `??`,
 *     either arm of a ternary, anything after an optional-chaining `?.`, and a
 *     `case` label expression, whose guard would run when the authored program
 *     would not have evaluated the operand at all;
 *   * a repeated loop header — a `while`/`do`/`for` condition or a `for`
 *     incrementor, whose guard would run a different number of times. Measured:
 *     hoisting `while (next()!) {}` produces a program that never terminates.
 *
 * Everything else the old walk refused — a member call, an element access, a
 * call argument, a compound operand, a `for` initializer, a `for…of` iterable —
 * is unconditional and once, and is now accepted.
 *
 * These two were deliberately never scoped to the `effectLowering` option, and
 * they SURVIVE its deletion. That option only ever selected the convention for
 * the DEPENDENCY half of the row; failure propagation is still lowered as an
 * early `return` of the error variant in every function, because
 * `isResumableFunction` takes only functions whose `failures` row is empty. So
 * the hoisting these two refuse is still real, and they retire when the failure
 * exit becomes a delegated suspension — not when the option went away.
 */
function conditionallyEvaluatedPosition(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent && !ts.isStatement(current.parent) && !isSupportedFunctionLike(current.parent)) {
    const parent = current.parent;
    if (ts.isBinaryExpression(parent) && parent.right === current &&
      (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      return true;
    }
    if (ts.isConditionalExpression(parent) && parent.condition !== current) return true;
    // Anything to the right of a `?.` link is skipped when the link short-circuits.
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent) ||
      ts.isCallExpression(parent)) && parent.questionDotToken !== undefined &&
      (parent as { expression: ts.Node }).expression !== current) {
      return true;
    }
    // A `case` label runs only until one matches, and the switch lowering puts a
    // prologue in front of the whole `switch`.
    if (ts.isCaseClause(parent)) return true;
    current = parent;
  }
  return false;
}

/**
 * The third residue, and the one the withdrawn walk was hiding rather than
 * stating: a guard hoisted to the front of the statement jumps over anything to
 * its LEFT that is not hoisted with it.
 *
 * `g() + r!` lowers to `const t = inspect(r); if (!t.ok) return …; g() + t.value`,
 * which calls `r`'s producer BEFORE `g()`. The old walk refused it as a
 * "placement", which is why the reordering never had to be described. It is not
 * a placement fact: `scoreOf("a")! + scoreOf("b")!` is the same shape and is
 * order-preserving, because BOTH guards hoist and they hoist in authored order.
 *
 * So the condition is about what precedes, not about where the `!` sits: every
 * expression evaluated before it, within the enclosing statement, must be free
 * of effects the lowering leaves behind. A nested propagation counts as free —
 * its own receiver hoists in order — while anything wrapping one does not.
 */
function precededByUnhoistedEffect(
  node: ts.Node,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): boolean {
  let current: ts.Node = node;
  while (current.parent && !isSupportedFunctionLike(current.parent)) {
    const parent = current.parent;
    let reached = false;
    let blocked = false;
    ts.forEachChild(parent, (child) => {
      if (child === current) reached = true;
      else if (!reached && unhoistedEffectIn(child, checker, callEdges)) blocked = true;
    });
    if (blocked) return true;
    if (ts.isStatement(parent)) return false;
    current = parent;
  }
  return false;
}

/** @see precededByUnhoistedEffect */
function unhoistedEffectIn(
  subtree: ts.Node,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    // Creating a closure evaluates nothing inside it.
    if (isSupportedFunctionLike(node)) return;
    if (ts.isNonNullExpression(node) && isResultPropagation(node, checker, callEdges)) return;
    if (ts.isCallExpression(node) && isResultExpectCall(node, checker, callEdges)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node) ||
      ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isDeleteExpression(node) ||
      (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken))) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(subtree);
  return found;
}

/** @see conditionallyEvaluatedPosition */
function repeatedlyEvaluatedPosition(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (isSupportedFunctionLike(parent)) return false;
    if (ts.isWhileStatement(parent) || ts.isDoStatement(parent)) return current === parent.expression;
    if (ts.isForStatement(parent)) return current === parent.condition || current === parent.incrementor;
    // A `for…of`/`for…in` iterable is evaluated ONCE, before the first
    // iteration, so hoisting its guard in front of the loop preserves both the
    // order and the count. The withdrawn walk refused it anyway.
    if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) return false;
    current = parent;
  }
  return false;
}

/**
 * A failure exit unwinds the delimited computation. `finally` blocks and `using`
 * disposals run on the way out; `catch` clauses do not, because the failure is
 * never delivered through the JavaScript exception channel. The authored text
 * would read as though the failure were catchable when it is not, so the
 * placement is a hard error rather than a silently dead catch path.
 *
 * `specification/failures.mdx` §Refusal Conditions keeps this rule while
 * retiring the placement and loop-header rules beside it: those two were
 * properties of the withdrawn early-`return` lowering, and this one is a
 * property of the authored text.
 */
function checkJavaScriptCatchBoundaries(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<InvocationExpression, CallEdge>,
  diagnostics: PendingDiagnostic[],
): void {
  const visit = (node: ts.Node, caughtByJavaScript: boolean): void => {
    if (node !== sourceFile && isSupportedFunctionLike(node)) {
      // A nested function is its own propagation owner; its early returns do
      // not bypass this catch clause.
      ts.forEachChild(node, (child) => visit(child, false));
      return;
    }
    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, caughtByJavaScript || Boolean(node.catchClause));
      if (node.catchClause) visit(node.catchClause.block, caughtByJavaScript);
      if (node.finallyBlock) visit(node.finallyBlock, caughtByJavaScript);
      return;
    }
    if (caughtByJavaScript && ts.isNonNullExpression(node) && isResultPropagation(node, checker, callEdges)) {
      diagnostics.push(at(
        node,
        sourceFile,
        "SMITHERS1205",
        "postfix ! propagation inside a JavaScript try statement with a catch clause is not lowered because the failure exit unwinds the computation past this catch clause: finally blocks and using disposals still run, catch never observes the failure, and delivering it as a thrown exception is prohibited; move the propagation point outside the try or consume the value explicitly",
      ));
    }
    if (caughtByJavaScript && ts.isCallExpression(node)) {
      const construct = callEdges.get(node)?.panicExit
        ? "panic(...)"
        : isResultExpectCall(node, checker, callEdges)
          ? "Result.expect()"
          : undefined;
      if (construct) {
        // Deliberately NOT the postfix-! sentence. A panic exit is lowered two
        // ways — a completion value where the enclosing contract names `Panic`,
        // an unwinding throw where it does not — so a message that asserted one
        // of them would be false for the other half of the programs this arm
        // fires on. What is true of both is that an ordinary `catch` is the
        // wrong observer.
        diagnostics.push(at(node, sourceFile, "SMITHERS1205", `${construct} inside a JavaScript try statement with a catch clause is not lowered because a panic exit is not a recoverable failure this catch may observe: where the enclosing contract materializes the panic the exit is a completion value the catch never sees, and where it does not the catch would swallow an abort that must reach an explicit panic boundary; move the panic point outside the try or handle it at that boundary`));
      }
    }
    ts.forEachChild(node, (child) => visit(child, caughtByJavaScript));
  };
  visit(sourceFile, false);
}

function checkAuthoredApis(sourceFile: ts.SourceFile, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  const visit = (node: ts.Node): void => {
    const selection = memberSelection(node, checker);
    if (selection && ts.isIdentifier(selection.receiver)) {
      const owner = selection.receiver.text;
      if (owner === "Result" && ["ok", "err", "error", "success"].includes(selection.name)) {
        const symbol = checker.getSymbolAtLocation(selection.receiver);
        if (!symbol || symbol.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile()))) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1201", `${owner}.${selection.name} is a compiler hook, not an author-facing constructor; use ordinary return/throw lifting`));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  checkCompilerResultConstructors(sourceFile, checker, diagnostics);
}

/**
 * The compiler-owned Result variant constructors, by the export names the
 * runtime publishes them under.
 *
 * `__vsResultSuccess`/`__vsResultFailure` are the emitter's lowering hooks, and
 * `RuntimeValues` is the namespace `poc/src/runtime/values.ts` documents as
 * being for hand-written TypeScript *below* the language: "It is not
 * re-exported into any author-visible namespace and must never be re-exported
 * under a name a Smithers author could reach."
 *
 * It is reached. Every compiler-intrinsic specifier resolves to the runtime
 * index, and the index re-exports all three, so `import { __vsResultSuccess }
 * from "smthrs/context"` let authored `.sm` hand-build both Result variants with
 * zero diagnostics — measured, executed, and it printed both. The set below is
 * that invariant made checkable rather than documented.
 */
const COMPILER_RESULT_CONSTRUCTORS: ReadonlySet<string> = new Set([
  "__vsResultSuccess",
  "__vsResultFailure",
  "RuntimeValues",
]);

/**
 * Refuse a value binding in authored `.sm` that reaches a compiler-owned Result
 * variant constructor through a compiler-intrinsic module specifier.
 *
 * specification/failures.mdx, "Compiler Lifting" (Locked): "Authors MUST NOT
 * need to write `Result.ok(...)` or `Result.err(...)`. Those constructors MUST
 * NOT be part of the ordinary Smithers authoring API." SMITHERS1201 already
 * carries that sentence for the `Result.ok(...)` spelling; this is the same
 * sentence at the spelling where the constructor is reached by NAME instead of
 * through the `Result` namespace. A Result the compiler did not construct at a
 * checked exit has a failure channel that means nothing, so what the rule is
 * about is the constructor being reachable — not the module name that reached
 * it.
 *
 * The refusal is anchored on the compiler-intrinsic specifier registry, so an
 * author's own module exporting an identically named binding is never reached:
 * only `smthrs/context`, `smthrs/provider`, `smithers:exceptions` and their
 * siblings are consulted, and the imported name compared is the module's own
 * export name — the `propertyName` of a rename, so `__vsResultSuccess as ok` is
 * refused exactly like the plain spelling.
 *
 * The frontend prelude declares a NARROW surface for each of those specifiers
 * (`smthrs/context` publishes only `Context`), which is why nothing here can be
 * proved from the analysis program's module symbol: the analysis never sees the
 * runtime's real export list, and the emitter rewrites the specifier onto the
 * whole runtime index afterwards. That gap between the declared surface and the
 * emitted one is exactly what this rule closes.
 *
 * Type-only bindings are left alone: they initialize nothing and construct
 * nothing, which is the same line every other module rule draws.
 */
function checkCompilerResultConstructors(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const namespaceBindings = new Set<ts.Symbol>();
  const refuse = (node: ts.Node, name: string): void => {
    diagnostics.push(at(
      node,
      sourceFile,
      "SMITHERS1201",
      `${name} is a compiler-owned Result constructor, not an author-facing one; ordinary return and throw lifting construct the variants`,
    ));
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(specifier) || !isCompilerIntrinsicSpecifier(specifier.text)) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        const symbol = checker.getSymbolAtLocation(bindings.name);
        if (symbol) namespaceBindings.add(symbol);
        continue;
      }
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        const imported = (element.propertyName ?? element.name).text;
        if (COMPILER_RESULT_CONSTRUCTORS.has(imported)) refuse(element.name, imported);
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !isCompilerIntrinsicSpecifier(specifier.text)) continue;
    if (statement.isTypeOnly || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const exported = (element.propertyName ?? element.name).text;
      if (COMPILER_RESULT_CONSTRUCTORS.has(exported)) refuse(element.name, exported);
    }
  }

  if (namespaceBindings.size === 0) return;
  // A namespace import binds the whole module, so the constructor is named at
  // the member read instead. The receiver is matched by symbol identity, never
  // by the local name the author chose for the namespace.
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
      COMPILER_RESULT_CONSTRUCTORS.has(node.name.text)
    ) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol && namespaceBindings.has(symbol)) refuse(node.name, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function isErrorMatchCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call, checker);
  if (!selection || !["match", "matchPartial"].includes(selection.name)) return false;
  return isErrorType(checker.getTypeAtLocation(selection.receiver), checker);
}

/**
 * The row identity an `Error.match` case label selects. The label is an
 * ordinary in-scope value binding, so it is resolved at the handler object's
 * location; an unresolvable label keeps its authored text and is reported by
 * the ordinary missing/extra-case rules.
 */
function errorCaseRowName(label: ts.Identifier, location: ts.Node, checker: ts.TypeChecker): string {
  const symbol = unalias(checker.resolveName(label.text, location, ts.SymbolFlags.Value, false), checker);
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  if (!declaration?.name) return label.text;
  return rowNameForSymbol(
    unalias(checker.getSymbolAtLocation(declaration.name), checker),
    declaration.name.text,
    checker,
  );
}

function checkErrorMatches(sourceFile: ts.SourceFile, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isErrorMatchCall(node, checker)) {
      const selected = memberSelection(node.expression, checker)!.name;
      const partial = selected === "matchPartial";
      const handlers = node.arguments[0];
      if (!handlers || !ts.isObjectLiteralExpression(handlers)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1251", `Error.${selected} requires an object literal so nominal cases can be checked and lowered`));
      } else {
        const actual = new Set<string>();
        let valid = true;
        for (const member of handlers.properties) {
          if ((ts.isPropertyAssignment(member) || ts.isMethodDeclaration(member)) && member.name &&
            ts.isIdentifier(member.name)) {
            // A case label is the in-scope binding of the Error class, which
            // may be an import alias. Compare nominal row identities, not the
            // authored spelling, so module-qualified rows stay exhaustive.
            actual.add(errorCaseRowName(member.name, handlers, checker));
          } else {
            valid = false;
          }
        }
        if (!valid) diagnostics.push(at(handlers, sourceFile, "SMITHERS1252", "Error match cases must use static Error class names and function handlers"));
        if (!partial) {
          const expected = errorNamesOfType(
            checker.getTypeAtLocation(memberSelection(node.expression, checker)!.receiver), checker);
          const missing = difference(expected, actual);
          const extra = difference(actual, expected);
          if (missing.size > 0) diagnostics.push(at(handlers, sourceFile, "SMITHERS1253", `Error.match is not exhaustive; missing ${formatSet(missing)}`));
          if (extra.size > 0) diagnostics.push(at(handlers, sourceFile, "SMITHERS1254", `Error.match has cases outside the checked union: ${formatSet(extra)}`));
        } else if (node.arguments.length !== 2) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1255", "Error.matchPartial requires an explicit fallback(error) callback as its second argument"));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function checkDuplicateErrorNames(sourceFile: ts.SourceFile, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  const seen = new Map<string, ts.ClassDeclaration>();
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name && node.heritageClauses?.length &&
      isErrorType(checker.getTypeAtLocation(node.name), checker)) {
      const prior = seen.get(node.name.text);
      if (prior) {
        diagnostics.push(at(node.name, sourceFile, "SMITHERS1150", `duplicate Error class name '${node.name.text}' cannot receive a stable module-local identity in this POC`));
      } else {
        seen.set(node.name.text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

interface ScannedToken {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function startsRetiredStatement(previous: string | undefined): boolean {
  return previous === undefined || previous === "{" || previous === "}" || previous === ";" || previous === ":";
}

function startsRetiredValue(tokens: readonly ScannedToken[], index: number): boolean {
  return ["=", "return", "[", "=>", "?", "+", "-", "*", "/", "%", "&&", "||", "??"]
    .includes(tokens[index - 1]?.text ?? "");
}

function isRetiredValueLabel(tokens: readonly ScannedToken[], index: number): boolean {
  if (tokens[index]?.kind !== ts.SyntaxKind.Identifier || tokens[index + 1]?.text !== ":") return false;
  const next = tokens[index + 2]?.text;
  return startsRetiredValue(tokens, index) &&
    (next === "{" || next === "while" || next === "for" || next === "do");
}

function matchingTokenBackward(
  tokens: readonly ScannedToken[],
  closeIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index--) {
    if (tokens[index]?.text === close) depth++;
    if (tokens[index]?.text === open && --depth === 0) return index;
  }
  return -1;
}

/** Recognize `label: while/for (...) { ... } else value` in statement position. */
function isRetiredLoopElse(tokens: readonly ScannedToken[], elseIndex: number): boolean {
  if (tokens[elseIndex]?.text !== "else" || tokens[elseIndex - 1]?.text !== "}") return false;
  const bodyOpen = matchingTokenBackward(tokens, elseIndex - 1, "{", "}");
  if (bodyOpen < 2 || tokens[bodyOpen - 1]?.text !== ")") return false;
  const headerOpen = matchingTokenBackward(tokens, bodyOpen - 1, "(", ")");
  if (headerOpen < 3 || (tokens[headerOpen - 1]?.text !== "while" && tokens[headerOpen - 1]?.text !== "for")) {
    return false;
  }
  const label = headerOpen - 3;
  return tokens[headerOpen - 2]?.text === ":" && tokens[label]?.kind === ts.SyntaxKind.Identifier &&
    !isRetiredValueLabel(tokens, label);
}

function checkRemovedAndUnsupportedSyntax(
  source: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  recovery: RecoveredSource,
  diagnostics: PendingDiagnostic[],
): void {
  const tokens = scanSource(source);
  const explicitOffsets: number[] = [...recovery.rejectedStarts];
  const removed = (token: ScannedToken, message: string): void => {
    explicitOffsets.push(token.start);
    diagnostics.push({ severity: "error", code: "SMITHERS1001", message, start: token.start });
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (token.text === "error" && next?.kind === ts.SyntaxKind.Identifier && tokens[index + 2]?.text === "{" &&
      !hasLineBreakBetween(source, token, next)) {
      // `error Name {` is a declaration header written on one line. Two
      // adjacent identifiers with no line terminator between them are never
      // legal TypeScript, so this cannot claim an ASI-separated statement pair
      // such as `error` / `Missing` / `{ ... }`.
      removed(token, "the historical `error Name {}` declaration was removed; declare an ordinary `class Name extends Error`");
    }
    if ((token.text === "throws" || token.text === "uses") && previous?.text !== "." &&
      !isMemberNameOccurrence(tokens, index) && endsReturnType(previous) &&
      next?.kind === ts.SyntaxKind.Identifier && isBetweenFunctionParametersAndBody(tokens, index)) {
      // The retired clause is a suffix on a complete return type and names a
      // right operand (`throws Missing`, `uses Clock`). A type spelled `uses`
      // inside type arguments or a union — `Array<uses>`, `string | throws` —
      // has neither shape.
      removed(token, token.text === "throws"
        ? "the `throws` row grammar was removed; declare Result<A, E> in public contracts and let local functions infer it"
        : "the named `uses` grammar was removed; extend Context and call Capability.context()");
    }
    if (token.text === "!" && previous?.text === ":" &&
      (tokens[index - 2]?.text === ")" || next?.text === "?" ||
        TYPE_ONLY_KEYWORDS.has(next?.text ?? ""))) {
      // A return-type colon (`): !string`), the `!?T` pair, or a type-keyword
      // operand. Without those the `!` is an ordinary logical negation in a
      // value position — `{ ok: !failed }` and `flag ? a : !b` both put a `!`
      // directly after a colon and neither is retired grammar.
      removed(token, "the `!T` return marker was removed; use Result<T, E>");
    }
    if (token.text === "!" && next?.text === ":" &&
      (previous?.kind === ts.SyntaxKind.Identifier || previous?.kind === ts.SyntaxKind.PrivateIdentifier)) {
      removed(token, "the definite-assignment assertion x!: T is unavailable in .sm; initialize or narrow the binding explicitly");
    }
    if (token.text === "?" && (previous?.text === ":" ||
      (previous?.text === "!" && tokens[index - 2]?.text === ":")) && next && /^[A-Za-z_$]/.test(next.text)) {
      removed(token, "the `?T` type grammar was removed; use T | undefined");
    }
    if (token.text === "orelse" && previous?.text !== "." &&
      !isMemberNameOccurrence(tokens, index) &&
      tokenEndsExpression(previous?.kind) && beginsOperand(next)) {
      // `orelse` is a binary operator, so it needs both operands. `orelse` is
      // also an ordinary identifier: `const orelse = 1`, `{ orelse }`,
      // `{ orelse: 7 }`, `String(orelse)`, and `orelse()` are all legal.
      removed(token, "the `orelse` operator was removed; use nullish coalescing or ordinary narrowing");
    }
    if (token.text === "." && next?.text === "?") {
      removed(token, "the `.?` postfix operator was removed; use optional chaining or ordinary narrowing");
    }
    if (token.text === "try" && next?.text !== "{" &&
      !isMemberNameOccurrence(tokens, index) && beginsOperand(next)) {
      // The retired prefix marker takes a right operand. `try` is a reserved
      // word, so every other legal spelling is a property name: the public
      // `Result.try(...)` API, `{ try: adapt }`, `{ try() {} }`, and
      // `interface I { try: T }`.
      removed(token, "the prefix `try` propagation marker was removed; use postfix !");
    }
    if (token.text === "catch" && previous?.text !== "}" &&
      !isMemberNameOccurrence(tokens, index) &&
      tokenEndsExpression(previous?.kind) && beginsOperand(next)) {
      // The retired postfix form takes both operands: `compute(k) catch alt`.
      // Statement-form `try { } catch { }` has no left operand, and a Promise
      // `.catch(...)` member access is rejected by the Promise discipline
      // pass, not misreported as retired grammar.
      removed(token, "the postfix catch expression was removed; recover with Result.match() or recover()");
    }
    if ((token.text === "defer" || token.text === "errdefer") &&
      startsRetiredStatement(previous?.text) && next?.kind === ts.SyntaxKind.Identifier) {
      removed(token, token.text === "defer"
        ? "the defer statement was withdrawn; use an explicit resource-management using declaration"
        : "the errdefer statement was withdrawn; write cleanup explicitly in the Result failure path");
    }
    if (token.text === "break" && next?.text === ":" &&
      tokens[index + 2]?.kind === ts.SyntaxKind.Identifier && beginsOperand(tokens[index + 3])) {
      removed(token, "the break :label value grammar was withdrawn; labeled breaks do not carry values");
    }
    if (isRetiredLoopElse(tokens, index)) {
      removed(token, "the loop else completion grammar was withdrawn; loops retain TypeScript statement behavior");
    }
    if ((token.text === "if" || token.text === "switch") && startsRetiredValue(tokens, index)) {
      removed(token, `expression-position ${token.text} grammar was withdrawn; use existing TypeScript expressions`);
    }
    if (isRetiredValueLabel(tokens, index)) {
      removed(token, "expression-position labeled block and loop grammar was withdrawn; labels remain statements");
    }
  }

  // Switch clauses are colon-delimited, exactly as in TypeScript. The
  // specification's Switch section requires the TypeScript `switch`/`case`/
  // `default` grammar and states that Smithers MUST NOT introduce a separate
  // arrow-arm switch grammar, so `case x => v` is not a Smithers form in any
  // position — and neither is a clause with no separator at all.
  //
  // TypeScript's parser recovers both by pretending the colon was written,
  // leaving the recovered clause indistinguishable from `case x: v` in the
  // tree. Re-read the separator gap so malformed ordinary switches cannot
  // silently pass through parser recovery.
  const visitSwitchClauseGrammar = (node: ts.Node): void => {
    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const separator = clauseSeparatorDefect(node, source, sourceFile);
      if (separator) {
        explicitOffsets.push(separator.start);
        diagnostics.push({
          severity: "error",
          code: "SMITHERS1000",
          message: "source does not match the supported .sm grammar: " + (separator.arrow
            ? "switch clauses are colon-delimited exactly as in TypeScript; there is no arrow-arm switch form"
            : "a switch `case`/`default` clause must be delimited by `:`"),
          start: separator.start,
        });
      }
    }
    ts.forEachChild(node, visitSwitchClauseGrammar);
  };
  visitSwitchClauseGrammar(sourceFile);

  const parseFailure = parseDiagnosticsFailure(sourceFile);
  if (parseFailure) diagnostics.push(parseFailure);
  for (const diagnostic of internalParseDiagnostics(sourceFile) ?? []) {
    const start = diagnostic.start ?? 0;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (explicitOffsets.some((offset) => Math.abs(offset - start) < 48)) continue;
    diagnostics.push({
      severity: "error",
      code: "SMITHERS1000",
      message: `source does not match the supported .sm grammar: ${message}`,
      start,
    });
  }

  const visitUnsupportedAst = (node: ts.Node): void => {
    if (ts.isClassStaticBlockDeclaration(node)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1107", "class `static {}` initialization blocks execute outside every checked function channel and are not analyzed or lowered by this POC; use static field initializers or an explicit checked function"));
    }
    ts.forEachChild(node, visitUnsupportedAst);
  };
  visitUnsupportedAst(sourceFile);

  checkHostGlobals(sourceFile, checker, diagnostics);
  checkForeignModuleInitializers(sourceFile, checker, diagnostics);
}

/**
 * Where a switch clause's `:` should have been, when something else is written
 * there instead; `undefined` for every clause the grammar accepts.
 *
 * TypeScript's parser reports "':' expected." and then continues as though the
 * colon had been written, so neither the arrow of `case x => v` nor the absent
 * separator of `case x v` survives in any node of the tree. Only a rescan of
 * the gap between the clause header and its first statement recovers them.
 * Scanning (rather than searching the text) is what keeps `case x /* => *\/: v`
 * an ordinary clause, and taking only the FIRST significant token is what keeps
 * an arrow function inside a clause value — `case x: (() => v)()` — and an
 * arrow type in a nearby annotation out of the rule.
 */
function clauseSeparatorDefect(
  clause: ts.CaseOrDefaultClause,
  source: string,
  sourceFile: ts.SourceFile,
): { readonly start: number; readonly arrow: boolean } | undefined {
  const headerEnd = ts.isCaseClause(clause)
    ? clause.expression.end
    : clause.getStart(sourceFile) + "default".length;
  const bodyStart = clause.statements.length > 0
    ? clause.statements[0]!.getStart(sourceFile)
    : clause.end;
  if (bodyStart <= headerEnd || bodyStart > source.length) return undefined;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
    undefined,
    headerEnd,
    bodyStart - headerEnd,
  );
  const token = scanner.scan();
  if (token === ts.SyntaxKind.ColonToken) return undefined;
  if (token === ts.SyntaxKind.EndOfFileToken) {
    // Nothing at all between the header and the body: `case "a" "alpha"`. A
    // clause with no statements is instead one the parser closed at its header
    // (`case "a"` before the block's `}`), and the parser's own "':' expected"
    // already reports that one outside any suppression window.
    return clause.statements.length > 0
      ? { start: clause.statements[0]!.getStart(sourceFile), arrow: false }
      : undefined;
  }
  return { start: scanner.getTokenStart(), arrow: token === ts.SyntaxKind.EqualsGreaterThanToken };
}


/**
 * A checked call boundary cannot observe an exception thrown while ESM is
 * linking/evaluating its static dependency graph.  Keep that separate hazard
 * fail-closed: a runtime foreign module must make an explicit, file-leading
 * trust claim before a `.sm` module can load it statically.
 *
 * The DYNAMIC spelling of the same foreign edge is the same hazard.  A rule
 * about module initialization may not be escapable by re-spelling the edge: the
 * initializer of `import("./untrusted.ts")` runs before any call boundary
 * exists exactly as the static one does, and this pass refused the static edge
 * to the byte-identical module.  Its own message already tells authors where a
 * dynamic foreign edge belongs — behind a checked async foreign adapter — and a
 * trusted thin foreign module performing `import()` inside its own `.ts` body is
 * unaffected, because this pass only ever reads `.sm`.
 *
 * What stays available is what `docs/DECISIONS.md:266` locks: a dynamic import
 * of another PROJECT module, and of a foreign module that carries the trust
 * claim, are both ordinary.  Only an untrusted foreign edge, and an edge whose
 * destination this compiler cannot resolve at all, are refused.  A compiler-owned
 * dynamic ASSET import carries import attributes and is owned by the source-asset
 * pass, which reports its own 52xx codes; it is excluded here so a malformed
 * asset request keeps its precise diagnostic instead of gaining a cascade.
 *
 * The rule is about the modules module evaluation REACHES, not about the ones
 * the `.sm` happens to name.  Until 2026-08-27 this pass read only
 * `sourceFile.statements` of the authored `.sm`, so a foreign module at depth
 * two or more was never asked for a marker at all: a properly marked relay
 * doing `export { danger } from "./sneaky.ts"` conferred its own trust on an
 * `./sneaky.ts` carrying no marker, a miscased one, a `//` line comment, a
 * plain block comment, or an NBSP-spelled one.  Measured on both backends with
 * a module-scope oracle in `sneaky.ts`: the program compiled clean and the
 * untrusted initializer RAN, at depth 2, at depth 3, around a cycle and through
 * a diamond.  `src/relative-runtime-graph.ts` — the CLI's own walk — has always
 * computed the reached-module closure and refused these, which is why the
 * shipped product was never affected and no corpus case could be written for
 * the hole; `compileProject` is a public API and `smithersc-go` is invoked
 * directly, so "the CLI wrapper covers it" is not the language having the rule.
 *
 * The closure below is that walk, brought to the place that defines the
 * language.  It seeds on the trusted depth-one targets the loop above just
 * accepted, keeps the graph's own boundary — RELATIVE edges, the ones this
 * compilation resolves, places and emits — and follows exactly the edges module
 * evaluation takes, as `foreignModuleInitializationEdges` decides.
 *
 * Two things it deliberately does not do.  An untrusted module found at depth
 * one is refused and NOT walked into: the program is already rejected at the
 * edge the author wrote, and a cascade of its dependencies' markers adds
 * nothing.  And a non-relative depth-one edge — an absolute path, a package
 * name — is still asked for its own marker and is still refused without one,
 * but seeds no closure, because a specifier this compilation did not lay out is
 * outside the relative runtime graph on both walks.  That boundary is what
 * keeps the compiler's own runtime out of the rule: `runtime/introspection.ts`
 * carries the module claim precisely so authored `.sm` may call the brand seam,
 * while `runtime/result.ts` and `runtime/panic.ts` deliberately carry none —
 * their unmarkedness is the forgery guarantee recorded in
 * `runtime/introspection.ts`'s own header, not an oversight, and demanding a
 * marker there would put a `Result` constructor one import away from authored
 * `.sm`.  Measured: `poc/src/language/capability-seams.test.ts` SEAM 3 is the
 * case that says so.
 */
function checkForeignModuleInitializers(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const refuse = (at_: ts.Node, specifierText: string | undefined, target: ts.SourceFile | undefined): void => {
    const named = specifierText === undefined ? "the dynamically selected module" : `'${specifierText}'`;
    const detail = target
      ? `${named} (${target.fileName}) does not declare a leading JSDoc containing both @module and @throws {never}`
      : `${named} could not be resolved to a module carrying a leading JSDoc containing both @module and @throws {never}`;
    diagnostics.push(at(
      at_,
      sourceFile,
      "SMITHERS1510",
      `foreign module initialization can panic before a checked call boundary; ${detail}; use a type-only import, add the trusted marker, or put dynamic import behind a checked async foreign adapter`,
    ));
  };

  /**
   * The trusted foreign modules this `.sm` loads directly, in the order it
   * names them, each remembered with the authored edge that reached it. Every
   * transitive refusal is reported against that authored edge, because it is
   * the only text in this file the author can change and the position every
   * other `SMITHERS1510` case in the corpus already declares.
   */
  const trustRoots: Array<{ readonly site: ts.Node; readonly named: string; readonly target: ts.SourceFile }> = [];
  const rememberRoot = (site: ts.Node, specifierText: string | undefined, target: ts.SourceFile): void => {
    // Only a RELATIVE edge seeds the closure, for the reason
    // `walkReachedForeignModules` gives for stopping at one: the closure IS the
    // relative runtime graph, and a specifier that is not relative names code
    // this compilation does not lay out. `resolveEdge` returns such an edge with
    // no target and `staticInitializationRoots` never receives it, so the two
    // walks agree on the boundary as well as on the rule inside it. The
    // depth-one marker check above is unaffected and still asks EVERY resolvable
    // target for its claim, relative or not; what a non-relative edge does not
    // do is make this compiler responsible for a whole foreign subtree it did
    // not resolve, place or emit.
    if (specifierText === undefined || !specifierText.startsWith(".")) return;
    trustRoots.push({ site, named: `'${specifierText}'`, target });
  };

  for (const statement of sourceFile.statements) {
    const edge = staticRuntimeModuleEdge(statement);
    if (!edge || isCompilerIntrinsicSpecifier(edge.specifier.text)) continue;

    const target = resolvedModuleSourceFile(edge.specifier, checker);
    if (target && isSmithersSemanticSourceFile(target.fileName)) continue;
    if (target && !isTypeScriptOrJavaScriptSourceFile(target.fileName)) continue;
    if (target && hasLeadingModuleNoThrowMarker(target)) {
      rememberRoot(edge.specifier, edge.specifier.text, target);
      continue;
    }

    refuse(edge.specifier, edge.specifier.text, target);
  }

  const visitDynamic = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      // An import call carrying import attributes is an asset request. The
      // source-asset pass owns it — including a malformed one, whose precise
      // 52xx diagnostic must not gain a module-trust cascade.
      if (specifier !== undefined && node.arguments.length < 2) {
        if (ts.isStringLiteral(specifier) && isCompilerIntrinsicSpecifier(specifier.text)) {
          // fall through to the children
        } else {
          const target = ts.isStringLiteral(specifier) ? resolvedModuleSourceFile(specifier, checker) : undefined;
          const foreign = target !== undefined && !isSmithersSemanticSourceFile(target.fileName) &&
            isTypeScriptOrJavaScriptSourceFile(target.fileName);
          const trusted = target !== undefined && (!foreign || hasLeadingModuleNoThrowMarker(target));
          if (!trusted) {
            refuse(specifier, ts.isStringLiteral(specifier) ? specifier.text : undefined, target);
          } else if (foreign) {
            // Awaiting this import evaluates the target module and everything
            // its own evaluation reaches, so the trusted claim it carries is a
            // claim about that whole subgraph exactly as a static edge's is.
            rememberRoot(specifier, ts.isStringLiteral(specifier) ? specifier.text : undefined, target!);
          }
        }
      }
    }
    ts.forEachChild(node, visitDynamic);
  };
  visitDynamic(sourceFile);

  walkReachedForeignModules(sourceFile, checker, diagnostics, trustRoots);
}

/**
 * Ask every module the trusted roots reach for the same marker the roots
 * carried, and refuse the ones that do not have it.
 *
 * `answered` spans all roots, so a module reached through two paths (a diamond)
 * is decided once and reported once, against the first authored edge that
 * reaches it; a cycle terminates for the same reason. The walk is breadth-first
 * in source order at every level, so the diagnostics a program produces do not
 * depend on map iteration order.
 *
 * Three edges deliberately end the walk rather than continue it, and each
 * matches what `src/relative-runtime-graph.ts` already does:
 *
 * - **a compiler-intrinsic specifier** is compiler-owned and has no foreign
 *   initializer;
 * - **a `.sm` module** is a project module this same pass is checking in its
 *   own right, and a foreign module may not import one anyway;
 * - **a non-relative specifier** (`node:fs`, a package, a bare name) is outside
 *   the relative runtime graph entirely. `resolveEdge` returns such an edge
 *   with no target and the closure never adds it, so this walk stops there too
 *   rather than inventing a rule for package code that the CLI does not apply.
 *
 * A RELATIVE initialization edge whose destination this compiler cannot resolve
 * is refused, not skipped. That is not a new rule: it is the second branch of
 * `refuse` above — the one the authored `.sm` has always taken for its own
 * unresolvable edges — applied at the depth the author cannot see. The graph is
 * harder still and aborts the compilation outright.
 */
function walkReachedForeignModules(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  trustRoots: readonly { readonly site: ts.Node; readonly named: string; readonly target: ts.SourceFile }[],
): void {
  const answered = new Set<ts.SourceFile>(trustRoots.map((root) => root.target));
  for (const root of trustRoots) {
    const refuseReached = (reached: string, fault: string, via: readonly ts.SourceFile[]): void => {
      const through = via.length > 0 ? ` (through ${via.map((file) => file.fileName).join(" -> ")})` : "";
      diagnostics.push(at(
        root.site,
        sourceFile,
        "SMITHERS1510",
        "foreign module initialization can panic before a checked call boundary; " +
        `${root.named} loads ${reached} during module initialization${through}, and ${fault}; ` +
        "use a type-only import, add the trusted marker, or put dynamic import behind a checked async foreign adapter",
      ));
    };

    const queue: Array<{ readonly file: ts.SourceFile; readonly via: readonly ts.SourceFile[] }> =
      [{ file: root.target, via: [] }];
    while (queue.length > 0) {
      const { file, via } = queue.shift()!;
      const nextVia = [...via, file];
      for (const specifier of foreignModuleInitializationEdges(file)) {
        if (isCompilerIntrinsicSpecifier(specifier.text)) continue;
        if (!specifier.text.startsWith(".")) continue;
        const target = resolvedModuleSourceFile(specifier, checker);
        if (target === undefined) {
          refuseReached(
            `'${specifier.text}'`,
            "that specifier could not be resolved to a module carrying a leading JSDoc containing " +
            "both @module and @throws {never}",
            via,
          );
          continue;
        }
        if (answered.has(target)) continue;
        if (isSmithersSemanticSourceFile(target.fileName)) continue;
        if (!isTypeScriptOrJavaScriptSourceFile(target.fileName)) continue;
        answered.add(target);
        if (!hasLeadingModuleNoThrowMarker(target)) {
          refuseReached(
            target.fileName,
            "that module does not declare a leading JSDoc containing both @module and @throws {never}",
            via,
          );
          continue;
        }
        queue.push({ file: target, via: nextVia });
      }
    }
  }
}

/**
 * The specifiers one FOREIGN module's own evaluation reaches.
 *
 * The static forms are the same three `staticRuntimeModuleEdge` recognizes in a
 * `.sm`, minus the restriction to top-level statements — a foreign module may
 * write `import`/`export … from` only at module scope anyway, but an
 * `import x = require(…)` inside a namespace is still evaluated on load. The
 * type-only spellings are excluded for the reason they are excluded there: an
 * erased edge has no runtime at all.
 *
 * `import()` and `require()` are governed by
 * `moduleInitializationClassifier`, whose default is "initialization" and whose
 * "deferred" answer must be proven. An import call carrying attributes is an
 * asset request and belongs to the source-asset pass, exactly as in the `.sm`
 * walk above.
 */
function foreignModuleInitializationEdges(sourceFile: ts.SourceFile): readonly ts.StringLiteral[] {
  const specifiers: ts.StringLiteral[] = [];
  const isModuleInitializationEdge = moduleInitializationClassifier(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause?.isTypeOnly && !(clause && allImportBindingsAreTypeOnly(clause))) {
        specifiers.push(node.moduleSpecifier);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly && !allExportBindingsAreTypeOnly(node)) specifiers.push(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier !== undefined && node.arguments.length < 2 && ts.isStringLiteral(specifier) &&
        isModuleInitializationEdge(node)) {
        specifiers.push(specifier);
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === "require" && node.arguments.length === 1) {
      const specifier = node.arguments[0];
      if (specifier !== undefined && ts.isStringLiteral(specifier) && isModuleInitializationEdge(node)) {
        specifiers.push(specifier);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers.sort((left, right) => left.getStart(sourceFile) - right.getStart(sourceFile));
}

/** The value names one module-scope statement introduces, when they are plain identifiers. */
function declaredModuleScopeValueNames(statement: ts.Statement): readonly string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name ? [statement.name.text] : [];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
  }
  return [];
}

function hasExportModifier(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Decide which `import()`/`require()` edges of one foreign module are evaluated
 * while that module is being evaluated. The answer defaults to *yes*, and "no"
 * has to be proven.
 *
 * This is the flag that decides which reached modules must carry the
 * initialization trust marker, so an edge misclassified as deferred is an
 * untrusted foreign initializer running with no diagnostic. "Lexically inside a
 * function" is not the question; "can module evaluation reach this" is —
 * `const l = (() => require(…))()`, a named local function called at module
 * scope, and a module-scope getter read were all measured checking clean and
 * running the untrusted initializer when the question was asked the other way.
 *
 * The proof this walk accepts is deliberately narrow, because it has no
 * cross-module information — a function defers its body only when module-scope
 * code cannot get hold of the function value at all:
 *
 * - the function literal must *be* a module-scope `function`/`class` member
 *   declaration, or the entire initializer of a module-scope `const`/`let`/`var`
 *   binding — anything else (an IIFE, an array element, an object property, an
 *   argument) hands the value to module-scope code, which may call it;
 * - that declaration must be exported, so the module is written to be driven
 *   from outside; and
 * - none of the names it declares may be mentioned by module-scope code, since
 *   a mention is enough to call it.
 *
 * Everything else is an initialization edge. That deliberately refuses some
 * genuinely deferred shapes — a method reached only through a non-exported
 * factory, `module.exports = { load: () => require(…) }`, a lazily read
 * property of an exported object literal — and the escape hatch for each is the
 * one the diagnostic already names: mark the reached module, or load it through
 * a checked async foreign adapter. Refusing a deferred edge asks for a marker;
 * admitting an initialization edge runs untrusted code, so the asymmetry is the
 * whole point.
 *
 * Note also that only a function's BODY and its parameter defaults are
 * evaluated when it is called. Its decorators, computed member name and type
 * annotations are evaluated where the function is written, so an edge sitting
 * in one of those is at module scope even though it is lexically "inside a
 * function", and the climb below keeps walking outward for exactly that case.
 *
 * This is a deliberate mirror of `moduleInitializationClassifier` in
 * `src/relative-runtime-graph.ts` (with `hasExportModifier` and
 * `declaredValueNames`, spelled `declaredModuleScopeValueNames` here because
 * this file already uses the shorter names), kept structurally identical so the
 * two diff cleanly — the same relationship the marker predicate's two copies
 * already have, and recorded there for the same reason. It cannot be an import:
 * the dependency runs root -> `poc/dist`, never the other way, and this package
 * does not export the predicate. If one side moves, move the other in the same
 * shape.
 */
function moduleInitializationClassifier(sourceFile: ts.SourceFile): (node: ts.Node) => boolean {
  let moduleScopeValueNames: Set<string> | undefined;
  const exportedByClause = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || statement.moduleSpecifier) continue;
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (!element.isTypeOnly) exportedByClause.add((element.propertyName ?? element.name).text);
    }
  }

  const collectModuleScopeUses = (): Set<string> => {
    const names = new Set<string>();
    const visit = (node: ts.Node): void => {
      // A type position is erased before anything runs, and an import or export
      // clause names a binding rather than calling it.
      if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ||
        ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isIdentifier(node)) {
        const parent = node.parent as ts.Node & { readonly name?: ts.Node; readonly propertyName?: ts.Node };
        // `{ load }` is a reference written in name position; every other
        // `name`/`propertyName` slot is a declaration or a member label.
        if (ts.isShorthandPropertyAssignment(parent) ||
          (parent.name !== node && parent.propertyName !== node)) names.add(node.text);
        return;
      }
      const body = (node as ts.Node & { readonly body?: ts.Node }).body;
      ts.forEachChild(node, (child) => {
        if (ts.isFunctionLike(node) && child === body) return;
        visit(child);
      });
    };
    visit(sourceFile);
    return names;
  };

  const provablyDeferred = new Map<ts.Node, boolean>();
  const isProvablyDeferred = (fn: ts.Node): boolean => {
    const cached = provablyDeferred.get(fn);
    if (cached !== undefined) return cached;
    provablyDeferred.set(fn, false);
    const parent = fn.parent as ts.Node | undefined;
    let statement: ts.Node | undefined;
    if (ts.isFunctionDeclaration(fn)) statement = fn;
    else if (parent && ts.isClassDeclaration(parent)) statement = parent;
    else if (parent && ts.isVariableDeclaration(parent) && parent.initializer === fn && ts.isIdentifier(parent.name)) {
      statement = parent.parent.parent;
    }
    if (!statement || !statement.parent || !ts.isSourceFile(statement.parent)) return false;
    const declaration = statement as ts.Statement;
    const names = declaredModuleScopeValueNames(declaration);
    if (!hasExportModifier(declaration) && !names.some((name) => exportedByClause.has(name))) return false;
    moduleScopeValueNames ??= collectModuleScopeUses();
    const answer = !names.some((name) => moduleScopeValueNames!.has(name));
    provablyDeferred.set(fn, answer);
    return answer;
  };

  return (node: ts.Node): boolean => {
    let child: ts.Node = node;
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isFunctionLike(current)) {
        const container = current as ts.SignatureDeclaration & { readonly body?: ts.Node };
        const evaluatedOnCall = child === container.body ||
          (ts.isParameter(child) && container.parameters.indexOf(child) >= 0);
        if (evaluatedOnCall && isProvablyDeferred(current)) return false;
      }
      child = current;
      current = current.parent;
    }
    return true;
  };
}

interface StaticRuntimeModuleEdge {
  readonly specifier: ts.StringLiteral;
}

function staticRuntimeModuleEdge(statement: ts.Statement): StaticRuntimeModuleEdge | undefined {
  if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    const clause = statement.importClause;
    if (clause?.isTypeOnly || (clause && allImportBindingsAreTypeOnly(clause))) return undefined;
    return { specifier: statement.moduleSpecifier };
  }
  if (ts.isExportDeclaration(statement) && statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)) {
    if (statement.isTypeOnly || allExportBindingsAreTypeOnly(statement)) return undefined;
    return { specifier: statement.moduleSpecifier };
  }
  if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
    ts.isExternalModuleReference(statement.moduleReference) &&
    statement.moduleReference.expression && ts.isStringLiteral(statement.moduleReference.expression)) {
    return { specifier: statement.moduleReference.expression };
  }
  return undefined;
}

function allImportBindingsAreTypeOnly(clause: ts.ImportClause): boolean {
  return !clause.name && clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function allExportBindingsAreTypeOnly(statement: ts.ExportDeclaration): boolean {
  return Boolean(statement.exportClause && ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length > 0 &&
    statement.exportClause.elements.every((element) => element.isTypeOnly));
}

function isCompilerIntrinsicSpecifier(specifier: string): boolean {
  return COMPILER_INTRINSIC_SPECIFIERS.has(specifier);
}

/**
 * The authoritative set of compiler-owned module specifiers THIS STAGE OWNS.
 *
 * It is not the whole language's registry, and reading it as one is a mistake:
 * `smithers:schema` is compiler-owned and deliberately absent. The comptime
 * stage runs first (`lsp.ts` records the order: assets, comptime, rows,
 * generated TypeScript) and `compileComptimeIntrinsics` lowers every
 * `smithers:schema` import away — including an import that is never used, whose
 * whole statement is dropped — so no import of it survives to be classified
 * here. A `Schema.derive` reference outside `comptime(...)` is refused upstream
 * as VCT1200. The absence is also fail-CLOSED rather than fail-open: feeding a
 * module that imports `smithers:schema` straight to the row stage, skipping
 * comptime, draws SMITHERS1510 (untrusted foreign module), which is the same
 * artifact `lsp.ts` records for skipping the asset stage — a refusal, not an
 * admission.
 *
 * Membership is EXACT. Prefix-matching `smithers:`/`smthrs/` has already been a
 * fail-open twice in this repository — once in the withdrawn portability
 * analyzer (`poc/src/targets/classify.ts`, deleted 2026-08-23 with the
 * portability pin, whose header recorded it), and once in
 * `poc/src/durable/implementation-contract.ts`, which now consumes this set —
 * because a specifier that merely begins with an owned prefix is ordinary
 * foreign code that no registry pins. The lesson outlived the file: this set is
 * the one registry, and a second mirror of it is what let the two drift.
 *
 * `poc/src/language/compile.ts` is NOT a mirror: `isCompilerVirtualModule`
 * answers a different question — which specifiers the emitter rewrites to the
 * runtime import — and `smthrs/schema-runtime` deliberately survives emit.
 */
export const COMPILER_INTRINSIC_SPECIFIERS: ReadonlySet<string> = new Set([
  "smthrs/context",
  "smthrs/provider",
  "smthrs/schema-runtime",
  "smithers:exceptions",
  "smithers:comptime",
  "smithers:flows",
]);

function resolvedModuleSourceFile(
  specifier: ts.StringLiteral,
  checker: ts.TypeChecker,
): ts.SourceFile | undefined {
  const symbol = checker.getSymbolAtLocation(specifier);
  // `PRELUDE_NAME` is a bare basename and every prelude source file is created
  // as `resolve(<dir>, PRELUDE_NAME)`, so the comparison that was here —
  // `file.fileName !== PRELUDE_NAME` — could never be equal and therefore never
  // excluded anything. It is `isCompilerPrelude` everywhere else in this file
  // (`endsWith`), and that is what it has to be here: the prelude's own
  // `declare module` blocks are `.d.ts` declarations carrying no
  // `@throws {never}` marker, so resolving an authored specifier to one and
  // handing it to the SMITHERS1510 module-trust pass would refuse the
  // compiler's own prelude. Nothing reaches that state today because all three
  // callers filter `COMPILER_INTRINSIC_SPECIFIERS` out first and that set
  // covers every module the prelude declares — a containment
  // `compiler-construct-identity.test.ts` now asserts rather than assumes.
  const declaration = symbol?.declarations?.find((candidate) => !isCompilerPrelude(candidate.getSourceFile()));
  return declaration?.getSourceFile();
}

function isSmithersSemanticSourceFile(fileName: string): boolean {
  return /\.sm(?:\.ts)?$/i.test(fileName);
}

function isTypeScriptOrJavaScriptSourceFile(fileName: string): boolean {
  return /(?:\.d)?\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(fileName);
}

/**
 * The exact whitespace class a JSDoc marker may be spelled with: SPACE, TAB,
 * CR, LF, and nothing else.
 *
 * `\s` was here, and `\s` in JavaScript matches U+00A0 NO-BREAK SPACE, U+000C
 * FORM FEED, U+000B VERTICAL TAB, U+FEFF BYTE ORDER MARK and every Unicode
 * space separator. Measured: `@throws {<NBSP>never<NBSP>}` conferred module
 * initialization trust here — the untrusted module's initializer RAN — while
 * the Go fork's `isJSDocWhitespace` (`compiler/forkbridge/lowering.go.txt`,
 * `' ' | '\t' | '\r' | '\n'`) refused it. Five spellings diverged: NBSP inside
 * the braces, NBSP after `@module`, form feed, vertical tab, and BOM.
 *
 * The fork is the correct side, by this rule's own argument (below): the marker
 * is the exact text the specification prints, and `{<NBSP>never<NBSP>}` names a
 * type whose spelling is not `never`, which is the `@throws {T}` production
 * rather than the trusted opt-out. Widening the class merges the two
 * productions exactly as folding case does.
 */
const JSDOC_SPACE = "[ \\t\\r\\n]";
const MODULE_MARKER = new RegExp(`@module(?:${JSDOC_SPACE}|\\*|$)`);
const THROWS_NEVER_MARKER = new RegExp(
  `@throws${JSDOC_SPACE}*\\{${JSDOC_SPACE}*never${JSDOC_SPACE}*\\}`,
);

/**
 * The JSDoc comments in a source file's leading trivia, as the SCANNER
 * classifies them.
 *
 * The marker used to be found by searching the raw leading text for a
 * `/** … *\/` substring, which asks no one whether a JSDoc exists. Measured:
 * a `//` line comment whose body happens to contain the marker text, and a
 * plain `/* … *\/` block containing it, both conferred module-initialization
 * trust on all three implementations, and the untrusted module's initializer
 * RAN. That is the same defect the fork had for `@throws {never}` on
 * constructors — honouring a marker the parser attaches to nothing.
 *
 * The comment KIND is now the scanner's answer. Note the direction this
 * preserves: `/* @module @throws {never} *\/` (a block comment with one
 * asterisk) was already correctly refused, so the rule always meant to
 * distinguish JSDoc from a block comment — it just did it by substring.
 *
 * The parser's own attached `jsDoc` array is deliberately NOT the source here,
 * even though it would supply parsed tags. Measured over the 75 marker-carrying
 * files in this repository, it disagrees with this rule in 21 places and in
 * BOTH directions: TypeScript attaches only the LAST JSDoc block before a
 * statement, so the ordinary shape "module header, then the first export's own
 * doc comment" loses the header (15 conformance and fixture modules, including
 * `conformance/support/foreign.ts`); and the JSDoc parser strips a `*`
 * decoration inside a tag, so `@throws\n * {never}` parses as a `{never}` type
 * expression and `conformance/support/split-trust-marker.ts` — a near-miss the
 * corpus exists to keep refused — would have been granted trust.
 */
function leadingJSDocComments(sourceFile: ts.SourceFile): readonly string[] {
  const text = sourceFile.text;
  const anchor = sourceFile.statements[0];
  const limit = anchor?.getStart(sourceFile) ?? text.length;
  const comments: string[] = [];
  for (const range of ts.getLeadingCommentRanges(text, anchor?.getFullStart() ?? 0) ?? []) {
    if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia || range.end > limit) continue;
    const comment = text.slice(range.pos, range.end);
    // `/**\/` is an empty block comment, not a JSDoc; this is the same test
    // TypeScript's own scanner makes.
    if (!comment.startsWith("/**") || comment.startsWith("/**/")) continue;
    comments.push(comment);
  }
  return comments;
}

/**
 * Both tags are matched with the exact case the specification prints, and the
 * `i` flag is deliberately absent from both patterns.
 *
 * specification/failures.mdx, Foreign Exceptions (Locked): "`@throws {never}`
 * removes the default panic case; `@throws {T}` declares the stated foreign
 * error channel." Those are two productions of one syntax, and the only thing
 * that separates them is the spelling inside the braces. `T` is a TypeScript
 * type name, and TypeScript type identity is case-sensitive, so `Never` is the
 * second production — a declared channel naming a type that must resolve to an
 * Error constructor — and never the first. A case-insensitive comparison merges
 * the two productions and silently converts a channel the compiler could not
 * reify into the trusted opt-out, which is the fail-open direction. The call
 * boundary already reads the marker exactly (`tag.tagName.text === "throws"`
 * plus an exact `"never"` comparison), pinned by
 * 09-foreign-calls/the-never-annotation-is-case-sensitive; the module boundary
 * is the same marker and gets the same rule.
 *
 * The tag names follow from the same sentence: a JSDoc tag name is not
 * case-folded by TypeScript's own JSDoc parser, so `@THROWS` and `@MODULE` are
 * not the tags the specification names.
 */
function hasLeadingModuleNoThrowMarker(sourceFile: ts.SourceFile): boolean {
  return leadingJSDocComments(sourceFile)
    .some((comment) => MODULE_MARKER.test(comment) && THROWS_NEVER_MARKER.test(comment));
}

function isTrustedCompilerGeneratedRuntime(sourceFile: ts.SourceFile): boolean {
  return trustedCompilerRuntimeSourceFiles.has(sourceFile) &&
    sourceFile.fileName.endsWith(".__smithers_generated__.ts") &&
    hasLeadingModuleNoThrowMarker(sourceFile);
}

/**
 * @internal Reads the undocumented `parseDiagnostics` field the frontend
 * depends on for grammar acceptance. Exposed for fail-closed regression tests.
 */
export function internalParseDiagnostics(
  sourceFile: ts.SourceFile,
): readonly ts.DiagnosticWithLocation[] | undefined {
  return (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[] })
    .parseDiagnostics;
}

/**
 * @internal When the internal parser-diagnostics field is absent (as opposed
 * to present but empty), the frontend cannot prove the source parses and must
 * fail closed instead of silently accepting unverified syntax.
 */
export function parseDiagnosticsFailure(sourceFile: ts.SourceFile): PendingDiagnostic | undefined {
  if (internalParseDiagnostics(sourceFile) !== undefined) return undefined;
  return {
    severity: "error",
    code: "SMITHERS1002",
    message: "internal: typescript-js did not expose parser diagnostics for this file, so the frontend cannot prove the source matches the supported grammar and fails closed",
    start: 0,
  };
}

function scanSource(source: string): ScannedToken[] {
  // Template- and regex-aware: a `${...}` substitution must not skew the
  // token stream the removed-syntax and expression-keyword checks rely on.
  return [...scanRecoveryTokens(source)];
}

/**
 * Retired-syntax recognition is a GRAMMAR property, not a token-adjacency
 * property. Every retired operator below takes a right operand, and the binary
 * and postfix ones additionally take a left operand; a spelling that has
 * neither shape is a name, not the operator. Testing only the neighbouring
 * token misreports ordinary code — `{ try: doThing, catch: handleIt }` is a
 * plain object literal, `{ orelse: 7 }` a plain member, and neither is retired
 * Smithers grammar.
 *
 * The three predicates below are the whole discipline:
 *
 * - `beginsOperand`   — could this token start the operator's right operand?
 * - `tokenEndsExpression` (recover.ts) — did an expression finish to the left?
 * - `isMemberNameOccurrence` — is the word being used as a property name?
 *
 * `try` and `catch` are ECMAScript reserved words, so *every* legal occurrence
 * of them outside statement-form `try`/`catch` is a property name; the third
 * predicate is what recognizes those positions.
 */
const OPERAND_CANNOT_BEGIN_WITH: ReadonlySet<string> = new Set([
  ":", ",", ")", "}", "]", ";", "=", "=>", ".", "?", "?.",
]);

function beginsOperand(token: ScannedToken | undefined): boolean {
  if (!token || token.kind === ts.SyntaxKind.EndOfFileToken) return false;
  return !OPERAND_CANNOT_BEGIN_WITH.has(token.text);
}

/**
 * Tokens that can precede a member name in an object literal, class body,
 * interface body, or type literal. A reserved word followed by `(` or `<` at
 * one of these positions is a method or call signature, never a prefix or
 * postfix operator.
 */
const MEMBER_LIST_BOUNDARIES: ReadonlySet<string> = new Set([
  "{", "}", ",", ";", "*",
  "static", "async", "get", "set", "public", "private", "protected",
  "readonly", "override", "abstract", "declare",
]);

function isMemberNameOccurrence(tokens: readonly ScannedToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  // `promise.catch(...)`, `Result.try(...)`, `adapter?.catch`
  if (previous?.text === "." || previous?.text === "?.") return true;
  // `{ try: value }`, `interface I { catch: T }`, `const { catch: c } = source`
  if (next?.text === ":") return true;
  // `interface I { catch?: T }`, `type T = { try?(): void }`
  if (next?.text === "?" && (tokens[index + 2]?.text === ":" || tokens[index + 2]?.text === "(")) return true;
  // `{ try() {} }`, `class C { static catch() {} }`, `type T = { try<A>(): A }`
  if ((next?.text === "(" || next?.text === "<") &&
    MEMBER_LIST_BOUNDARIES.has(previous?.text ?? "")) return true;
  return false;
}

/**
 * The retired `throws`/`uses` clause is a suffix on a *complete* return type,
 * so the token before it must be able to end one. A type name that happens to
 * be spelled `uses` inside type arguments or a union (`Array<uses>`,
 * `string | throws`) is preceded by a token that cannot end a type.
 */
const TYPE_CANNOT_END_WITH: ReadonlySet<string> = new Set([
  "<", ",", "|", "&", "(", "[", ":", "?", "=>", ".", "...",
  "extends", "keyof", "typeof", "readonly", "infer", "new", "is", "asserts",
]);

function endsReturnType(token: ScannedToken | undefined): boolean {
  return token !== undefined && !TYPE_CANNOT_END_WITH.has(token.text);
}

/**
 * Type-only keyword spellings. `!string` in a value position would be a
 * logical negation of a variable named `string`; in an annotation it is the
 * retired `!T` marker. The keyword spelling is what separates the retired
 * marker from an ordinary `{ ok: !failed }` or `flag ? a : !b`.
 */
const TYPE_ONLY_KEYWORDS: ReadonlySet<string> = new Set([
  "string", "number", "boolean", "bigint", "symbol", "object",
  "any", "unknown", "never", "void",
]);

function hasLineBreakBetween(source: string, left: ScannedToken, right: ScannedToken): boolean {
  return /[\n\r\u2028\u2029]/.test(source.slice(left.end, right.start));
}

function isBetweenFunctionParametersAndBody(tokens: readonly ScannedToken[], index: number): boolean {
  let sawClose = false;
  for (let cursor = index - 1; cursor >= 0 && index - cursor < 80; cursor--) {
    const text = tokens[cursor]!.text;
    if (text === "{") return false;
    if (text === ")") sawClose = true;
    if (text === "function") return sawClose;
    if (text === ";" || text === "}") return false;
  }
  return false;
}

/**
 * The ECMAScript-262 global object: the names the *language* publishes, as
 * opposed to the names a *host* publishes.
 *
 * This is an ALLOWLIST, and the inversion is the whole point. The rule used to
 * be eight forbidden spellings, which measured 22 of 38 sibling globals broken:
 * `self`/`top`/`parent`/`frames` are aliases of `globalThis` in every DOM and
 * worker host and bypassed all eight; `XMLHttpRequest`/`WebSocket`/
 * `EventSource`/`Worker` are the network and thread authority that
 * `specification/compatibility.mdx` names in the same breath as `process`;
 * `navigator`/`location`/`localStorage`/`sessionStorage` are host identity and
 * host-persistent state. A denylist over a namespace the host may extend at any
 * time cannot be completed, so it is not a prohibition — it is a spelling table.
 *
 * The criterion is `specification/compatibility.mdx`, "Host Globals":
 * "Platform-specific globals such as `process`, `window`, `document`,
 * filesystem, and network MUST NOT be unconditional globals in authored `.sm`
 * code", and "Facilities truly present in every supported JavaScript
 * environment MAY be unconditional globals." `docs/DECISIONS.md` (Locked)
 * restates it: "Only facilities present in every JavaScript environment may be
 * unconditional globals."
 *
 * Read literally, "present in every supported environment" does not decide the
 * edges: `console`, `fetch`, and `setTimeout` are present in every one of them
 * and are nevertheless refused here and by `docs/DECISIONS.md`; so are `URL`,
 * `TextEncoder`, and `AbortController`, which no clause mentions either way.
 * ECMA-262 is the one line through that set that is both principled and
 * COMPLETABLE: a global outside it is host-defined by construction — that is
 * what the HTML, WinterCG, and Node global-scope specifications *are* — and the
 * second clause is a MAY, so refusing a universally present host facility is
 * permitted where admitting a platform-specific one is not. Where the spec text
 * runs out, this errs toward refusal, which is the direction the page's first
 * clause makes mandatory.
 *
 * `globalThis` is in ECMA-262 and is deliberately NOT here: it is the one
 * language global whose whole purpose is to hand back the host's namespace, so
 * admitting it would readmit every name this set excludes.
 *
 * `eval` and `Function` are excluded for that sentence verbatim, and are judged
 * per operation by `dynamicCodeUse` instead; see `DYNAMIC_CODE_GLOBALS`.
 */
const UNIVERSAL_GLOBALS: ReadonlySet<string> = new Set([
  // 19.1 Value Properties of the Global Object (`globalThis` excluded above).
  "Infinity", "NaN", "undefined",
  // 19.2 Function Properties of the Global Object (`eval` excluded above).
  "isFinite", "isNaN", "parseFloat", "parseInt",
  "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
  // 19.3 Constructor Properties of the Global Object (`Function` excluded above).
  "AggregateError", "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array",
  "Boolean", "DataView", "Error", "EvalError",
  // `FinalizationRegistry` is deliberately absent; see NONDETERMINISTIC_GLOBALS.
  "Float16Array", "Float32Array", "Float64Array",
  "Int8Array", "Int16Array", "Int32Array", "Iterator", "Map", "Number", "Object",
  "Promise", "Proxy", "RangeError", "ReferenceError", "RegExp", "Set",
  // `SharedArrayBuffer` is deliberately absent; see NONDETERMINISTIC_GLOBALS.
  "String", "Symbol", "SyntaxError", "TypeError",
  "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "URIError",
  // `WeakRef` is deliberately absent; see NONDETERMINISTIC_GLOBALS. `WeakMap`
  // and `WeakSet` stay: neither exposes collection, so neither can observe
  // garbage-collection timing.
  "WeakMap", "WeakSet",
  // Explicit Resource Management, shipped in the same clause.
  "AsyncDisposableStack", "DisposableStack", "SuppressedError",
  // 19.4 Other Properties of the Global Object. `Atomics` is deliberately
  // absent; see NONDETERMINISTIC_GLOBALS.
  "JSON", "Reflect",
  // Annex B, normative for every web-compatible host.
  "escape", "unescape",
  // `Date`, `Math`, `Intl`, `performance`, and `crypto` are omitted on purpose:
  // they are judged per-operation by `ambientAuthorityUses` instead, which is
  // what keeps `Math.max` available while `Math.random` needs `Random`.
]);

/**
 * The DETERMINISM-HOSTILE globals. ECMA-262 publishes them, and this table is
 * why they are nevertheless not in `UNIVERSAL_GLOBALS`.
 *
 * `specification/compatibility.mdx` §Determinism-Sensitive Members states the
 * two rows verbatim: `WeakRef`/`FinalizationRegistry` and
 * `SharedArrayBuffer`/`Atomics` "MUST NOT be unconditional globals". The reason
 * is the same one §Host Globals gives for the whole allowlist — a Flow body
 * re-executes on every resumption, so an operation whose result can differ
 * between two executions of the same code on the same inputs must be reachable
 * only through a capability whose answer the runtime journals — except that
 * here there is no such capability to reach for. `deref()` returning
 * `undefined` is a pure function of garbage-collection timing; a shared-memory
 * read observes another agent's schedule. Neither is a value a journal entry
 * could record and replay.
 *
 * Measured 2026-08-28, before this set existed: `new WeakRef(o).deref()`,
 * `new FinalizationRegistry(() => {})`, `new SharedArrayBuffer(8)`, and
 * `Atomics.load(...)` each compiled with zero diagnostics and an empty
 * requirement row, in the same `.sm` file where the `Date.now()` control
 * correctly reported SMITHERS1602. They were not merely unenforced: being
 * *listed* in `UNIVERSAL_GLOBALS` made the allowlist assert the opposite of the
 * obligation.
 *
 * ## Why these get their own code rather than joining SMITHERS1601
 *
 * SMITHERS1601's message ends "access it through a Context capability", and
 * these four rows say the opposite in as many words: "no capability can mediate
 * it and no journal entry can describe it". Pointing an author at a remedy that
 * cannot be built is the "refusal wearing a costume" that the `crypto` note in
 * `DYNAMIC_CODE_GLOBALS` rejects by name. SMITHERS1604 is the precedent — it
 * exists for exactly the same "there is no capability that could provide this"
 * argument — so this is SMITHERS1605 with its own reason.
 *
 * ## Why the line is the NAME here and the OPERATION for `eval`
 *
 * `eval` keeps a legal type annotation and a legal `instanceof` because the
 * hazard is the evaluation, not the binding. There is no comparable safe read
 * here: every value use of `WeakRef` is construction, and `Atomics` is a
 * namespace object whose every member is a shared-memory operation. So this
 * joins the by-name shape, and the two directions a by-name rule can get wrong
 * are pinned in `host-global-allowlist.test.ts`: a type position and a lexical
 * shadow both stay legal, and `WeakMap`, `WeakSet`, `ArrayBuffer`, and the
 * typed arrays all stay available.
 */
const NONDETERMINISTIC_GLOBALS: ReadonlySet<string> = new Set([
  "WeakRef", "FinalizationRegistry", "SharedArrayBuffer", "Atomics",
]);

/**
 * The DYNAMIC CODE EVALUATION globals. ECMA-262 publishes them, and this table
 * is why they are nevertheless not in `UNIVERSAL_GLOBALS`.
 *
 * `UNIVERSAL_GLOBALS`'s own note on `globalThis` states the criterion: it is
 * "the one language global whose whole purpose is to hand back the host's
 * namespace, so admitting it would readmit every name this set excludes." That
 * sentence is true of `eval` and `Function` verbatim, and it was measured to be
 * true. Each of these compiled with `failures: [] requirements: []`, no
 * diagnostic on either backend, and RAN:
 *
 *     eval("process.platform")                        -> "darwin"
 *     (0, eval)("process.platform")                   -> "darwin"
 *     new Function("return process.platform")()       -> "darwin"
 *     Reflect.construct(Function, [...])()            -> "darwin"
 *     (function () {}).constructor                    -> the Function constructor
 *     eval("globalThis.process.platform")             -> "darwin"
 *     eval("Date.now()")                              -> a wall-clock instant
 *     eval("Math.random()")                           -> randomness
 *
 * Twenty spellings, measured. Two `MUST`s in `specification/compatibility.mdx`
 * §Host Globals were violated with nothing reported: "Platform-specific globals
 * such as `process`, `window`, `document`, filesystem, and network MUST NOT be
 * unconditional globals in authored `.sm` code", and "Host-sensitive operations
 * such as clock and random access MUST still use capabilities" — where
 * `Date.now()` spelled directly is SMITHERS1602 and spelled through `eval` was
 * an empty row. Note the last two: refusing `globalThis` BY NAME, which the
 * allowlist does and which 15 measured identifier spellings confirm it does
 * soundly, is defeated by one sibling spelling.
 *
 * ## Why the rule is per-OPERATION rather than per-NAME
 *
 * The same page's §Dynamic Features says "`any` and `eval` remain usable.
 * General Smithers guidance may lint against them; the language does not forbid
 * them." A `MUST NOT` outranks a "remains usable", but only where the two
 * actually collide, and they collide at the EVALUATION, not at the name. So the
 * name still resolves — `Function` is still a usable TYPE annotation, and
 * `value instanceof Function` is still a prototype test — and it is READING the
 * binding, which is what hands the evaluation on, that is refused. Reading it is
 * the line rather than calling it because every call spelling this rule was
 * written against reaches the callee through a read: an alias, `(0, eval)`,
 * `Reflect.apply(Function, …)`, and a shorthand `{ eval }` are all reads and all
 * measured executing host code. `Date` already draws the line in exactly this
 * place — `typeof Date` is SMITHERS1602 today — for exactly this reason.
 *
 * That is not a new shape here: `crypto` is exactly this already. It is absent
 * from `UNIVERSAL_GLOBALS`, its name is not refused, and every USE of it is
 * refused by `ambientAuthorityUses` because no capability in this POC can
 * represent it. `eval` is the same argument: there is no capability that could
 * provide "run arbitrary host code", so admitting the call while charging a
 * requirement nothing can satisfy would be a refusal wearing a costume, and a
 * worse diagnostic than this one.
 *
 * Which of the two specification sentences governs `eval("1 + 1")` — a call
 * that reaches no host name at all, and the one
 * 18-typescript-requirement/eval-is-usable-and-not-forbidden pins — is a
 * SPECIFICATION decision and is recorded as such rather than settled here. What
 * is not open is the direction: a call that confers ambient host authority may
 * not report an empty row, so this fails closed at every spelling until that
 * sentence is written.
 */
const DYNAMIC_CODE_GLOBALS: ReadonlySet<string> = new Set(["eval", "Function"]);

/**
 * Globals the language refuses by NAME, whether or not the ambient lib declares
 * them.
 *
 * This is not the rule — `UNIVERSAL_GLOBALS` is, and it decides every name the
 * ambient environment actually publishes. This list exists for the names whose
 * *presence* varies with the toolchain, and its job is to make the verdict not
 * vary with it.
 *
 * That matters because the two backends do not share an ambient environment.
 * The reference frontend runs against the installed `@types` packages, so
 * `@types/node` declares `Buffer`, `require`, `module`, `exports`, `__dirname`,
 * `__filename`, `global`, and `setImmediate`; the pinned Go fork carries no
 * ambient `@types/node` at all (`compiler/forkbridge/hostrules.go.txt`), so the
 * same names resolve to nothing there. Measured before this list existed:
 * `Buffer` was `ok: true` on the reference and `TS2591` on the fork, and
 * `setImmediate` was `ok: true` here and `TS2304` there. Naming them makes both
 * backends answer SMITHERS1601, which is also the honest answer — they are the
 * Node host's globals, and the emitted module is ESM, where `__dirname`,
 * `__filename`, `module`, and `exports` do not exist at all and would have been
 * a guaranteed `ReferenceError` inside a function whose row read `failures: []`.
 *
 * A name that is NOT here and NOT declared is left to TypeScript, which refuses
 * it as TS2304 — an ordinary typo must not be reported as a host global.
 */
const ALWAYS_FORBIDDEN_HOST_GLOBALS: ReadonlySet<string> = new Set([
  // The canonical host globals the specification names.
  "process",
  "window",
  "document",
  "console",
  "fetch",
  "setTimeout",
  "setInterval",
  "globalThis",
  // The Node global scope and the CommonJS module wrapper. `@types/node`
  // declares these and the pinned fork does not, so leaving them to the
  // ambient environment would leave the two backends disagreeing.
  "Buffer",
  "global",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "setImmediate",
  "clearImmediate",
]);

function checkHostGlobals(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    const sensitive = ambientAuthorityUses(node, checker);
    if (ts.isIdentifier(node) &&
      !isDeclarationName(node) && !isPropertyNameNode(node) && !isInTypePosition(node) &&
      isForbiddenAmbientGlobal(node, checker)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1601", `ambient host global '${node.text}' is unavailable; access it through a Context capability`));
    }
    // The determinism-hostile names, refused with their own reason because no
    // capability can mediate them; see `NONDETERMINISTIC_GLOBALS`. Guarded by
    // the same three position tests and the same lexical-shadow test as the
    // allowlist rule above, so a type annotation and a local binding survive.
    if (ts.isIdentifier(node) &&
      !isDeclarationName(node) && !isPropertyNameNode(node) && !isInTypePosition(node) &&
      NONDETERMINISTIC_GLOBALS.has(node.text) &&
      ambientGlobalKind(node, checker) !== "local") {
      diagnostics.push(at(node, sourceFile, "SMITHERS1605", `ambient host global '${node.text}' is unavailable; its result is a function of garbage-collection timing or another agent's schedule, which no capability can mediate and no journal entry can describe`));
    }
    // `import.meta` is host authority by this allowlist's own criterion —
    // ECMA-262 hands its properties to the host (`HostGetImportMetaProperties`)
    // — but it is a META-PROPERTY, not an identifier, so the name-keyed rule
    // above never saw it. `import.meta.url` compiled with `requirements: []`
    // and RAN, printing the host filesystem path; `import.meta.dirname` and
    // `import.meta.filename` compiled here while the fork answered TS2339, the
    // exact backend divergence `ALWAYS_FORBIDDEN_HOST_GLOBALS` exists to close
    // for their `__dirname`/`__filename` siblings. `new.target` is the other
    // meta-property and is deliberately untouched: it is the language's own,
    // and reads nothing from the host.
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword &&
      !isInTypePosition(node)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1601", "ambient host global 'import.meta' is unavailable; access it through a Context capability"));
    }

    const dynamic = dynamicCodeUse(node, checker);
    if (dynamic) {
      diagnostics.push(at(dynamic.node, sourceFile, "SMITHERS1604", `ambient ${dynamic.description} is unavailable; it runs a string as code in the host's own scope, so the enclosing row cannot describe what it reads, throws, or requires`));
    }

    // Row four: a `Date` INSTANCE member that reads the host time zone. The
    // same code and the same reason as `Date.now()` — see `dateZoneMemberUse`.
    const zoneRead = dateZoneMemberUse(node, checker);
    if (zoneRead) {
      diagnostics.push(at(zoneRead, sourceFile, "SMITHERS1602", "ambient wall-clock access is unavailable; access it through Clock.context()"));
    }

    for (const use of sensitive) {
      diagnostics.push(at(
        use.root,
        sourceFile,
        use.requirement === "Clock" ? "SMITHERS1602" : use.requirement === "Random" ? "SMITHERS1603" : "SMITHERS1601",
        use.requirement === "Host"
          ? "ambient host global 'crypto' is unavailable; access it through a Context capability"
          : `ambient ${use.description} is unavailable; access it through ${use.requirement}.context()`,
      ));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

interface DynamicCodeUse {
  /** Where the refusal is reported: the node that names the authority. */
  readonly node: ts.Node;
  readonly description: string;
}

/**
 * One use of the dynamic-code-evaluation authority; see `DYNAMIC_CODE_GLOBALS`
 * for what is being refused and why the rule is per operation.
 *
 * Two arms, because the authority has two routes and only one of them has a
 * name to key on:
 *
 * 1. A VALUE read of the ambient `eval` or `Function`. This covers every
 *    spelling that mentions either name — the direct call, an alias
 *    (`const e: any = eval`), the indirect `(0, eval)`, `new Function`,
 *    `(Function as any)`, `Function.prototype.constructor`, and `Function` as
 *    an argument to `Reflect.construct` / `Reflect.apply` — because all of them
 *    READ the binding, and reading it is what hands the authority on.
 *
 * 2. A `constructor` selection off a CALLABLE receiver. `(function () {})
 *    .constructor` IS the `Function` constructor, spelled without naming it,
 *    and `new ((function(){}).constructor)("return process.platform")()`
 *    measured `darwin`. The receiver test is what keeps this narrow, and it is
 *    the honest test rather than a name test: `({}).constructor` is
 *    `ObjectConstructor`, `[].constructor` is `ArrayConstructor`, a class
 *    instance's is its own class, and a string's is `StringConstructor` — none
 *    of which compile a string, and all four measured clean. The one corpus
 *    case that reads `.constructor`
 *    (09-foreign-calls/a-library-declared-member-of-a-foreign-value-still-needs-an-adapter)
 *    reads it off an object literal and is untouched here; it stays refused by
 *    the foreign-member rule that owns it.
 *
 * Two exemptions, both of which `Date` already has for the same reasons:
 * a TYPE position reads nothing (`function f(cb: Function)` is an annotation),
 * and the RIGHT operand of `instanceof` selects a prototype and evaluates
 * nothing. Only the right operand — `Function instanceof Object` puts the
 * object itself in a value position, where it can still be called.
 *
 * A receiver typed `any` reaches neither arm: `Object.getPrototypeOf(fn)` is
 * declared `any`, so `Object.getPrototypeOf(function* () {}).constructor` still
 * escapes. That is the standing `any` hole, not a hole in this rule — `any`
 * defeats every checker-typed rule in this file — and it is recorded rather
 * than papered over.
 */
function dynamicCodeUse(node: ts.Node, checker: ts.TypeChecker): DynamicCodeUse | undefined {
  if (ts.isIdentifier(node)) {
    if (!DYNAMIC_CODE_GLOBALS.has(node.text)) return undefined;
    if (isDeclarationName(node) || isPropertyNameNode(node) || isInTypePosition(node)) return undefined;
    if (!isAmbientGlobalReference(node, checker)) return undefined;
    const parent = node.parent;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      parent.right === node) return undefined;
    return { node, description: `dynamic code evaluation through '${node.text}'` };
  }
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
  if (isInTypePosition(node)) return undefined;
  const selection = memberSelection(node, checker);
  if (!selection || selection.name !== "constructor") return undefined;
  const receiver = checker.getTypeAtLocation(selection.receiver);
  // FAIL CLOSED ON `any`. `specification/compatibility.mdx` §Dynamic Features:
  // "`any` remains usable, but a receiver typed `any` in a position where the
  // analysis must decide callability MUST be treated as callable — matching the
  // fail-closed default already applied to a dynamically selected member."
  //
  // MEASURED before this arm existed: `(JSON as any).constructor` compiled with
  // zero diagnostics and an empty row, while the same selection on a resolved
  // callable was `SMITHERS1604`. An `any` type has neither call nor construct
  // signatures, so the test below answered "not callable" for the one receiver
  // type about which nothing is known — the exact inversion of the rule. This
  // is `SMITHERS1605`'s hazard in a different costume: `eval` reached through
  // the `any` hole produces no journal entry, therefore no divergence to
  // detect, which is why the migration plan lists it under R8 beside
  // `WeakRef.deref()` and `Promise.race`.
  //
  // `unknown` is deliberately NOT here. It is the type you must narrow before
  // using, so a `constructor` selection on it does not compile at all and stock
  // TypeScript already refuses the program.
  if ((receiver.flags & ts.TypeFlags.Any) === 0 &&
    receiver.getCallSignatures().length === 0 && receiver.getConstructSignatures().length === 0) {
    return undefined;
  }
  return {
    node: selection.nameNode,
    description: "dynamic code evaluation through a callable's 'constructor', which is the Function constructor",
  };
}

interface AmbientAuthorityUse {
  /**
   * A DIAGNOSTIC CATEGORY, not a capability vocabulary. It selects
   * `SMITHERS1602`/`1603`/`1601` and nothing else — no ambient site has ever
   * charged a row through this type, not even for `Clock`, because the sites it
   * describes are REFUSED and the row is charged by the `Clock.context()` the
   * author writes instead. The requirement vocabulary is open and is every
   * `Context` subclass the program names; see {@link ambientRequirementCharges}
   * for the sites that charge one.
   */
  readonly requirement: "Clock" | "Random" | "Host";
  readonly description: string;
  readonly root: ts.Identifier;
}

/**
 * The ambient operations that CHARGE a capability into the enclosing row
 * instead of being refused.
 *
 * `specification/compatibility.mdx` §Determinism-Sensitive Members, and the
 * paragraph under its table is the whole rule: "'Charge' means the site
 * publishes the named capability's requirement into the enclosing function's
 * row, which a caller discharges by providing a layer. Where the capability has
 * a source-language surface the author can write instead — `Clock.context()`,
 * `Random.context()` — the *ambient* spelling is additionally refused ... Where
 * the capability deliberately has **no** source-language surface, a refusal
 * would name a remedy that cannot be written, and the obligation is the row
 * charge alone."
 *
 * So this function is exactly the rows whose capability has no source-language
 * surface, and it is why they produce **no diagnostic code, new or existing**:
 *
 * - **Row three, `Scheduler`.** `Promise.race` and `Promise.any` "MUST charge a
 *   `Scheduler` requirement, because their value *is* arrival order". A refusal
 *   here would name `Scheduler.context()` as the remedy, and
 *   `specification/durable-execution.mdx` §Deterministic Scheduling says the
 *   scheduler "has no source-language surface" — so the refusal reading was
 *   answered and rejected rather than dropped. Every other `Promise` member
 *   stays free, `Promise.all` included.
 * - **Row five, `Locale`.** Every ICU-backed operation is "a function of the
 *   host ICU version and locale data", and `Collator.compare` used as a sort
 *   comparator makes the resulting ORDERING host-dependent. `Locale` is a
 *   capability class that exists nowhere in this tree, so by the criterion
 *   above it can only be a charge: refusing it would point an author at
 *   `Locale.context()`, which is unwritable.
 *
 * Both charges are unsatisfied rows in practice today, and that is the intended
 * end state rather than an omission — MEASURED: an unsatisfied requirement is
 * not a compile error in this implementation, so a charged program still
 * compiles, still runs, and publishes the row a caller would have to discharge.
 * That is what distinguishes a charge from a refusal by the back door.
 *
 * ROW FOUR IS NOT HERE, deliberately. `Date`'s host-zone members charge `Clock`,
 * which does have a source-language surface, so by the same criterion the
 * ambient spelling is additionally refused — as `SMITHERS1602`, exactly as
 * `Date.now()` already is. See {@link dateZoneMemberUse}.
 */
function ambientRequirementCharges(node: ts.Node, checker: ts.TypeChecker): readonly string[] {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return [];
  if (isInTypePosition(node)) return [];
  const selection = memberSelection(node, checker);
  if (!selection) return [];

  // Row three. Keyed on the ambient `Promise` NAMESPACE rather than on the
  // spelling, through the same predicate `SMITHERS1401` uses, so a local
  // `const Promise = …` is an ordinary value under any spelling.
  if (ts.isIdentifier(selection.receiver) && selection.receiver.text === "Promise" &&
    isAmbientGlobalReference(selection.receiver, checker) &&
    (selection.name === "race" || selection.name === "any")) {
    return ["Scheduler"];
  }

  // Row five. The `Intl` namespace half is keyed on the root name; the
  // prototype half is keyed on the member, because `"a".localeCompare("b")` has
  // no root identifier for a name-keyed walk to see. That asymmetry is the
  // reason row five went unenforced while row four's `Date.now()` did not.
  if (ts.isIdentifier(selection.receiver) && selection.receiver.text === "Intl" &&
    isAmbientGlobalReference(selection.receiver, checker)) {
    // `DateTimeFormat` is row FOUR's clock hazard, and it is already refused as
    // `SMITHERS1602`. Charging `Locale` on top would publish a row for a
    // program that does not compile.
    return selection.name === "DateTimeFormat" ? [] : ["Locale"];
  }
  if (LOCALE_SENSITIVE_MEMBERS.has(selection.name) && !isAmbientNamespaceReceiver(selection.receiver, checker) &&
    // A `Date` instance's `toLocaleString` is row FOUR's host-zone read, not
    // row five's locale one, and row four refuses it. Charging `Locale` here as
    // well would publish a requirement row for a program that does not compile.
    !isAmbientDateReceiver(selection.receiver, checker)) {
    return ["Locale"];
  }
  return [];
}

/** Whether an expression's TYPE is the TypeScript library's own `Date`. */
function isAmbientDateReceiver(receiver: ts.Expression, checker: ts.TypeChecker): boolean {
  return isAmbientLibraryType(checker.getTypeAtLocation(receiver), ["Date"]);
}

/**
 * `Date` INSTANCE members whose result is a function of the host time zone.
 *
 * `specification/compatibility.mdx` §Determinism-Sensitive Members row four:
 * these "MUST charge `Clock` even when an explicit instant is supplied, because
 * they read the host time zone. `getTime()` stays free."
 *
 * WIDER THAN THE SEVEN THE ROW NAMES, by the row's own criterion and by the
 * precedent its neighbour set. Row four names `getHours`, `getDay`,
 * `getTimezoneOffset`, `toLocaleString`, `toLocaleDateString`,
 * `toLocaleTimeString`, and `toString`. Every other LOCAL getter reads the zone
 * for the identical reason and nothing distinguishes them: `getFullYear`,
 * `getMonth`, `getDate`, `getMinutes`, and `getSeconds` all differ between two
 * hosts at one instant, and so do `toDateString` and `toTimeString`. Row five
 * was amended on exactly this argument — "The obligation is the criterion, not
 * the list" — after its four named members were measured to be twenty-six
 * short, and row four was four short for the same reason.
 *
 * WHAT IS DELIBERATELY ABSENT, because the criterion excludes it rather than
 * because the list is short:
 *
 * - `getTime`, `valueOf`, `toISOString`, `toJSON`, `toUTCString`, and every
 *   `getUTC*` member are absolute or UTC-anchored. The row says `getTime()`
 *   stays free; the others stay free by the same sentence.
 * - `getMilliseconds` is zone-independent: every IANA offset in the modern
 *   database is a whole number of minutes.
 * - The SETTERS are not reads. `setHours` interprets its argument in the host
 *   zone, which makes the resulting instant host-dependent — but the hazard
 *   there is a WRITE derived from an authored value, and refusing it would
 *   refuse constructing a local-time instant at all. Recorded here as noticed
 *   and left, not as missed.
 */
const DATE_ZONE_MEMBERS: ReadonlySet<string> = new Set([
  // The seven the specification names.
  "getHours", "getDay", "getTimezoneOffset",
  "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "toString",
  // The five local getters and two string renderings that carry the identical
  // hazard for the identical reason.
  "getFullYear", "getMonth", "getDate", "getMinutes", "getSeconds",
  "toDateString", "toTimeString",
]);

/**
 * A read of a `Date` INSTANCE member that reads the host time zone.
 *
 * This is the type-directed analysis row four was blocked on. `Date` was
 * analyzed at the ROOT IDENTIFIER only, so `new Date(instant)` returned an
 * empty row — correctly, the instant is authored — and no instance member was
 * ever inspected afterwards. Measured before this rule existed:
 * `new Date(0).getTimezoneOffset()` and `new Date(0).toLocaleString("en")` each
 * compiled with zero diagnostics and an empty requirement row, in the same file
 * where the `Date.now()` control correctly reported `SMITHERS1602`.
 *
 * Reported as `SMITHERS1602` and not as a new code, because it is the same
 * refusal for the same reason as `Date.now()`: `Clock` has a source-language
 * surface, so the ambient spelling is additionally refused and the row is
 * charged by the `Clock.context()` the author writes instead.
 *
 * Keyed on the RECEIVER'S TYPE rather than on the member name, which is the
 * opposite of row five's key and deliberately so. `toString` and `toLocaleString`
 * are members of nearly every value in the language; a name-keyed rule would
 * refuse `String(x)`'s `toString` and take the standard library with it.
 */
function dateZoneMemberUse(node: ts.Node, checker: ts.TypeChecker): ts.Node | undefined {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
  if (isInTypePosition(node)) return undefined;
  const selection = memberSelection(node, checker);
  if (!selection || !DATE_ZONE_MEMBERS.has(selection.name)) return undefined;
  // The ROOT spelling `Date.toString` is the namespace object's own member and
  // is already judged by `ambientRequirementsForMembers`; this rule is about an
  // instance.
  if (isAmbientNamespaceReceiver(selection.receiver, checker)) return undefined;
  if (!isAmbientDateReceiver(selection.receiver, checker)) return undefined;
  return selection.nameNode;
}

/**
 * The locale-sensitive PROTOTYPE members of row five, by name.
 *
 * By name and not by receiver type, and the enumeration is the point. Row five
 * covers `toLocaleString` on `Number`, `BigInt`, `Array`, `Object`, and each of
 * the TWELVE typed arrays; a rule keyed on one receiver type closes one and
 * none of the others, the same way the `eval` rule needed all twenty spellings.
 * One member name covers all sixteen receivers and cannot be short by one.
 *
 * The cost of keying on the name is that an author's own `toLocaleString`
 * method is charged too. That is accepted for the same reason
 * `compatibility.mdx` accepts `Intl.Collator` in a CLI formatter charging
 * `Locale`: the walls "MUST be uniform across all `.sm` code", an over-charge
 * is a row a caller discharges rather than a program that stops compiling, and
 * the alternative — resolving every receiver to a built-in prototype — is the
 * type-directed analysis row four needs and row five does not.
 *
 * `normalize` is in the row by row five's own criterion and is the one member
 * whose variance is the host's **Unicode** version rather than its locale.
 */
const LOCALE_SENSITIVE_MEMBERS: ReadonlySet<string> = new Set([
  "localeCompare",
  "toLocaleUpperCase",
  "toLocaleLowerCase",
  "normalize",
  "toLocaleString",
]);

/**
 * Whether a receiver is one of the ambient NAMESPACE objects the per-operation
 * rules already own.
 *
 * `Date.prototype.toLocaleString` reached through an instance is row five's
 * business, but `Intl` and `Date` as roots are judged by
 * `ambientRequirementsForMembers` and `dateZoneMemberUse`, and charging them
 * here as well would publish `Locale` beside a `SMITHERS1602` refusal.
 */
function isAmbientNamespaceReceiver(receiver: ts.Expression, checker: ts.TypeChecker): boolean {
  return ts.isIdentifier(receiver) && HOST_SENSITIVE_GLOBALS.has(receiver.text) &&
    isAmbientGlobalReference(receiver, checker);
}

/**
 * Ambient objects that stay reachable but whose host-sensitive OPERATIONS still
 * need a capability. `specification/compatibility.mdx`, "Host Globals":
 * "Host-sensitive operations such as clock and random access MUST still use
 * capabilities." These are exempt from `UNIVERSAL_GLOBALS` because they are
 * judged per member, not per name.
 *
 * `Intl` is here because `new Intl.DateTimeFormat("en").format()` — no
 * argument — formats *now*: it is a wall-clock read reached through a global
 * the old rule did not model at all, and it compiled clean on both backends.
 * The rest of `Intl` (`NumberFormat`, `Collator`, `ListFormat`, …) needs no
 * capability *here*, which is the same per-operation shape `Math` already has.
 *
 * "Needs no capability *here*" is exact, and it does not mean free. This set
 * selects a `SMITHERS1601`/`1602`/`1603` REFUSAL and nothing else. The rest of
 * `Intl` is charged a `Locale` requirement by {@link ambientRequirementCharges},
 * which is `compatibility.mdx` §Determinism-Sensitive Members row five — a
 * CHARGE, publishing a row and reporting nothing, because `Locale` has no
 * source-language surface a refusal could name. Row five's verb was open when
 * this comment was written and was settled by that criterion; `(SA-4)` is
 * closed, on both backends.
 *
 * What IS by design is that the REFUSAL exemption is uniform across the whole
 * class: `host-global-allowlist.test.ts` enumerates all thirty and requires one
 * answer for them, so a rule that charges the `Intl` ROOT — the cheapest wrong
 * implementation of row four or five — fails there instead of silently taking
 * the standard library's ICU surface with it. `ambient-charge.test.ts` and its
 * Go twin pin the same seam from the other side, and cross-backend.
 */
const HOST_SENSITIVE_GLOBALS: ReadonlySet<string> = new Set([
  "Date",
  "Math",
  "performance",
  "crypto",
  "Intl",
]);

function ambientAuthorityUses(node: ts.Node, checker: ts.TypeChecker): readonly AmbientAuthorityUse[] {
  const declarationName = ts.isIdentifier(node) && isDeclarationName(node);
  if (!ts.isIdentifier(node) || declarationName || isPropertyNameNode(node) ||
    isInTypePosition(node) || !HOST_SENSITIVE_GLOBALS.has(node.text) ||
    !isAmbientGlobalReference(node, checker)) return [];

  const requirements = ambientRequirementsForRootUse(node, checker);
  return requirements.map((requirement): AmbientAuthorityUse => ({
    requirement,
    description: requirement === "Clock" ? (node.text === "performance" ? "monotonic-clock access" : "wall-clock access") : "randomness",
    root: node,
  }));
}

function ambientRequirementsForRootUse(
  root: ts.Identifier,
  checker: ts.TypeChecker,
): readonly AmbientAuthorityUse["requirement"][] {
  const parent = root.parent;
  // `value instanceof Date` is a prototype test, not a host-sensitive
  // operation. specification/compatibility.mdx, "Host Globals": "Facilities
  // truly present in every supported JavaScript environment MAY be
  // unconditional globals. Host-sensitive *operations* such as clock and random
  // access MUST still use capabilities." This rule is already per-operation
  // rather than per-object elsewhere in this function — `Date.parse` and
  // `Date.UTC` are pure functions of their arguments, and `new Date(instant)`
  // reads no clock because the instant is authored — and the right operand of
  // `instanceof` is the same kind of use: it selects a prototype and reads no
  // host state. Only the RIGHT operand is exempt; `Date instanceof Function`
  // puts the object itself in an ordinary value position, where it can still
  // escape, so that spelling keeps its requirement.
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    parent.right === root) {
    return [];
  }
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === root) {
    // The member is read through the SHARED selection helper, not a second
    // literal test of this walk's own. The two answers had already drifted in
    // the harmless direction: `Date[KEY]()` for `const KEY = "now"` resolved to
    // no member here, fell to the whole-root arm, and was charged `Clock` — the
    // right verdict for `now` and an OVER-refusal for `Date[PARSE]` and
    // `Math[MAX]`, which need no capability and were refused anyway. One helper
    // makes the per-operation rule as precise at the aliased key as it is at
    // the dotted one, in both directions.
    const member = memberSelection(parent, checker)?.name;
    return ambientRequirementsForMembers(root.text, member === undefined ? undefined : [member]);
  }
  if (root.text === "Date" && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.expression === root) {
    // `new Date(instant)` reads no clock because the instant is authored. The
    // exemption is about the RUNTIME arity, though, and argument NODES are not
    // it: `new Date(...[])` is one syntactic argument and zero actual ones, so
    // it constructs the current time — measured, clean, and executing. A spread
    // has no statically known length, so it cannot prove an instant was
    // supplied and does not earn the exemption.
    const argumentNodes = ts.isNewExpression(parent) ? parent.arguments : undefined;
    if (argumentNodes && argumentNodes.length > 0 && !argumentNodes.some(ts.isSpreadElement)) return [];
    return ["Clock"];
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === root && ts.isObjectBindingPattern(parent.name)) {
    return ambientRequirementsForMembers(root.text, bindingMemberNames(parent.name, checker));
  }
  return ambientRequirementsForMembers(root.text, undefined);
}

/** Undefined means the whole root or a dynamically selected member escaped. */
function ambientRequirementsForMembers(
  root: string,
  members: readonly string[] | undefined,
): readonly AmbientAuthorityUse["requirement"][] {
  if (members === undefined) {
    if (root === "Date" || root === "performance" || root === "Intl") return ["Clock"];
    if (root === "Math") return ["Random"];
    return root === "crypto" ? ["Host"] : [];
  }
  const requirements = new Set<AmbientAuthorityUse["requirement"]>();
  for (const member of members) {
    if (root === "Date" && member === "now") requirements.add("Clock");
    else if (root === "Date" && !["parse", "UTC"].includes(member)) requirements.add("Clock");
    else if (root === "Math" && member === "random") requirements.add("Random");
    else if (root === "performance") requirements.add("Clock");
    else if (root === "crypto" && ["randomUUID", "getRandomValues"].includes(member)) requirements.add("Random");
    else if (root === "crypto") requirements.add("Host");
    // `Intl.DateTimeFormat` is charged at CONSTRUCTION, not at the `format()`
    // that reads the clock. Which calls read it depends on the arity of a call
    // on an instance the analysis would have to track — `format()` formats now,
    // `format(instant)` does not — and `resolvedOptions().timeZone` reads the
    // host zone with no call at all. Charging the constructor fails closed and
    // costs only the formatter, not the rest of `Intl`.
    else if (root === "Intl" && member === "DateTimeFormat") requirements.add("Clock");
  }
  return [...requirements].sort();
}

function bindingMemberNames(
  pattern: ts.ObjectBindingPattern,
  checker: ts.TypeChecker,
): readonly string[] | undefined {
  const names: string[] = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) return undefined;
    const name = element.propertyName ?? element.name;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
      names.push(name.text);
      continue;
    }
    if (ts.isComputedPropertyName(name)) {
      // Same shared answer as `memberSelection`: `const { [KEY]: now } = Date`
      // for `const KEY = "now"` selects `now`, so it is charged as `now` rather
      // than falling to the whole-root arm.
      const computed = staticKeyName(name.expression, checker);
      if (computed === undefined) return undefined;
      names.push(computed);
      continue;
    }
    return undefined;
  }
  return names;
}

function isAmbientGlobalReference(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  return ambientGlobalKind(identifier, checker) !== "local";
}

/**
 * How the ambient environment answers one identifier.
 *
 * - `"local"` — the program itself declares it, or it is an import alias. A
 *   lexical `const Date = …` is an ordinary value under any spelling.
 * - `"declared"` — every declaration lives in a declaration file, so the
 *   ambient lib publishes the name. THIS namespace is closed and enumerable,
 *   which is exactly what lets an allowlist over it be total where a denylist
 *   over "whatever the host publishes" never can be.
 * - `"undeclared"` — the name resolves to nothing. TypeScript refuses the
 *   program on its own here (TS2304/TS2591), so the language adds a refusal
 *   only for the names in `ALWAYS_FORBIDDEN_HOST_GLOBALS`; treating every
 *   unresolved identifier as a host global would answer an ordinary typo with
 *   "ambient host global 'lenght' is unavailable" and preempt the honest
 *   TypeScript diagnostic that names the real problem.
 *
 * A symbol with no declarations at all (`arguments`, and other checker-
 * synthesized bindings) is `"undeclared"` for the same reason: there is no
 * declaration file to attribute it to, so it is not evidence of a host global.
 *
 * The frontend prelude is `"local"` even though it is a declaration file: the
 * names it publishes (`Result`, `Panic`, `Reflect.panic`) are the LANGUAGE's
 * own surface, not the host's. The Go fork reaches the same answer by a
 * different route — its prelude is an ordinary `.ts` module carrying a
 * `declare global` block, so the declaration is not in a declaration file at
 * all — and the two must agree.
 */
function ambientGlobalKind(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): "local" | "declared" | "undeclared" {
  const symbol = referencedValueSymbol(identifier, checker);
  if (!symbol) return "undeclared";
  if (symbol.flags & ts.SymbolFlags.Alias) return "local";
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) return "undeclared";
  if (declarations.some((declaration) => declaration.getSourceFile().fileName.endsWith(PRELUDE_NAME))) {
    return "local";
  }
  return declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile)
    ? "declared"
    : "local";
}

/**
 * The host-global prohibition, as an allowlist.
 *
 * Every name the ambient environment publishes is refused unless ECMA-262
 * publishes it too, or unless it is one of the objects judged per operation:
 * the host-sensitive ones `ambientAuthorityUses` owns (`Math.max` stays
 * available while `Math.random` needs `Random`) and the dynamic-code ones
 * `dynamicCodeUse` owns. `ALWAYS_FORBIDDEN_HOST_GLOBALS` is refused
 * additionally by name, so that whether a `@types` package happens to be
 * installed cannot decide whether `process` is legal.
 */
function isForbiddenAmbientGlobal(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  const kind = ambientGlobalKind(identifier, checker);
  if (kind === "local") return false;
  if (ALWAYS_FORBIDDEN_HOST_GLOBALS.has(identifier.text)) return true;
  return kind === "declared" &&
    !UNIVERSAL_GLOBALS.has(identifier.text) &&
    !HOST_SENSITIVE_GLOBALS.has(identifier.text) &&
    !DYNAMIC_CODE_GLOBALS.has(identifier.text) &&
    // Refused by `checkHostGlobals` as SMITHERS1605 with a truthful reason.
    // Without this arm they would draw that refusal AND a SMITHERS1601 whose
    // remedy cannot be satisfied, at the same position.
    !NONDETERMINISTIC_GLOBALS.has(identifier.text);
}

function nearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node = node;
  while (current.parent) {
    const parent: ts.Node = current.parent;
    // A member's computed NAME is not inside the member; see
    // `evaluatedOutsideFunction`. Answering with the method there put a
    // top-level `{ [obj]() {} }` inside a function, so the module-scope
    // requirement pass never saw it.
    if (isSupportedFunctionLike(parent) && !evaluatedOutsideFunction(parent).includes(current)) return parent;
    current = parent;
  }
  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function isExported(node: ts.Node): boolean {
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return true;
  if (ts.isFunctionLike(node) && ts.isVariableDeclaration(node.parent)) {
    const statement = node.parent.parent.parent;
    return ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword);
  }
  return false;
}

function at(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  code: string,
  message: string,
  severity: "error" | "warning" = "error",
): PendingDiagnostic {
  return { severity, code, message, start: node.getStart(sourceFile) };
}

function lineAndColumn(sourceFile: ts.SourceFile, offset: number): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(Math.max(0, Math.min(offset, sourceFile.text.length)));
  return { line: position.line + 1, column: position.character + 1 };
}

