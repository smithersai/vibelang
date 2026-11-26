/**
 * Capabilities: a permission kernel (VIP-58).
 *
 * A capability names one operation on one resource, written
 * `action:resource`: `fs:write:/workspace/out.txt`. A policy lists the
 * patterns a program allows and the patterns it denies. {@link evaluate}
 * decides one capability against a policy and answers `"allow"`, `"deny"` or
 * `"ask"`. It is a pure function and runs on every platform.
 *
 * Rules:
 *
 * - Actions are a closed list, {@link actions}. A pattern may also name a
 *   whole namespace (`fs:*`) or every action (`*`).
 * - In a pattern's resource, `*` matches any run of characters, `/`
 *   included, and `?` matches exactly one. There is no escape, so a resource
 *   that holds `*` or `?` cannot be granted exactly. Never build a pattern
 *   from text a model or a user wrote.
 * - A deny anywhere in a policy is a veto. The order of a policy's patterns
 *   changes nothing.
 * - A request no pattern matches is `"ask"`, never `"allow"`.
 * - Answers given later, such as a person's replies, are ordered rules: the
 *   last one that matches wins. No answer overrides a policy's deny.
 * - What cannot be decided is denied: a pattern or capability that does not
 *   parse, and an absolute filesystem path that still holds a `.` or `..`
 *   segment.
 *
 * A tier ({@link tierOf}) says what repeating an operation costs. It governs
 * retry, caching and rollback, and it neither grants nor forbids.
 *
 * {@link guard} is the layer most programs use: it puts the check in front
 * of the `FileSystem`, `HttpClient` and `ChildProcessSpawner` services, so
 * code that never mentions permission is still checked.
 *
 * {@link check} asks the installed {@link GrantStore} before an operation
 * runs. {@link grantStore} installs one for a policy, and {@link journaled}
 * installs one that keeps remembered answers in a journal. With none installed,
 * nothing is guarded and `check` succeeds. A store that is asked something
 * its policy does not decide either fails with {@link PermissionRequired}
 * or, when it is attended, parks the operation until {@link reply} answers.
 *
 * A ceiling bounds what one Effect may ask for. {@link attenuate} narrows
 * it, and nothing widens it again. A ceiling grants nothing: an operation
 * inside it still needs the store's allow.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as EffectFileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as PlatformError from "effect/PlatformError"
import type * as Scope from "effect/Scope"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import * as ExperimentalChildProcess from "./ChildProcess.js"
import * as ExperimentalFileSystem from "./FileSystem.js"
import * as internal from "./internal/capability.js"
import * as guards from "./internal/capabilityGuard.js"
import * as Process from "./Process.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Capability"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Capability"

/**
 * An operation the kernel can authorize.
 *
 * @category models
 * @since 0.0.13
 */
export type Action = internal.Action

/**
 * Every action, in the order the vocabulary lists them.
 *
 * @category models
 * @since 0.0.13
 */
export const actions: ReadonlyArray<Action> = internal.actions

/**
 * What a pattern may name as its action: one action, one namespace
 * (`fs:*`), or every action (`*`).
 *
 * @category models
 * @since 0.0.13
 */
export type PatternAction = internal.PatternAction

/**
 * One operation on one resource.
 *
 * @category models
 * @since 0.0.13
 */
export interface Capability {
  readonly action: Action
  readonly resource: string
}

/**
 * A capability in text form, `action:resource`. The type checks the action
 * of a literal; {@link parse} checks a string at run time.
 *
 * @category models
 * @since 0.0.13
 */
export type CapabilityText = `${Action}:${string}`

/**
 * An action selector and a resource glob that select a family of
 * capabilities.
 *
 * @category models
 * @since 0.0.13
 */
export interface Pattern {
  readonly action: PatternAction
  readonly resource: string
}

/**
 * A pattern in text form, such as `fs:read:/workspace/**`. A bare `*` is
 * every action on every resource.
 *
 * @category models
 * @since 0.0.13
 */
export type PatternText = `${PatternAction}:${string}` | "*"

/**
 * A capability pattern accepted in policies, ceilings (`attenuate`), and
 * `static readonly capabilities` on `task` and `workflow` declarations.
 *
 * @category models
 * @since 0.0.13
 */
export type CapabilityPattern = Pattern | PatternText

/**
 * A step's declared effect envelope (`static readonly effects` on a `task` or
 * `workflow`): either a list of actions or capability patterns, or a structured
 * envelope naming its `reads` and `writes` (VIP-55, VIP-58).
 *
 * @category models
 * @since 0.0.13
 */
export type EffectEnvelope =
  | ReadonlyArray<Action | PatternAction | Pattern | PatternText>
  | {
      readonly reads?: ReadonlyArray<Action | PatternAction | Pattern | PatternText | `/${string}`> | undefined
      readonly writes?: ReadonlyArray<Action | PatternAction | Pattern | PatternText | `/${string}`> | undefined
      readonly mode?: string | undefined
      readonly onConflict?: string | undefined
      readonly tier?: Tier | undefined
    }

/**
 * One reached task in a workflow's derived plan (VIP-58).
 *
 * `tier` defaults to `"sealed"` when omitted; `tierDeclared` distinguishes an
 * explicit `static readonly tier` from that default. `capabilities` lists the
 * task's declared capability ceiling patterns in text form (`action:resource`),
 * or is `undefined` when omitted (meaning the task inherits its caller's
 * ceiling). Authority is never inferred from `R`.
 *
 * @category plans
 * @since 0.0.13
 */
