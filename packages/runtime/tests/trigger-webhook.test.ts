import { expect, test } from "bun:test"
import fc from "fast-check"
import { createHmac } from "node:crypto"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/http"
import { WorkflowEngine } from "effect/workflow"
import { $workflow } from "vibelang-runtime"
import { Durable, Trigger } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

interface World {
  readonly runs: Array<string>
  readonly verified: Array<string>
}
const Outside = Context.Service<World>("test/TriggerWebhook/Outside")

const Deploy = Durable.workflow("test#Deploy", { payload: { service: Schema.String, version: Schema.Number } })

const deployLayer = Deploy.toLayer(({ service, version }) =>
  Effect.gen(function*() {
    const instance = yield* WorkflowEngine.WorkflowInstance
    ;(yield* Outside).runs.push(`${instance.executionId}:${service}@${version}`)
  })
)

const secret = "s3cret"
const sign = (body: string) => createHmac("sha256", secret).update(body).digest("hex")

const door = (world: World, runner: Layer.Layer<Trigger.RunnerService, never, any> = Trigger.layerRunnerDurable) =>
  Trigger.webhook(Deploy, {
    path: "/hooks/deploy",
    verify: (request) =>
      Effect.suspend(() => {
        // The raw bytes, exactly as sent: nothing has parsed them yet.
        world.verified.push(new TextDecoder().decode(request.body))
        return request.headers["x-signature"] === sign(new TextDecoder().decode(request.body)) ? Effect.void : Effect.fail("bad signature")
      }),
    input: (body) => {
      const event = body as { readonly service: string; readonly version: number }
      return { service: event.service, version: event.version }
    }
  }).pipe(
    Layer.provideMerge(Layer.merge(deployLayer, runner)),
    Layer.provideMerge(Durable.memory),
    Layer.provide(Layer.succeed(Outside, world))
  )

const serve = (world: World, runner?: Layer.Layer<Trigger.RunnerService, never, any>) => HttpRouter.toWebHandler(door(world, runner), { disableLogger: true })

const post = (handler: (request: Request) => Promise<Response>, body: string, headers: Record<string, string> = {}) =>
  handler(new Request("http://localhost/hooks/deploy", { method: "POST", body, headers: { "x-signature": sign(body), ...headers } }))

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

test("a verified request starts the workflow with the mapped payload and answers 202 with the run", async () => {
  const world: World = { runs: [], verified: [] }
  const { handler, dispose } = serve(world)
  const body = JSON.stringify({ service: "api", version: 7, extra: true })
  const response = await post(handler, body)
  expect(response.status).toBe(202)
  const { run } = await response.json() as { run: string }
  await settle()
  expect(world.runs).toEqual([`${run}:api@7`])
  expect(world.verified).toEqual([body])
  await dispose()
})

test("verify runs on the raw bytes first; a refused request starts nothing and its body is never parsed", async () => {
  const world: World = { runs: [], verified: [] }
  const { handler, dispose } = serve(world)
  // Not JSON: a parser running before verify would answer 400, not 401.
  const refused = await post(handler, "{not json", { "x-signature": "forged" })
  expect(refused.status).toBe(401)
  expect(world.verified).toEqual(["{not json"])
  const unparsable = await post(handler, "{not json")
  expect(unparsable.status).toBe(400)
  const wrongShape = await post(handler, JSON.stringify({ service: "api", version: "seven" }))
  expect(wrongShape.status).toBe(400)
  await settle()
  expect(world.runs).toEqual([])
  await dispose()
})

test("a sender's retry joins the run it started; another event starts another run", async () => {
  const world: World = { runs: [], verified: [] }
  const { handler, dispose } = serve(world)
  const body = JSON.stringify({ service: "api", version: 7 })
  const first = await (await post(handler, body)).json() as { run: string }
  const retry = await (await post(handler, body)).json() as { run: string }
  const keyed = await (await post(handler, body, { "idempotency-key": "delivery-2" })).json() as { run: string }
  await settle()
  expect(retry.run).toBe(first.run)
  expect(keyed.run).not.toBe(first.run)
  expect(world.runs.length).toBe(2)
  await dispose()
})

test("a runner that fails answers 503", async () => {
  const world: World = { runs: [], verified: [] }
  const broken = Layer.succeed(Trigger.Runner, {
    start: () => Effect.fail(new Trigger.TriggerError({ code: "runner", message: "engine down" })),
    inspect: () => Effect.succeed("missing" as const),
    cancel: () => Effect.void,
    send: () => Effect.void
  })
  const { handler, dispose } = serve(world, broken)
  const response = await post(handler, JSON.stringify({ service: "api", version: 1 }))
  expect(response.status).toBe(503)
  await dispose()
})

