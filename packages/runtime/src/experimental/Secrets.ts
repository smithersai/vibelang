/**
 * Secrets a step uses without holding them (VIP-68).
 *
 * A step holds a placeholder, `vibe-secret-` and 64 hexadecimal characters.
 * {@link egress} is a layer that replaces `HttpClient` with one that puts a
 * secret's value in place of its placeholder only on an outbound HTTPS
 * request to one of that secret's own hosts, by one of its methods, and
 * scrubs every echo of every value from the answer before the step reads it.
 *
 * ```ts
 * provide Experimental.Secrets.egress([{ name: "STRIPE_KEY", hosts: ["api.stripe.com"] }]) {
 *   const key = try Experimental.Secrets.placeholder("STRIPE_KEY")
 *   const http = try HttpClient.HttpClient
 *   return try http.get("https://api.stripe.com/v1/charges", { headers: { authorization: `Bearer ${key}` } })
 * }
 * ```
 *
 * Rules:
 *
 * 1. **Exact audiences.** The value replaces the placeholder only for a host
 *    that is exactly one of the secret's `hosts`, a method in its `methods`,
 *    the scheme's own port, and HTTPS.
 * 2. **Headers only.** A placeholder in a URL or a body reaches the host as
 *    the placeholder.
 * 3. **No redirects.** A 3xx answer returns to the step with its headers
 *    scrubbed. The step's next request is checked again.
 * 4. **Echoes are scrubbed** from every answer's headers and body, whichever
 *    host answers: the value, its percent, JSON and base64 encodings, across
 *    chunk boundaries.
 * 5. **Audited by name, before sending.** A request the {@link Audit} cannot
 *    record is not sent. The value is never recorded.
 * 6. **A host outside every binding** is refused unless `allow` names it.
 * 7. **Bounded.** At most 16 placeholders a request and 64 KiB of headers
 *    after substitution. A value is 8 bytes to 16 KiB of text with no
 *    control character.
 * 8. **Placeholders are derived, not stored**, with HMAC-SHA-256 from a key
 *    the host holds (`SECRETS_PLACEHOLDER_KEY`, at least 32 characters, or
 *    one made for the process), a scope and the name. A new scope gets new
 *    placeholders; the old ones are refused as `unknown_placeholder`.
 * 9. **The vault is injected.** {@link Vault} reads `Config.Redacted(name)`
 *    unless a host provides another, such as {@link fixtures} in a test.
 *
 * What it does not stop: abuse of an allowed host by anything holding a
 * placeholder, an echo transformed beyond the forms above, a request that
 * needs the value in its body, and a program that goes around the egress.
 *
 * Ported from the reference engine's secrets package: `Binding`,
 * `Placeholder`, `Egress` and `Scrub`. It imports no Node built-in.
 *
 * @since 0.0.14
 */
import * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { constTrue } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import type { HttpMethod } from "effect/http/HttpMethod"
import type * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Url from "effect/http/Url"
import * as internal from "./internal/secrets.js"

/**
 * @since 0.0.14
 */
export type TypeId = "~vibelang/experimental/Secrets"

/**
 * @since 0.0.14
 */
export const TypeId: TypeId = "~vibelang/experimental/Secrets"

/**
 * A method a secret may be used with.
 *
 * @category models
 * @since 0.0.14
 */
export type Method = internal.Method

/**
 * The methods a binding may list.
 *
 * @category constants
 * @since 0.0.14
 */
export const methods: ReadonlyArray<Method> = internal.methods

/**
 * What a secret is bound to: a name matching `^[A-Z_][A-Z0-9_]{0,63}$`, 1 to
 * 16 lowercase DNS hosts, and the methods it may be used with, every method
 * when absent.
 *
 * @category models
 * @since 0.0.14
 */
export interface Binding {
  readonly name: string
  readonly hosts: ReadonlyArray<string>
  readonly methods?: ReadonlyArray<Method> | undefined
}

/**
 * What every placeholder starts with.
 *
 * @category constants
 * @since 0.0.14
 */