export interface WorkflowPlanTask {
  readonly key: string
  readonly tier: Tier
  readonly tierDeclared: boolean
  readonly capabilities: ReadonlyArray<string> | undefined
  readonly effects?: EffectEnvelope | undefined
}

/**
 * The static plan derived for a `workflow` declaration (VIP-55, VIP-58).
 * Lists each reached task's declared `tier` and `capabilities` so a reviewer
 * or operator can inspect what the workflow may touch before running it.
 *
 * @category plans
 * @since 0.0.13
 */
export interface WorkflowPlan {
  readonly workflow: string
  readonly tier?: Tier | undefined
  readonly capabilities?: ReadonlyArray<string> | undefined
  readonly effects?: EffectEnvelope | undefined
  /** Reached tasks in discovery order (including through nested workflows). */
  readonly tasks: ReadonlyArray<WorkflowPlanTask>
  /** Alias of `tasks`, compatible with `Experimental.Durable.PlanNodes` and `Durable.diff`. */
  readonly nodes: ReadonlyArray<WorkflowPlanTask>
}

/**
 * What a program allows and what it denies. A deny is a veto: no allow in
 * the policy and no later answer overrides it.
 *
 * @category models
 * @since 0.0.13
 */
export interface Policy {
  readonly allow: ReadonlyArray<Pattern | PatternText>
  readonly deny?: ReadonlyArray<Pattern | PatternText> | undefined
}

/**
 * The result of evaluating one capability.
 *
 * @category models
 * @since 0.0.13
 */
export type Decision = "allow" | "deny" | "ask"

/**
 * One ordered rule: an answer given after the policy was written. Among
 * rules, the last one that matches wins.
 *
 * @category models
 * @since 0.0.13
 */
export interface Rule {
  readonly effect: Decision
  readonly pattern: Pattern | PatternText
}

/**
 * What repeating an operation costs. A `sealed` operation changes nothing, a
 * `compensable` one can be undone, and an `irreversible` one cannot.
 *
 * @category models
 * @since 0.0.13
 */
export type Tier = "sealed" | "compensable" | "irreversible"

/**
 * Builds a capability from its parts.
 *
 * @category constructors
 * @since 0.0.13
 */
export const make = (action: Action, resource: string): Capability => Object.freeze({ action, resource })

/**
 * Parses `action:resource`. The action is the first two colon-separated
 * parts; the rest is the resource, colons included. An unknown action, a
 * missing part, or a resource over 4096 UTF-16 code units is `None`.
 *
 * @category parsing
 * @since 0.0.13
 */
export const parse = (text: string): Option.Option<Capability> => Option.fromUndefinedOr(internal.parse(text))

/**
 * Parses a pattern. A bare `*` is every action on every resource.
 *
 * @category parsing
 * @since 0.0.13
 */
export const parsePattern = (text: string): Option.Option<Pattern> => Option.fromUndefinedOr(internal.parsePattern(text))

/**
 * The text form of a capability or a pattern, `action:resource`.
 *
 * @category formatting
 * @since 0.0.13
 */
export const format = (value: Capability | Pattern): string => internal.format(value)

// A caller's object is copied, never kept: a store holds what was asked,
// whatever the caller does to its object afterwards.
const toCapability = (input: Capability | string): internal.Capability | undefined =>
  typeof input === "string"
    ? internal.parse(input)
    : internal.isCapability(input)
    ? Object.freeze({ action: input.action, resource: input.resource })
    : undefined

const toPattern = (input: Pattern | string): internal.Pattern | undefined =>
  typeof input === "string"
    ? internal.parsePattern(input)
    : internal.isPattern(input)
    ? Object.freeze({ action: input.action, resource: input.resource })
    : undefined

/**
 * Whether a pattern selects a capability. A pattern or capability that does
 * not parse selects nothing and is selected by nothing.
 *
 * @category predicates
 * @since 0.0.13
 */
export const matches = (pattern: Pattern | PatternText, capability: Capability | CapabilityText): boolean => {
  const parsedPattern = toPattern(pattern)
  const parsedCapability = toCapability(capability)
  return parsedPattern !== undefined && parsedCapability !== undefined &&
    internal.matches(parsedPattern, parsedCapability)
}

/**
 * Decides one capability against a policy.
 *
 * A matching deny in the policy answers `"deny"`, wherever it stands and
 * whatever `answers` holds. Otherwise the last rule in `answers` that
 * matches decides. With no matching answer, a matching allow in the policy
 * answers `"allow"`, and a request nothing matches is `"ask"`.
 *
 * It answers `"deny"` for anything it cannot decide: a policy pattern, an
 * answer or a capability that does not parse, and an absolute filesystem
 * path with a `.` or `..` segment. An allow reaches `net:private` only when
 * it names that exact action, so `net:*` and `*` do not grant it.
 *
 * @category policy
 * @since 0.0.13
 */
export const evaluate = (
  policy: Policy,
  capability: Capability | CapabilityText,
  answers: ReadonlyArray<Rule> = []
): Decision => {
  const request = toCapability(capability)
  if (request === undefined) return "deny"
  const configured: Array<internal.Rule> = []
  const later: Array<internal.Rule> = []
  // Allows first, denies last: a matching deny is then the policy's own last
  // match, which is what the reduction treats as a veto.
  for (const [effect, patterns] of [["allow", policy.allow], ["deny", policy.deny ?? []]] as const) {
    for (const input of patterns) {
      const pattern = toPattern(input)
      if (pattern === undefined) return "deny"
      configured.push({ effect, pattern })
    }
  }
  for (const rule of answers) {
    const pattern = toPattern(rule.pattern)
    if (pattern === undefined || (rule.effect !== "allow" && rule.effect !== "deny" && rule.effect !== "ask")) {
      return "deny"
    }
    later.push({ effect: rule.effect, pattern })
  }
  return internal.evaluateRules([configured, later], request)
}