interface Delivery {
  readonly body: string
  readonly forged: string | undefined
}

// Only a request whose signature verifies may start a run, whatever its body.
const verifyFirst = async ({ body, forged }: Delivery) => {
  const world: World = { runs: [], verified: [] }
  const { handler, dispose } = serve(world)
  const signature = forged ?? sign(body)
  const response = await post(handler, body, { "x-signature": signature })
  await settle()
  expect(world.verified).toEqual([body])
  if (signature !== sign(body)) {
    expect(response.status).toBe(401)
    expect(world.runs).toEqual([])
  } else {
    expect([202, 400]).toContain(response.status)
    expect(world.runs.length).toBe(response.status === 202 ? 1 : 0)
  }
  await dispose()
}

test("property: a request whose signature does not verify never starts a run", async () => {
  await checkProperty(fc, {
    name: "trigger-webhook-verify-first",
    rule: "VIP-61: a trigger grants nothing; verify receives the raw request bytes before anything is parsed",
    command: "bun test tests/trigger-webhook.test.ts",
    arbitrary: fc.record({
      body: fc.oneof(fc.string(), fc.json(), fc.record({ service: fc.string(), version: fc.integer() }).map((event) => JSON.stringify(event))),
      forged: fc.option(fc.oneof(fc.string(), fc.string({ unit: fc.constantFrom(..."0123456789abcdef"), minLength: 64, maxLength: 64 })), { nil: undefined })
    }),
    numRuns: 60,
    check: verifyFirst
  })
}, 60000)

// A declared `workflow` (VIP-55): `input` maps the body to its arguments.
const declaredRuns: Array<string> = []
const Release = $workflow(
  "test#Release",
  {},
  { payload: { service: Schema.String, version: Schema.Number } },
  (service: string, version: number) => Effect.sync(() => void declaredRuns.push(`${service}@${version}`))
)

test("a declared workflow starts with the arguments input maps; a wrong argument count answers 400", async () => {
  const { handler, dispose } = HttpRouter.toWebHandler(
    Trigger.webhook(Release, {
      path: "/hooks/deploy",
      verify: () => Effect.void,
      input: (body) => {
        const event = body as { readonly service: string; readonly version: number }
        return [event.service, event.version]
      }
    }).pipe(
      Layer.provideMerge(Layer.merge(Release.layer, Trigger.layerRunnerDurable)),
      Layer.provideMerge(Durable.memory)
    ),
    { disableLogger: true }
  )
  const response = await post(handler, JSON.stringify({ service: "api", version: 8 }))
  expect(response.status).toBe(202)
  await settle()
  expect(declaredRuns).toEqual(["api@8"])
  const { handler: short, dispose: disposeShort } = HttpRouter.toWebHandler(
    Trigger.webhook(Release, { path: "/hooks/deploy", verify: () => Effect.void, input: () => ["api"] as any }).pipe(
      Layer.provideMerge(Layer.merge(Release.layer, Trigger.layerRunnerDurable)),
      Layer.provideMerge(Durable.memory)
    ),
    { disableLogger: true }
  )
  expect((await post(short, "{}")).status).toBe(400)
  await settle()
  expect(declaredRuns).toEqual(["api@8"])
  await dispose()
  await disposeShort()
})

// The signal half: a verified request delivers a value to a run that waits
// on a signal (VIP-56), through the same Runner port.
const approved = Durable.signal("approved", Schema.Struct({ by: Schema.String }))
const Approve = Durable.workflow("test#Approve", { payload: { change: Schema.String } })
const approveLayer = Approve.toLayer(({ change }) =>
  Effect.gen(function*() {
    const { by } = yield* approved.wait()
    ;(yield* Outside).runs.push(`${change} approved by ${by}`)
  })
)

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// Two doors over one engine: one starts Approve, the other delivers `approved`.
const approvals = (world: World, runner: Layer.Layer<Trigger.RunnerService, never, any> = Trigger.layerRunnerDurable) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      Trigger.webhook(Approve, { path: "/hooks/start", verify: () => Effect.void, input: (body) => ({ change: (body as { change: string }).change }) }),
      Trigger.webhook(Approve, {
        path: "/hooks/approve",
        verify: (request) =>
          Effect.suspend(() => {
            world.verified.push(decode(request.body))
            return request.headers["x-signature"] === sign(decode(request.body)) ? Effect.void : Effect.fail("bad signature")
          }),
        signal: approved,
        deliver: (body) => {
          const event = body as { readonly run: string; readonly by: string }
          return { run: event.run, value: { by: event.by } }
        }
      })
    ).pipe(
      Layer.provideMerge(Layer.merge(approveLayer, runner)),
      Layer.provideMerge(Durable.memory),
      Layer.provide(Layer.succeed(Outside, world))
    ),
    { disableLogger: true }
  )