export const prefix: string = internal.prefix

/**
 * The most distinct placeholders one request may carry.
 *
 * @category constants
 * @since 0.0.14
 */
export const maximumPlaceholders: number = internal.maximumPlaceholders

/**
 * The most bytes a request's headers may total after substitution.
 *
 * @category constants
 * @since 0.0.14
 */
export const maximumHeaderBytes: number = internal.maximumHeaderBytes

/**
 * The shortest and longest value, in UTF-8 bytes.
 *
 * @category constants
 * @since 0.0.14
 */
export const valueBytes: { readonly minimum: number; readonly maximum: number } = {
  minimum: internal.minimumValueBytes,
  maximum: internal.maximumValueBytes
}

/**
 * Whether `text` is exactly one placeholder.
 *
 * @category predicates
 * @since 0.0.14
 */
export const isPlaceholder = (text: string): boolean => internal.isPlaceholder(text)

/**
 * Whether `text` is a host a secret may be bound to: a lowercase DNS name of
 * two or more labels, with no wildcard, port or IP address.
 *
 * @category predicates
 * @since 0.0.14
 */
export const isHost = (text: string): boolean => internal.isHost(text)

/**
 * Why the egress refused a request, with the status a sandbox's guest gets
 * for it from {@link forward}.
 *
 * @category models
 * @since 0.0.14
 */
export const refusals: Readonly<Record<Refusal, number>> = internal.refusals

/**
 * A refusal's code: `invalid_url`, `port_not_allowed`, `host_not_allowed`,
 * `unknown_placeholder`, `secret_not_allowed`, `insecure_scheme`,
 * `too_many_placeholders` or `headers_too_large`.
 *
 * @category models
 * @since 0.0.14
 */
export type Refusal = internal.Refusal

/**
 * A binding that cannot be one. `reason` names the rule, never a value.
 *
 * @category errors
 * @since 0.0.14
 */
export class BindingInvalid extends Data.TaggedError("SecretBindingInvalid")<{
  readonly reason: string
}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `secret binding invalid: ${this.reason}`
  }
}

/**
 * `SECRETS_PLACEHOLDER_KEY` is set and shorter than 32 characters.
 *
 * @category errors
 * @since 0.0.14
 */
export class KeyTooShort extends Data.TaggedError("SecretKeyTooShort")<{}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `SECRETS_PLACEHOLDER_KEY holds fewer than ${internal.minimumKeyLength} characters`
  }
}

/**
 * {@link placeholder} was asked for a name the egress does not bind.
 *
 * @category errors
 * @since 0.0.14
 */
export class SecretNotBound extends Data.TaggedError("SecretNotBound")<{
  readonly name: string
}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `secret ${this.name} is not bound by this egress`
  }
}

/**
 * The egress refused the request before revealing or sending anything.
 *
 * @category errors
 * @since 0.0.14
 */
export class Refused extends Data.TaggedError("SecretEgressRefused")<{
  readonly code: Refusal
}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `secrets egress refused the request: ${this.code}`
  }
}

/**
 * The egress could not send the request, or got no answer: `secret` when
 * the vault could not reveal a value, `value` when a stored value cannot go
 * in a header, `audit` when the decision could not be recorded, `upstream`
 * when the host did not answer. It carries nothing of the request.
 *
 * @category errors
 * @since 0.0.14
 */
export class Unavailable extends Data.TaggedError("SecretEgressUnavailable")<{
  readonly code: "secret" | "value" | "audit" | "upstream"
}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `secrets egress unavailable: ${this.code}`
  }
}

/**
 * The answer's body broke off. It carries nothing of the answer.
 *
 * @category errors
 * @since 0.0.14
 */
export class Broken extends Data.TaggedError("SecretEgressBroken")<{}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return "secrets egress: the answer's body broke off"
  }
}

/**
 * The vault could not reveal secret `name`'s value.
 *
 * @category errors
 * @since 0.0.14
 */