/**
 * The tier of an operation. Reads are `sealed`. An `fs:write` inside
 * `workspace` is `compensable`. An `fs:write` outside it, `net:post`,
 * `net:private`, `proc:spawn` and `memory:write` are `irreversible`, and so
 * is a capability that does not parse.
 *
 * Containment is by path text, with `.` and `..` segments folded. Resolve a
 * path's symbolic links before asking.
 *
 * @category tiers
 * @since 0.0.13
 */
export const tierOf = (
  capability: Capability | CapabilityText,
  options: { readonly workspace: string }
): Tier => {
  const request = toCapability(capability)
  return request === undefined ? "irreversible" : internal.tierOf(request, options.workspace)
}

const ErrorTypeId = "~vibelang/experimental/Capability/PermissionError"

/**
 * No rule decided the operation, and nobody is there to ask. `requestId`
 * names the request in the store that raised it.
 *
 * @category errors
 * @since 0.0.13
 */
export class PermissionRequired extends Data.TaggedError("PermissionRequired")<{
  readonly requestId: string
  readonly capability: Capability
  readonly tier: Tier
}> {
  /**
   * @since 0.0.13
   */
  readonly [ErrorTypeId] = ErrorTypeId

  /**
   * @since 0.0.13
   */
  override get message(): string {
    return `permission required: ${internal.displayField(format(this.capability))} (tier ${this.tier}, request ${
      internal.displayField(this.requestId)
    })`
  }
}

/**
 * A policy, a ceiling or a person refused the operation.
 *
 * @category errors
 * @since 0.0.13
 */
export class PermissionDenied extends Data.TaggedError("PermissionDenied")<{
  readonly capability: Capability
  readonly reason: string
}> {
  /**
   * @since 0.0.13
   */
  readonly [ErrorTypeId] = ErrorTypeId

  /**
   * @since 0.0.13
   */
  override get message(): string {
    return `permission denied: ${internal.displayField(format(this.capability))}: ${internal.displayField(this.reason)}`
  }
}

/**
 * Wraps a permission failure as the `PlatformError` a platform service
 * fails with. Effect fixes the error type of `FileSystem`, `HttpClient` and
 * `ChildProcessSpawner` operations, so a guarded service reports a refusal
 * as a `PermissionDenied` system error whose `cause` is the structured
 * failure. Read it back with {@link required} or {@link denied}.
 *
 * @category errors
 * @since 0.0.13
 */
export const toPlatformError = (options: {
  readonly module: string
  readonly method: string
  readonly pathOrDescriptor?: string | number | undefined
  readonly error: PermissionRequired | PermissionDenied
}): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: options.module,
    method: options.method,
    description: options.error.message,
    ...(options.pathOrDescriptor === undefined ? {} : {
      pathOrDescriptor: typeof options.pathOrDescriptor === "string"
        ? internal.displayField(options.pathOrDescriptor)
        : options.pathOrDescriptor
    }),
    cause: options.error
  })

const causeOf = (error: PlatformError.PlatformError | HttpClientError.HttpClientError, tag: string): unknown => {
  const reason = error.reason
  if (reason._tag !== "PermissionDenied" && reason._tag !== "TransportError") return undefined
  const cause = reason.cause as { readonly _tag?: unknown; readonly [ErrorTypeId]?: unknown } | null | undefined
  return typeof cause === "object" && cause !== null && cause._tag === tag && cause[ErrorTypeId] === ErrorTypeId
    ? cause
    : undefined
}

/**
 * Reads a {@link PermissionRequired} back out of the failure of a guarded
 * service: the `PlatformError` of `FileSystem` and `ChildProcessSpawner`, or
 * the `HttpClientError` of `HttpClient`. `None` for any other failure, the
 * operating system's own `EACCES` included.
 *
 * @category errors
 * @since 0.0.13
 */
export const required = (
  error: PlatformError.PlatformError | HttpClientError.HttpClientError
): Option.Option<PermissionRequired> =>
  Option.fromUndefinedOr(causeOf(error, "PermissionRequired") as PermissionRequired | undefined)

/**
 * Reads a {@link PermissionDenied} back out of the failure of a guarded
 * service. `None` for any other failure, the operating system's own `EACCES`
 * included.
 *
 * @category errors
 * @since 0.0.13
 */
export const denied = (
  error: PlatformError.PlatformError | HttpClientError.HttpClientError
): Option.Option<PermissionDenied> =>
  Option.fromUndefinedOr(causeOf(error, "PermissionDenied") as PermissionDenied | undefined)

class CurrentCeiling extends Context.Reference<internal.Ceiling>("vibelang/experimental/Capability/Ceiling", {
  defaultValue: () => internal.noCeiling
}) {}

// A pattern that does not parse leaves the empty group, which nothing is
// inside: a ceiling that cannot be read forbids everything.
const toGroup = (patterns: ReadonlyArray<Pattern | PatternText>): ReadonlyArray<internal.Pattern> => {
  const group: Array<internal.Pattern> = []
  for (const input of patterns) {
    const pattern = toPattern(input)
    if (pattern === undefined) return []
    group.push(pattern)
  }
  return group
}