const at = (path: string, handler: (request: Request) => Promise<Response>, body: string, headers: Record<string, string> = {}) =>
  handler(new Request(`http://localhost${path}`, { method: "POST", body, headers: { "x-signature": sign(body), ...headers } }))

const startApproval = async (handler: (request: Request) => Promise<Response>, change: string) => {
  const { run } = await (await at("/hooks/start", handler, JSON.stringify({ change }))).json() as { run: string }
  await settle()
  return run
}

test("a verified request delivers the signal to the waiting run and answers 202 with the run", async () => {
  const world: World = { runs: [], verified: [] }
  const { handler, dispose } = approvals(world)
  const run = await startApproval(handler, "pr-7")
  expect(world.runs).toEqual([])
  const body = JSON.stringify({ run, by: "ana" })
  const response = await at("/hooks/approve", handler, body)
  expect(response.status).toBe(202)
  expect(await response.json()).toEqual({ run })
  await settle()
  expect(world.runs).toEqual(["pr-7 approved by ana"])
  expect(world.verified).toEqual([body])
  await dispose()
})

test("a signal delivery answers 401 when forged, 404 for an unknown run, 400 for a value the signal refuses, and 409 once the run has finished", async () => {
  const world: World = { runs: [], verified: [] }
  const { handler, dispose } = approvals(world)
  const run = await startApproval(handler, "pr-8")
  expect((await at("/hooks/approve", handler, "{not json", { "x-signature": "forged" })).status).toBe(401)
  expect((await at("/hooks/approve", handler, JSON.stringify({ run: "no-such-run", by: "ana" }))).status).toBe(404)
  expect((await at("/hooks/approve", handler, JSON.stringify({ run, by: 5 }))).status).toBe(400)
  expect((await at("/hooks/approve", handler, "{not json")).status).toBe(400)
  await settle()
  expect(world.runs).toEqual([])
  expect((await at("/hooks/approve", handler, JSON.stringify({ run, by: "bo" }))).status).toBe(202)
  await settle()
  expect((await at("/hooks/approve", handler, JSON.stringify({ run, by: "cy" }))).status).toBe(409)
  await settle()
  expect(world.runs).toEqual(["pr-8 approved by bo"])
  await dispose()
})

test("a runner that cannot deliver answers 503", async () => {
  const world: World = { runs: [], verified: [] }
  const broken = Layer.effect(
    Trigger.Runner,
    Effect.map(Effect.service(Trigger.Runner), (real) => ({
      ...real,
      send: () => Effect.fail(new Trigger.TriggerError({ code: "runner", message: "engine down" }))
    }))
  ).pipe(Layer.provide(Trigger.layerRunnerDurable))
  const { handler, dispose } = approvals(world, broken)
  const run = await startApproval(handler, "pr-9")
  expect((await at("/hooks/approve", handler, JSON.stringify({ run, by: "ana" }))).status).toBe(503)
  await settle()
  expect(world.runs).toEqual([])
  await dispose()
})

interface Approval {
  readonly by: string
  readonly forged: string | undefined
}

// Only a verified request delivers, whatever its value; the run takes the first delivery.
const deliverVerified = async ({ by, forged }: Approval) => {
  const world: World = { runs: [], verified: [] }
  const { handler, dispose } = approvals(world)
  const run = await startApproval(handler, "pr")
  const body = JSON.stringify({ run, by })
  const signature = forged ?? sign(body)
  const response = await at("/hooks/approve", handler, body, { "x-signature": signature })
  await settle()
  if (signature !== sign(body)) {
    expect(response.status).toBe(401)
    expect(world.runs).toEqual([])
  } else {
    expect(response.status).toBe(202)
    expect(world.runs).toEqual([`pr approved by ${by}`])
  }
  await dispose()
}

test("property: a signal webhook delivers only a verified request's value, to the run it names", async () => {
  await checkProperty(fc, {
    name: "trigger-webhook-signal-verified",
    rule: "VIP-61: Trigger.webhook is a verified HTTP door that starts W or sends a signal; verify receives the raw request bytes before anything is parsed",
    command: "bun test tests/trigger-webhook.test.ts",
    arbitrary: fc.record({
      by: fc.string(),
      forged: fc.option(fc.string({ unit: fc.constantFrom(..."0123456789abcdef"), minLength: 64, maxLength: 64 }), { nil: undefined })
    }),
    numRuns: 30,
    check: deliverVerified
  })
}, 60000)