export class SecretUnavailable extends Data.TaggedError("SecretUnavailable")<{
  readonly name: string
}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `secret ${this.name} is unavailable`
  }
}

/**
 * The audit could not record a decision.
 *
 * @category errors
 * @since 0.0.14
 */
export class AuditUnavailable extends Data.TaggedError("SecretAuditUnavailable")<{}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return "secrets audit unavailable"
  }
}

/**
 * Where values come from.
 *
 * @category services
 * @since 0.0.14
 */
export interface VaultService {
  readonly reveal: (name: string) => Effect.Effect<Redacted.Redacted<string>, SecretUnavailable>
}

/**
 * The service that reveals a value by name, for one request. The default
 * reads `Config.Redacted(name)`. The egress reads it when it is built.
 *
 * @category services
 * @since 0.0.14
 */
export class Vault extends Context.Reference<VaultService>("vibelang/experimental/Secrets/Vault", {
  defaultValue: () => ({
    reveal: (name) =>
      Effect.mapError(Config.Redacted(name), () => new SecretUnavailable({ name }))
  })
}) {}

/**
 * A layer whose {@link Vault} answers from `values`, for tests. A name it
 * does not hold fails with {@link SecretUnavailable}.
 *
 * @category services
 * @since 0.0.14
 */
export const fixtures = (values: Readonly<Record<string, string>>): Layer.Layer<never> => {
  const held = new Map(Object.entries(values).map(([name, value]) => [name, Redacted.make(value)]))
  return Layer.succeed(Vault)({
    reveal: (name) => {
      const value = held.get(name)
      return value === undefined ? Effect.fail(new SecretUnavailable({ name })) : Effect.succeed(value)
    }
  })
}

/**
 * One decision, as the audit records it: never a value, a path or a header.
 *
 * @category models
 * @since 0.0.14
 */
export interface Entry {
  readonly host: string
  readonly method: string
  readonly outcome: "forwarded" | Refusal
  /** The secrets the request used or, refused, carried, by name. */
  readonly secrets: ReadonlyArray<string>
}

/**
 * Where decisions are recorded.
 *
 * @category services
 * @since 0.0.14
 */
export interface AuditService {
  readonly record: (entry: Entry) => Effect.Effect<void, AuditUnavailable>
}

/**
 * The service that records each decision. The default logs it at `Info`
 * when forwarded and `Warn` when refused. The egress reads it when it is
 * built.
 *
 * @category services
 * @since 0.0.14
 */
export class Audit extends Context.Reference<AuditService>("vibelang/experimental/Secrets/Audit", {
  defaultValue: () => ({
    record: (entry) =>
      Effect.logWithLevel(entry.outcome === "forwarded" ? "Info" : "Warn")("secrets.egress").pipe(
        Effect.annotateLogs({
          host: entry.host,
          method: entry.method,
          outcome: entry.outcome,
          secrets: entry.secrets.join(",")
        })
      )
  })
}) {}

/**
 * Requests through an egress, by `outcome`: `forwarded`, a {@link Refusal},
 * `broken`, or `unavailable_` and the {@link Unavailable} code.
 *
 * @category observability
 * @since 0.0.14
 */
export const requests: Metric.Counter<number> = Metric.counter("secret_egress_requests", {
  description: "Requests through the secrets egress, by outcome",
  incremental: true
})

/**
 * The host's answer, scrubbed.
 *
 * @category models
 * @since 0.0.14
 */
export interface Answer {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Stream.Stream<Uint8Array, Broken>
}

/**
 * One egress in scope: its placeholders and how it sends.
 *
 * @category services
 * @since 0.0.14
 */
export interface EgressService {
  readonly [TypeId]: TypeId
  /** The scope the placeholders were derived in. */
  readonly scope: string
  /** The names this egress binds. */
  readonly names: ReadonlyArray<string>
  readonly placeholder: (name: string) => Effect.Effect<string, SecretNotBound>
  /** Sends `request` under this egress's policy with the client it was built over. */
  readonly execute: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Answer, Refused | Unavailable>
}