/**
 * The ceiling of the current fiber: groups of patterns, one per
 * {@link attenuate} it passed through. An operation is inside the ceiling
 * when every group holds a pattern that selects it. A fiber that never
 * passed through `attenuate` has no groups and no ceiling.
 *
 * @category ceilings
 * @since 0.0.13
 */
export const ceiling: Effect.Effect<ReadonlyArray<ReadonlyArray<Pattern>>> = Effect.service(CurrentCeiling)

/**
 * Narrows what one Effect may ask for. The Effect, and every fiber it
 * forks, may ask only for operations that `patterns` select and that every
 * enclosing `attenuate` also selects. No `attenuate`, grant store or guard
 * inside it widens the ceiling again.
 *
 * The ceiling travels in the Effect's context, as the grant store does. An
 * Effect that is given a context captured outside the `attenuate`, through
 * `Effect.provide` or a runtime, runs under that context's ceiling: holding
 * a context is holding its authority.
 *
 * A ceiling grants nothing: an operation inside it still needs the grant
 * store's allow. `attenuate([])` forbids every checked operation, and so
 * does a group with a pattern that does not parse.
 *
 * @category ceilings
 * @since 0.0.13
 */
export const attenuate = (patterns: ReadonlyArray<Pattern | PatternText>) => {
  const group = toGroup(patterns)
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.updateService(effect, CurrentCeiling, (parent) => internal.narrow(parent, group))
}

/**
 * An operation waiting for a person's answer.
 *
 * @category grant store
 * @since 0.0.13
 */
export interface Request {
  readonly requestId: string
  readonly capability: Capability
  readonly tier: Tier
}

/**
 * A person's answer to a {@link Request}. `"once"` lets this one operation
 * run. `"run"` also lets every later operation with the same action and
 * resource run, for as long as the store lives. `"remembered"` does the
 * same and, in a {@link journaled} store, records the grant in the journal
 * first, so a store built over that journal later starts with it. `"deny"`
 * fails the operation with {@link PermissionDenied}.
 *
 * @category grant store
 * @since 0.0.13
 */
export type Answer = "once" | "run" | "remembered" | "deny"

/**
 * A remembered grant as a journal holds it: plain data, safe to encode as
 * JSON.
 *
 * @category journal
 * @since 0.0.13
 */
export interface RememberedGrant {
  readonly requestId: string
  readonly capability: Capability
  readonly tier: Tier
}

/**
 * Where remembered grants are kept. A durable run's journal is one: a run
 * that asked once and was answered `"remembered"` does not ask again after
 * it crashes and resumes.
 *
 * @category journal
 * @since 0.0.13
 */
export interface Journal {
  /**
   * The grants recorded so far, oldest first. Each is read as untrusted
   * data: an entry that is not a capability grants nothing.
   */
  readonly remembered: Effect.Effect<ReadonlyArray<unknown>>
  /**
   * Records a grant. The grant takes effect only after this succeeds, and
   * the reply waits for it without interruption: it must complete or fail.
   */
  readonly remember: (grant: RememberedGrant) => Effect.Effect<void>
}

/**
 * The journal a {@link journaled} store writes to.
 *
 * @category journal
 * @since 0.0.13
 */
export class GrantJournal extends Context.Service<GrantJournal, Journal>()("vibelang/experimental/Capability/GrantJournal") {}

/**
 * What decides whether an operation may run.
 *
 * @category grant store
 * @since 0.0.13
 */
export interface Store {
  /**
   * Succeeds when the operation may run. Fails with {@link PermissionDenied}
   * when a ceiling, the policy or a person refuses it, and with
   * {@link PermissionRequired} when nothing decides it and nobody is asked.
   */
  readonly check: (capability: Capability | CapabilityText) => Effect.Effect<void, PermissionDenied | PermissionRequired>
  /**
   * The operations waiting for an answer, oldest first.
   */
  readonly pending: Effect.Effect<ReadonlyArray<Request>>
  /**
   * Answers a waiting operation. `false` when no operation with that id is
   * waiting, because it was answered, interrupted, or never asked.
   */
  readonly reply: (requestId: string, answer: Answer) => Effect.Effect<boolean>
}

const maximumPending = 1024
const maximumGrants = 1024

const describe = (input: unknown): string => {
  const record = input as { readonly action?: unknown; readonly resource?: unknown } | null
  return internal.displayField(
    typeof input === "string"
      ? input
      : typeof record === "object" && record !== null
      ? `${String(record.action)}:${String(record.resource)}`
      : String(input)
  )
}

// Reads the request and tests it against the fiber's ceiling. A request
// that names no action is a defect in the caller; one whose resource is too
// long to match is refused.
const admit = (input: Capability | CapabilityText): Effect.Effect<internal.Capability, PermissionDenied> =>
  Effect.flatMap(Effect.service(CurrentCeiling), (current) => {
    const capability = toCapability(input)
    if (capability === undefined) {
      const parsed = typeof input === "string" ? undefined : input
      if (parsed !== undefined && internal.isAction(parsed.action) && typeof parsed.resource === "string") {
        return Effect.fail(
          new PermissionDenied({
            capability: make(parsed.action, parsed.resource.slice(0, internal.maxResourceLength)),
            reason: `the resource is longer than ${internal.maxResourceLength} code units`
          })
        )
      }
      return Effect.die(new Error(`Capability.check: not a capability: ${describe(input)}`))
    }
    return internal.ceilingAllows(current, capability)
      ? Effect.succeed(capability)
      : Effect.fail(new PermissionDenied({ capability, reason: "outside capability ceiling" }))
  })