/**
 * The egress a {@link egress} layer provides.
 *
 * @category services
 * @since 0.0.14
 */
export class Egress extends Context.Service<Egress, EgressService>()("vibelang/experimental/Secrets/Egress") {}

/**
 * How an egress is built.
 *
 * @category models
 * @since 0.0.14
 */
export interface EgressOptions {
  /** Hosts a request may reach with no secret. Every other host outside the bindings is refused. */
  readonly allow?: ReadonlyArray<string> | undefined
  /**
   * The scope placeholders are derived in. Inside a durable run, pass the
   * run's id so a recorded step's placeholder still works when it resumes.
   * Absent, each build of the layer gets a fresh scope.
   */
  readonly scope?: string | undefined
}

let processKey: string | undefined

const placeholderKey = Effect.gen(function*() {
  const configured = yield* Effect.orElseSucceed(
    Config.option(Config.Redacted("SECRETS_PLACEHOLDER_KEY")),
    () => Option.none<Redacted.Redacted<string>>()
  )
  if (Option.isSome(configured)) {
    const key = Redacted.value(configured.value)
    if (key.length < internal.minimumKeyLength) return yield* new KeyTooShort()
    return key
  }
  processKey ??= internal.randomHex(32)
  return processKey
})

const bodiless: ReadonlySet<number> = new Set([204, 205, 304])

const makeExecute = (
  policy: internal.Policy,
  client: HttpClient.HttpClient,
  vault: VaultService,
  audit: AuditService
) =>
(request: HttpClientRequest.HttpClientRequest): Effect.Effect<Answer, Refused | Unavailable> =>
  Effect.gen(function*() {
    const method = request.method
    const href = Result.match(Url.make(request.url, request.urlParams, Option.getOrUndefined(request.hash)), {
      onFailure: () => "",
      onSuccess: (url) => url.href
    })
    const decision = internal.decide({ method, url: href, headers: request.headers }, policy)
    const count = (outcome: string) => Metric.update(Metric.withAttributes(requests, { outcome }), 1)
    const refuse = (code: Refusal, secrets: ReadonlyArray<string>) =>
      Effect.gen(function*() {
        // A refusal stands whether or not it is recorded: nothing is sent either way.
        yield* audit.record({ host: decision.host, method, outcome: code, secrets }).pipe(Effect.ignore)
        yield* count(code)
        return yield* new Refused({ code })
      })
    const unavailable = (code: Unavailable["code"]) =>
      count(`unavailable_${code}`).pipe(Effect.andThen(Effect.fail(new Unavailable({ code }))))

    if (decision._tag === "Denied") return yield* refuse(decision.code, decision.secrets)
    const { used } = decision
    // Every value in the policy is revealed: the used ones to substitute, all of them to scrub.
    const revealed = yield* Effect.forEach(policy.secrets, (secret) =>
      Effect.map(vault.reveal(secret.name), (value) => ({ secret, value: Redacted.value(value) }))).pipe(
        // Any other failure, a defect included, is the vault's and fails closed.
        Effect.catchCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.succeed(undefined))
      )
    if (revealed === undefined) return yield* unavailable("secret")
    const values = new Map<string, string>()
    for (const { secret, value } of revealed) {
      if (!used.includes(secret)) continue
      if (internal.valueProblem(value) !== undefined) return yield* unavailable("value")
      values.set(secret.placeholder, value)
    }
    const scrubber = internal.scrubber(
      revealed.filter(({ value }) => internal.valueProblem(value) === undefined).map(({ secret, value }) => ({
        value,
        replacement: secret.placeholder
      }))
    )

    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(internal.forwardable(request.headers))) {
      headers[name] = internal.substituted(name, value, values)
    }
    if (scrubber.active) {
      // An uncompressed, whole answer keeps every echo findable.
      headers["accept-encoding"] = "identity"
      delete headers["range"]
      delete headers["if-range"]
    }
    if (internal.headerBytes(headers) > internal.maximumHeaderBytes) {
      return yield* refuse("headers_too_large", used.map((secret) => secret.name))
    }

    const recorded = yield* audit.record({
      host: decision.host,
      method,
      outcome: "forwarded",
      secrets: used.map((secret) => secret.name)
    }).pipe(Effect.option)
    if (Option.isNone(recorded)) return yield* unavailable("audit")

    const init = yield* Effect.serviceOption(FetchHttpClient.RequestInit)
    const outgoing = HttpClientRequest.make(method as HttpMethod)(href, { headers, body: request.body })
    const sent = yield* client.execute(outgoing).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { ...Option.getOrUndefined(init), redirect: "manual" }),
      Effect.provideService(HttpClient.TracerDisabledWhen, constTrue),
      // The client's error holds the substituted request: dropped whole, so no value reaches a failure.
      Effect.catchCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.succeed(undefined))
    )
    if (sent === undefined) return yield* unavailable("upstream")

    const answered: Record<string, string> = {}
    for (const [name, value] of Object.entries(sent.headers)) {
      if (!internal.droppedAnswer.has(name)) answered[name] = scrubber.text(value)
    }
    const body = scrubber.stream(
      sent.stream.pipe(
        // The client's error holds the request: dropped. A bodiless answer reaches the step as an empty one.
        Stream.catch((error): Stream.Stream<never, Broken> =>
          error.reason._tag === "EmptyBodyError" ? Stream.empty : Stream.fail(new Broken())
        )
      )
    )
    yield* count("forwarded")
    return { status: sent.status, headers: answered, body }
  })