// With no store installed, nothing is guarded. A ceiling still narrows.
const openStore: Store = {
  check: (capability) => Effect.asVoid(admit(capability)),
  pending: Effect.succeed([]),
  reply: () => Effect.succeed(false)
}

/**
 * The grant store the current fiber asks. {@link grantStore} installs one
 * for a policy. A test or a host installs its own with
 * `Layer.succeed(GrantStore, store)`. The default allows every operation
 * inside the fiber's ceiling.
 *
 * @category grant store
 * @since 0.0.13
 */
export class GrantStore extends Context.Reference<Store>("vibelang/experimental/Capability/GrantStore", {
  defaultValue: () => openStore
}) {}

/**
 * A policy and how a store built for it behaves.
 *
 * @category grant store
 * @since 0.0.13
 */
export interface GrantStoreOptions extends Policy {
  /**
   * The directory an `fs:write` must be inside to be `compensable`. With
   * none, every write is `irreversible`.
   */
  readonly workspace?: string | undefined
  /**
   * Whether a person answers what the policy does not decide. `true`, the
   * default, parks the operation until {@link reply}. `false` fails it with
   * {@link PermissionRequired}.
   */
  readonly attended?: boolean | undefined
}

interface Waiting extends Request {
  readonly capability: internal.Capability
  readonly deferred: Deferred.Deferred<void, PermissionDenied>
  readonly exact: boolean
}

const sameCapability = (left: Capability, right: Capability): boolean =>
  left.action === right.action && left.resource === right.resource

// Stores built inside one another share one sequence of request ids, so an
// id names one request wherever it is answered from.
const sequences = new WeakMap<Store, { next: number }>()

/**
 * What a guard's service tells the store about the operation it asks for.
 */
interface Asking {
  /**
   * The operation covers everything under the resource, such as a recursive
   * remove. A deny that could select something inside refuses it.
   */
  readonly tree?: boolean | undefined
  /**
   * `false` when the resource does not say exactly what will run, because a
   * secret in it is shown as a placeholder. Such a request is never granted
   * for later ones: `"run"` and `"remembered"` answer this operation only.
   */
  readonly exact?: boolean | undefined
}

type Ask = (capability: Capability | CapabilityText, asking?: Asking) => Effect.Effect<void, PermissionDenied | PermissionRequired>

// The decisions an operation must pass in a store, outermost first: one per
// store it was built inside, then its own. A store installed by hand is one
// decision, its `check`.
const chains = new WeakMap<Store, ReadonlyArray<Ask>>()

// A store installed by hand is asked through one function per store object:
// a store written as a class reads `this` in `check`, and two stores of one
// class share that method, so neither the method nor a detached reference
// to it can stand for the store.
const bound = new WeakMap<Store, Ask>()

// What a built store's own policy denies outright, asked without parking
// anything: the refusal, or none.
const vetoes = new WeakMap<Ask, (capability: internal.Capability) => PermissionDenied | undefined>()

const chainOf = (store: Store): ReadonlyArray<Ask> => {
  const built = chains.get(store)
  if (built !== undefined) return built
  let ask = bound.get(store)
  if (ask === undefined) {
    ask = (capability) => store.check(capability)
    bound.set(store, ask)
  }
  return [ask]
}

interface Built {
  /** The store to install: every enclosing decision, then this one's. */
  readonly store: Store
  /** The decisions a guard's services ask, outermost first. */
  readonly chain: ReadonlyArray<Ask>
}

const makeStore = (
  options: GrantStoreOptions,
  journal: Option.Option<Journal> = Option.none()
): Effect.Effect<Built, never, Scope.Scope> =>
  Effect.gen(function*() {
    const parent = yield* Effect.service(GrantStore)
    const sequence = sequences.get(parent) ?? { next: 1 }
    // Allows first, denies last: a matching deny is then the policy's own
    // last match, which the reduction treats as a veto.
    const configured: Array<internal.Rule> = []
    for (const [effect, patterns] of [["allow", options.allow], ["deny", options.deny ?? []]] as const) {
      for (const input of patterns) {
        const pattern = toPattern(input)
        if (pattern === undefined) {
          return yield* Effect.die(new Error(`Capability.grantStore: not a capability pattern: ${describe(input)}`))
        }
        configured.push({ effect, pattern })
      }
    }
    const attended = options.attended ?? true
    const workspace = options.workspace ?? "."
    const granted: Array<internal.Capability> = []
    // A journal is data from an earlier process. An entry grants only when
    // it reads as a capability, and never past the limit.
    if (Option.isSome(journal)) {
      for (const entry of yield* journal.value.remembered) {
        const recorded = toCapability((entry as { readonly capability?: unknown } | null)?.capability as Capability)
        if (recorded !== undefined && granted.length < maximumGrants) granted.push(recorded)
      }
    }
    // Request ids being recorded: a second answer to one of them is refused.
    const recording = new Set<string>()
    const waiting = new Map<string, Waiting>()
    let closed = false

    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        closed = true
        const entries = [...waiting.values()]
        waiting.clear()
        return Effect.forEach(
          entries,
          (entry) => Deferred.fail(entry.deferred, new PermissionDenied({ capability: entry.capability, reason: "grant store closed" })),
          { discard: true }
        )
      })
    )

    const own: Ask = (input, asking) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.flatMap(admit(input), (capability) =>
          // One synchronous step from the decision to the registration, so a
          // store that closes cannot slip in between and leave a waiter.
          Effect.suspend((): Effect.Effect<void, PermissionDenied | PermissionRequired> => {
            if (closed) return Effect.fail(new PermissionDenied({ capability, reason: "grant store closed" }))
            const decision = internal.evaluateRules([configured], capability)
            if (decision === "deny") {
              return Effect.fail(new PermissionDenied({ capability, reason: "denied by permission policy" }))
            }
            if (asking?.tree === true && internal.deniesInside(configured, capability)) {
              return Effect.fail(
                new PermissionDenied({ capability, reason: "a deny in the policy selects something inside this tree" })
              )
            }
            const exact = asking?.exact !== false
            if (decision === "allow" || (exact && granted.some((grant) => sameCapability(grant, capability)))) {
              return Effect.void
            }
            const tier = internal.tierOf(capability, workspace)
            if (!attended) {
              return Effect.fail(new PermissionRequired({ requestId: `permission-${sequence.next++}`, capability, tier }))
            }
            if (waiting.size >= maximumPending) {
              return Effect.fail(new PermissionDenied({ capability, reason: "too many pending permission requests" }))
            }
            const requestId = `permission-${sequence.next++}`
            const deferred = Deferred.makeUnsafe<void, PermissionDenied>()
            waiting.set(requestId, { requestId, capability, tier, deferred, exact })
            return restore(Deferred.await(deferred)).pipe(
              Effect.ensuring(Effect.sync(() => void waiting.delete(requestId)))
            )
          }))
      )

    vetoes.set(own, (capability) =>
      !closed && internal.evaluateRules([configured], capability) === "deny"
        ? new PermissionDenied({ capability, reason: "denied by permission policy" })
        : undefined)

    const ownPending: Store["pending"] = Effect.sync(() =>
      Array.from(waiting.values(), ({ requestId, capability, tier }): Request => ({ requestId, capability, tier }))
    )

    // An answer changes the store and completes the waiters in one
    // synchronous step, so no interruption can leave a waiter removed and
    // never resumed.
    const once = (entry: Waiting): void => {
      waiting.delete(entry.requestId)
      Deferred.doneUnsafe(entry.deferred, Effect.void)
    }

    // Past the limit the answer still lets this operation through. A grant
    // being written to the journal has its place kept, so the journal and
    // the store never disagree about it.
    const full = (): boolean => granted.length + recording.size >= maximumGrants

    const grant = (entry: Waiting, placeKept = false): void => {
      if (!placeKept && full()) return once(entry)
      granted.push(entry.capability)
      for (const other of [...waiting.values()]) {
        if (other.exact && sameCapability(other.capability, entry.capability)) once(other)
      }
    }

    const ownReply: Store["reply"] = (requestId, answer) =>
      Effect.suspend(() => {
        const entry = waiting.get(requestId)
        if (
          entry === undefined || recording.has(requestId) ||
          (answer !== "once" && answer !== "run" && answer !== "remembered" && answer !== "deny")
        ) {
          return Effect.succeed(false)
        }
        if (answer === "deny") {
          waiting.delete(requestId)
          Deferred.doneUnsafe(
            entry.deferred,
            Effect.fail(new PermissionDenied({ capability: entry.capability, reason: "permission request denied" }))
          )
          return Effect.succeed(true)
        }
        // A request whose text hides a secret is answered for itself alone.
        if (answer === "once" || !entry.exact) {
          once(entry)
          return Effect.succeed(true)
        }
        if (answer === "run" || Option.isNone(journal)) {
          grant(entry)
          return Effect.succeed(true)
        }
        // Write first, grant second. The operation stays parked while the
        // journal is written, and if the write fails nothing was granted.
        // Once the write has landed the grant follows without interruption,
        // even if the asker has gone: the journal and the store must agree.
        // The request is marked as being recorded inside the uninterruptible
        // step, so an interruption cannot leave the mark behind. At the
        // grant limit nothing more is granted, so nothing is written: the
        // answer lets this operation through, as `"once"` does.
        return Effect.uninterruptible(
          Effect.suspend(() => {
            if (recording.has(requestId)) return Effect.succeed(false)
            if (full()) {
              once(entry)
              return Effect.succeed(true)
            }
            recording.add(requestId)
            return journal.value.remember({ requestId, capability: entry.capability, tier: entry.tier }).pipe(
              Effect.andThen(Effect.sync(() => {
                recording.delete(requestId)
                grant(entry, true)
                return true
              })),
              Effect.ensuring(Effect.sync(() => void recording.delete(requestId)))
            )
          })
        )
      })

    // A store never widens the one it was built inside: every enclosing
    // store decides first, and an operation runs only when all let it.
    const chain = [...chainOf(parent), own]
    const store: Store = {
      check: (input) => Effect.forEach(chain, (ask) => ask(input), { discard: true }),
      pending: Effect.zipWith(parent.pending, ownPending, (outer, inner) => [...outer, ...inner]),
      reply: (requestId, answer) =>
        Effect.flatMap(ownReply(requestId, answer), (answered) => answered ? Effect.succeed(true) : parent.reply(requestId, answer))
    }
    sequences.set(store, sequence)
    chains.set(store, chain)
    return { store, chain }
  })