const asClientError = (request: HttpClientRequest.HttpClientRequest, error: Refused | Unavailable) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description: error.message, cause: error })
  })

/**
 * A layer that replaces `HttpClient` with one that substitutes, refuses and
 * scrubs, and provides the {@link Egress} that {@link placeholder} and
 * {@link forward} read. It is built over the `HttpClient`, {@link Vault} and
 * {@link Audit} around it.
 *
 * A refusal or an unavailable egress fails the request with a
 * `TransportError` whose `cause` is the {@link Refused} or
 * {@link Unavailable}. Read it back with {@link refusal}.
 *
 * @category egress
 * @since 0.0.14
 */
export const egress = (
  bindings: ReadonlyArray<Binding>,
  options?: EgressOptions
): Layer.Layer<HttpClient.HttpClient | Egress, BindingInvalid | KeyTooShort, HttpClient.HttpClient> =>
  Layer.effectContext(Effect.gen(function*() {
    const seen = new Set<string>()
    for (const binding of bindings) {
      const reason = internal.bindingProblem(binding)
      if (reason !== undefined) return yield* new BindingInvalid({ reason })
      if (seen.has(binding.name)) return yield* new BindingInvalid({ reason: `secret ${binding.name} is bound twice` })
      seen.add(binding.name)
    }
    const allow = [...(options?.allow ?? [])]
    for (const host of allow) {
      if (!internal.isHost(host)) {
        return yield* new BindingInvalid({ reason: "an allowed host is a lowercase DNS name of two or more labels" })
      }
    }
    const key = yield* placeholderKey
    const scope = options?.scope ?? internal.randomHex(16)
    const minter = yield* Effect.promise(() => internal.minter(key))
    const secrets = yield* Effect.forEach(bindings, (binding) =>
      Effect.map(Effect.promise(() => minter.derive(scope, binding.name)), (placeholder): internal.Secret => ({
        name: binding.name,
        hosts: [...binding.hosts],
        methods: binding.methods === undefined ? undefined : [...binding.methods],
        placeholder
      })))
    const policy: internal.Policy = { secrets, allow }
    const byName = new Map(secrets.map((secret) => [secret.name, secret.placeholder]))
    const underlying = yield* HttpClient.HttpClient
    // The vault and the audit run in the context the egress was built in, so
    // the default vault reads the configuration around the layer, not the step's.
    const built = yield* Effect.context<never>()
    const vaultService = yield* Vault
    const auditService = yield* Audit
    const vault: VaultService = { reveal: (name) => Effect.provideContext(vaultService.reveal(name), built) }
    const audit: AuditService = { record: (entry) => Effect.provideContext(auditService.record(entry), built) }
    const execute = makeExecute(policy, underlying, vault, audit)
    const service: EgressService = {
      [TypeId]: TypeId,
      scope,
      names: secrets.map((secret) => secret.name),
      placeholder: (name) => {
        const found = byName.get(name)
        return found === undefined ? Effect.fail(new SecretNotBound({ name })) : Effect.succeed(found)
      },
      execute
    }
    const client = HttpClient.make((request) =>
      Effect.flatMap(
        Effect.mapError(execute(request), (error) => asClientError(request, error)),
        (answer) =>
          Effect.sync(() => {
            const empty = request.method === "HEAD" || bodiless.has(answer.status)
            const web = new Response(empty ? null : Stream.toReadableStream(answer.body), {
              status: answer.status,
              headers: answer.headers
            })
            return HttpClientResponse.fromWeb(request, web)
          })
      )
    )
    return Context.make(HttpClient.HttpClient, client).pipe(Context.add(Egress, service))
  }))