/**
 * Installs a grant store for a policy.
 *
 * A check is decided in this order: outside the fiber's ceiling is
 * {@link PermissionDenied}; a matching deny is `PermissionDenied`; a
 * matching allow, or an earlier `"run"` answer for the same operation,
 * succeeds; anything else asks. An attended store parks the asking fiber
 * until {@link reply}. An unattended one fails with
 * {@link PermissionRequired}.
 *
 * A store built inside another never widens it: the enclosing store
 * decides first, and an operation runs only when both let it.
 *
 * The store lives as long as the layer's scope. Closing it fails every
 * waiting operation with `PermissionDenied`. A policy pattern that does not
 * parse is a defect when the layer is built.
 *
 * The layer is built each time it is provided, never shared: a store is
 * built inside whatever store is installed where it is provided, so the
 * same layer provided again further in is narrowed by everything between.
 *
 * @category grant store
 * @since 0.0.13
 */
export const grantStore = (options: GrantStoreOptions): Layer.Layer<never> =>
  Layer.fresh(Layer.effect(GrantStore, Effect.map(makeStore(options), (built) => built.store)))

/**
 * Installs a grant store that keeps remembered grants in a journal.
 *
 * It is {@link grantStore} with two differences. When it is built, it
 * starts with every grant the journal holds. When a person answers
 * `"remembered"`, it writes the grant to the journal before the grant takes
 * effect: a journal that fails leaves the operation parked and grants
 * nothing. `"run"` and `"once"` are not written. A store holds at most
 * 1,024 grants: past that, `"remembered"` lets the one operation through
 * and writes nothing.
 *
 * The journal is the {@link GrantJournal} service. A durable engine
 * provides one for a run. {@link guard} uses the journal too when one is
 * provided where the guard is built.
 *
 * @category journal
 * @since 0.0.13
 */
export const journaled = (options: GrantStoreOptions): Layer.Layer<never, never, GrantJournal> =>
  Layer.fresh(Layer.effect(
    GrantStore,
    Effect.flatMap(Effect.service(GrantJournal), (journal) =>
      Effect.map(makeStore(options, Option.some(journal)), (built) => built.store))
  ))

/**
 * Asks the installed grant store whether an operation may run. Call it
 * before the operation, with the resource the operation will touch. With no
 * store installed it succeeds for every operation inside the fiber's
 * ceiling.
 *
 * @category grant store
 * @since 0.0.13
 */
export const check = (capability: Capability | CapabilityText): Effect.Effect<void, PermissionDenied | PermissionRequired> =>
  Effect.flatMap(Effect.service(GrantStore), (store) => store.check(capability))

/**
 * The operations waiting for an answer in the installed grant store.
 *
 * @category grant store
 * @since 0.0.13
 */
export const pending: Effect.Effect<ReadonlyArray<Request>> = Effect.flatMap(Effect.service(GrantStore), (store) => store.pending)

/**
 * Answers a waiting operation in the installed grant store. `false` when
 * no operation with that id is waiting.
 *
 * @category grant store
 * @since 0.0.13
 */
export const reply = (requestId: string, answer: Answer): Effect.Effect<boolean> =>
  Effect.flatMap(Effect.service(GrantStore), (store) => store.reply(requestId, answer))

/**
 * A policy and how a guard built for it behaves.
 *
 * @category guard
 * @since 0.0.13
 */
export interface GuardOptions extends Policy {
  /**
   * The directory an `fs:write` must be inside to be `compensable`, and a
   * command's working directory must be inside to stay out of its request.
   * With none, every write is `irreversible`.
   */
  readonly workspace?: string | undefined
  /**
   * Whether a person answers what the policy does not decide. `false`, the
   * default, fails the operation with {@link PermissionRequired}, because a
   * parked operation nobody answers hangs a program. `true` parks it until
   * {@link reply}.
   */
  readonly attended?: boolean | undefined
}

/**
 * A layer that puts a permission check in front of the platform services.
 * It replaces `FileSystem`, `HttpClient` and `ChildProcessSpawner` with
 * checked versions, in place, so code that never mentions permission is
 * still checked, and it installs the grant store {@link check} asks.
 *
 * | Service | Asks |
 * | --- | --- |
 * | `FileSystem` | `fs:read` or `fs:write` on the resolved path |
 * | `HttpClient` | `net:get` for `GET` and `HEAD`, `net:post` otherwise, on the URL, again for every redirect |
 * | `ChildProcessSpawner` | `proc:spawn` on the command line, for every stage of a pipeline |
 *
 * A refused operation fails with the service's own error type, a
 * `PlatformError` or an `HttpClientError`. {@link required} and
 * {@link denied} read the structured refusal back out.
 *
 * Provide it inside the platform layer: the guard decorates the services it
 * finds where it is built, and it is a defect to build it where none of the
 * three exists. Code inside the guard that provides a platform service of
 * its own replaces the checked one. A `.ts` file that imports `node:fs`
 * never reaches the guard, and neither does what a spawned process does.
 *
 * Guards combine by nesting: a guard provided inside another is narrowed by
 * it, and the layer is built each time it is provided. Two guards merged
 * side by side with `Layer.mergeAll` are two layers that provide the same
 * services, so the later one replaces the earlier one, deny included.
 *
 * A path is resolved before it is asked about, and the operation runs on
 * the resolved path. The guard does not pin a directory handle, so a
 * process that swaps a symbolic link between the check and the operation
 * can redirect it.
 *
 * @category guard
 * @since 0.0.13
 */
export const guard = (options: GuardOptions): Layer.Layer<never> =>
  Layer.fresh(Layer.effectContext(Effect.gen(function*() {
    const fileSystem = yield* Effect.serviceOption(EffectFileSystem.FileSystem)
    const experimentalFileSystem = yield* Effect.serviceOption(ExperimentalFileSystem.FileSystem)
    const client = yield* Effect.serviceOption(HttpClient.HttpClient)
    const spawner = yield* Effect.serviceOption(ChildProcessSpawner)
    const runner = yield* Effect.serviceOption(ExperimentalChildProcess.ChildProcess)
    if (
      Option.isNone(fileSystem) && Option.isNone(experimentalFileSystem) && Option.isNone(client) && Option.isNone(spawner) &&
      Option.isNone(runner)
    ) {
      return yield* Effect.die(
        new Error(
          "Capability.guard found no FileSystem, HttpClient or ChildProcessSpawner to guard. Provide it inside the platform layer: " +
            "`provide Experimental.Capability.guard(policy) { … }` in code that runs under the platform services, " +
            "or `Layer.provideMerge(Experimental.Capability.guard(policy), platformLayer)`."
        )
      )
    }
    const ambientPath = yield* Effect.serviceOption(Path.Path)
    const path = Option.isSome(ambientPath) ? ambientPath.value : Context.get(yield* Layer.build(Path.layer), Path.Path)
    const process = yield* Effect.serviceOption(Process.Process)
    const anyResolver = Option.map(
      Option.orElse(fileSystem, (): Option.Option<EffectFileSystem.FileSystem> => experimentalFileSystem),
      guards.resolverOf
    )

    // Resources are resolved paths, so the workspace is resolved too.
    const lexicalWorkspace = options.workspace === undefined ? undefined : path.resolve(options.workspace)
    const workspace = lexicalWorkspace === undefined || Option.isNone(anyResolver)
      ? lexicalWorkspace
      : yield* Effect.orElseSucceed(anyResolver.value.realPath(lexicalWorkspace), () => lexicalWorkspace)

    const built = yield* makeStore(
      { ...options, workspace, attended: options.attended ?? false },
      yield* Effect.serviceOption(GrantJournal)
    )
    // A checked service asks every store in the chain that the service
    // underneath does not already ask, outermost first. A guard inside a
    // plain store asks the store too, and a guard inside a guard leaves the
    // outer guard's question to the outer guard's own service, so one
    // operation is one question to each store.
    const kernelFor = (underneath: object): guards.Kernel<PermissionDenied | PermissionRequired> => {
      const already = guards.askedBy(underneath)
      const mine = built.chain.filter((ask) => !already.has(ask))
      return {
        check: (action, resource, asking) => {
          const capability = make(action, resource)
          return Effect.forEach(mine, (ask) => ask(capability, asking), { discard: true })
        },
        denied: (action, resource, reason) =>
          new PermissionDenied({ capability: make(action, resource.slice(0, internal.maxResourceLength)), reason }),
        // Every store in the chain is read, the ones the service underneath
        // asks included: that service is handed the resolved path, and a
        // deny holds for the path as it was written.
        vetoed: (action, resource) => {
          if (resource.length > internal.maxResourceLength) return undefined
          const capability = make(action, resource)
          for (const ask of built.chain) {
            const refusal = vetoes.get(ask)?.(capability)
            if (refusal !== undefined) return refusal
          }
          return undefined
        },
        message: (error) => error.message,
        platformError: toPlatformError
      }
    }
    const checked = <S extends object>(underneath: object, service: S): S =>
      guards.withAsked(service, new Set([...guards.askedBy(underneath), ...built.chain]))
    const temporaryDirectory = Option.map(process, (service) => service.temporaryDirectory)

    let context = Context.make(GrantStore, built.store)
    if (Option.isSome(fileSystem)) {
      const resolver = guards.resolverOf(fileSystem.value)
      const primitives = guards.fileSystemPrimitives(fileSystem.value, resolver, path, kernelFor(fileSystem.value), temporaryDirectory)
      context = Context.add(
        context,
        EffectFileSystem.FileSystem,
        checked(fileSystem.value, guards.withResolver(guards.fileSystem(primitives), resolver))
      )
    }
    if (Option.isSome(experimentalFileSystem)) {
      const resolver = guards.resolverOf(experimentalFileSystem.value)
      const primitives = guards.fileSystemPrimitives(
        experimentalFileSystem.value,
        resolver,
        path,
        kernelFor(experimentalFileSystem.value),
        temporaryDirectory
      )
      context = Context.add(
        context,
        ExperimentalFileSystem.FileSystem,
        checked(
          experimentalFileSystem.value,
          guards.withResolver(
            ExperimentalFileSystem.make(guards.fileSystem(primitives), { access: primitives.access, open: primitives.open }),
            resolver
          )
        )
      )
    }
    if (Option.isSome(client)) {
      context = Context.add(context, HttpClient.HttpClient, checked(client.value, guards.httpClient(client.value, kernelFor(client.value))))
    }
    const where: guards.Where = { path, workspace, realPath: Option.map(anyResolver, (resolver) => resolver.realPath) }
    if (Option.isSome(spawner)) {
      context = Context.add(
        context,
        ChildProcessSpawner,
        checked(spawner.value, guards.childProcessSpawner(spawner.value, kernelFor(spawner.value), where))
      )
    }
    if (Option.isSome(runner)) {
      context = Context.add(
        context,
        ExperimentalChildProcess.ChildProcess,
        checked(runner.value, guards.inheritedRunner(runner.value, kernelFor(runner.value), where))
      )
    }
    return context as Context.Context<never>
  })))