/**
 * The placeholder for `name` in the egress in scope. Fails with
 * {@link SecretNotBound} for a name the egress does not bind.
 *
 * @category egress
 * @since 0.0.14
 */
export const placeholder = (name: string): Effect.Effect<string, SecretNotBound, Egress> =>
  Effect.flatMap(Effect.service(Egress), (service) => service.placeholder(name))

/**
 * The {@link Refused} or {@link Unavailable} a request through an egress
 * failed with, read back from the client's error.
 *
 * @category egress
 * @since 0.0.14
 */
export const refusal = (error: unknown): Option.Option<Refused | Unavailable> => {
  const cause = HttpClientError.isHttpClientError(error) ? (error.reason as { readonly cause?: unknown }).cause : error
  return cause instanceof Refused || cause instanceof Unavailable ? Option.some(cause) : Option.none()
}

/**
 * Answers a sandbox's intercepted request through the egress in scope: the
 * host's answer, scrubbed, or the refusal's code as text with its status
 * (see {@link refusals}), 503 when a secret or the audit was unavailable,
 * and 502 when the host did not answer. The request's URL must be absolute,
 * as an intercepted request's is.
 *
 * @category egress
 * @since 0.0.14
 */
export const forward = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Egress> =>
  Effect.flatMap(Effect.service(Egress), (service) => {
    const method = request.method
    const body = method === "GET" || method === "HEAD"
      ? HttpBody.empty
      : HttpBody.stream(request.stream, request.headers["content-type"])
    const outgoing = HttpClientRequest.make(method as HttpMethod)(request.originalUrl, { headers: request.headers, body })
    return service.execute(outgoing).pipe(
      Effect.map((answer) =>
        method === "HEAD" || bodiless.has(answer.status)
          ? HttpServerResponse.empty({ status: answer.status, headers: answer.headers })
          : HttpServerResponse.stream(answer.body, { status: answer.status, headers: answer.headers })
      ),
      Effect.catchTags({
        SecretEgressRefused: (refused) =>
          Effect.succeed(HttpServerResponse.text(refused.code, { status: internal.refusals[refused.code] })),
        SecretEgressUnavailable: (failed) =>
          Effect.succeed(HttpServerResponse.text(failed.code, { status: failed.code === "upstream" ? 502 : 503 }))
      })
    )
  })

/**
 * Replaces every form of every value in `values` with its replacement: the
 * scrubber the egress runs on every answer, for text a step got some other
 * way.
 *
 * @category scrubbing
 * @since 0.0.14
 */
export const scrub = (
  text: string,
  values: ReadonlyArray<{ readonly value: Redacted.Redacted<string>; readonly replacement: string }>
): string =>
  internal.scrubber(values.map((target) => ({ value: Redacted.value(target.value), replacement: target.replacement })))
    .text(text)
