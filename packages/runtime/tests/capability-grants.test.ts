import { expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Context, Effect, Exit, Fiber, Layer } from "effect"
import { Capability, Durable } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { anyCapability, anyPattern, modelEvaluate, modelMatches } from "./fixtures/capability-model.ts"

const command = "bun test tests/capability-grants.test.ts"

const readme = Capability.make("fs:read", "/workspace/README.md")
const out = Capability.make("fs:write", "/workspace/out.txt")
const site = Capability.make("net:get", "https://example.com/")

const denied = (capability: Capability.Capability, reason: string) => new Capability.PermissionDenied({ capability, reason })

// Waits until the store holds `count` waiting operations.
const waiting = (count: number): Effect.Effect<ReadonlyArray<Capability.Request>> =>
  Effect.gen(function*() {
    for (let turn = 0; turn < 1000; turn += 1) {
      const requests = yield* Capability.pending
      if (requests.length === count) return requests
      yield* Effect.yieldNow
    }
    return yield* Effect.die(new Error(`the store never held ${count} waiting operations`))
  })

test("with no store installed nothing is guarded, and a ceiling still narrows", async () => {
  const result = await Effect.runPromise(Effect.gen(function*() {
    yield* Capability.check(out)
    yield* Capability.check("proc:spawn:rm -rf /")
    const outside = yield* Effect.flip(Capability.attenuate(["fs:read:/workspace/**"])(Capability.check(out)))
    yield* Capability.attenuate(["fs:read:/workspace/**"])(Capability.check(readme))
    return { outside, pending: yield* Capability.pending, reply: yield* Capability.reply("permission-1", "once") }
  }))
  expect(result).toEqual({ outside: denied(out, "outside capability ceiling"), pending: [], reply: false })
})

test("an unattended store allows, denies, and reports what it would have asked", async () => {
  const store = Capability.grantStore({
    allow: ["fs:read:/workspace/**"],
    deny: ["fs:read:/workspace/.env"],
    workspace: "/workspace",
    attended: false
  })
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      yield* Capability.check(readme)
      return {
        secret: yield* Effect.flip(Capability.check("fs:read:/workspace/.env")),
        write: yield* Effect.flip(Capability.check(out)),
        post: yield* Effect.flip(Capability.check("net:post:https://example.com/")),
        pending: yield* Capability.pending
      }
    }),
    store
  ))
  expect(result.secret).toEqual(denied(Capability.make("fs:read", "/workspace/.env"), "denied by permission policy"))
  expect(result.write).toEqual(new Capability.PermissionRequired({ requestId: "permission-1", capability: out, tier: "compensable" }))
  expect(result.post).toEqual(
    new Capability.PermissionRequired({
      requestId: "permission-2",
      capability: Capability.make("net:post", "https://example.com/"),
      tier: "irreversible"
    })
  )
  expect(result.pending).toEqual([])
})

test("a ceiling only narrows: groups intersect, an empty one forbids everything, and none grants", async () => {
  const store = Capability.grantStore({ allow: ["fs:*:/workspace/**"], attended: false })
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const docs = Capability.attenuate(["fs:read:/workspace/docs/**", "fs:read:/workspace/README.md"])
      const reads = Capability.attenuate(["fs:read:**"])
      const guide = Capability.make("fs:read", "/workspace/docs/guide.md")
      yield* docs(Capability.check(guide))
      yield* docs(Capability.check(readme))
      yield* docs(reads(Capability.check(guide)))
      // A fiber forked inside a ceiling keeps it.
      yield* docs(Effect.flatMap(Effect.forkChild(Capability.check(guide)), Fiber.join))
      return {
        groups: yield* docs(reads(docs(Capability.ceiling))),
        none: yield* Capability.ceiling,
        // Inside the outer ceiling and outside the inner one, in either order.
        innerNarrower: yield* Effect.flip(reads(Capability.attenuate(["fs:read:/workspace/docs/**"])(Capability.check(readme)))),
        outerNarrower: yield* Effect.flip(Capability.attenuate(["fs:read:/workspace/docs/**"])(reads(Capability.check(readme)))),
        // A wider inner group does not widen the ceiling.
        widened: yield* Effect.flip(docs(Capability.attenuate(["*"])(Capability.check(out)))),
        forked: yield* Effect.flip(docs(Effect.flatMap(Effect.forkChild(Capability.check(out)), Fiber.join))),
        empty: yield* Effect.flip(Capability.attenuate([])(Capability.check(readme))),
        unreadable: yield* Effect.flip(Capability.attenuate(["*", "nonsense" as Capability.PatternText])(Capability.check(readme))),
        // Inside the ceiling, and the policy still decides.
        ungranted: yield* Effect.flip(Capability.attenuate(["*"])(Capability.check(site)))
      }
    }),
    store
  ))
  expect(result.groups).toEqual([
    [{ action: "fs:read", resource: "**" }],
    [{ action: "fs:read", resource: "/workspace/README.md" }, { action: "fs:read", resource: "/workspace/docs/**" }]
  ])
  expect(result.none).toEqual([])
  expect(result.innerNarrower).toEqual(denied(readme, "outside capability ceiling"))
  expect(result.outerNarrower).toEqual(denied(readme, "outside capability ceiling"))
  expect(result.widened).toEqual(denied(out, "outside capability ceiling"))
  expect(result.forked).toEqual(denied(out, "outside capability ceiling"))
  expect(result.empty).toEqual(denied(readme, "outside capability ceiling"))
  expect(result.unreadable).toEqual(denied(readme, "outside capability ceiling"))
  expect(result.ungranted).toEqual(new Capability.PermissionRequired({ requestId: "permission-1", capability: site, tier: "sealed" }))
})

test("an attended store parks an operation until a person answers it", async () => {
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      // "once" lets this operation run, and the next one asks again.
      const first = yield* Effect.forkChild(Capability.check(site))
      const [request] = yield* waiting(1)
      const answered = yield* Capability.reply(request!.requestId, "once")
      yield* Fiber.join(first)
      const second = yield* Effect.forkChild(Capability.check(site))
      const [again] = yield* waiting(1)
      // "deny" fails it.
      const refusedReply = yield* Capability.reply(again!.requestId, "deny")
      const refused = yield* Effect.flip(Fiber.join(second))
      return {
        request,
        answered,
        again,
        refusedReply,
        refused,
        // An answered request is gone, and an unknown answer grants nothing.
        stale: yield* Capability.reply(request!.requestId, "once"),
        unknown: yield* Capability.reply("permission-99", "once"),
        left: yield* Capability.pending
      }
    }),
    Capability.grantStore({ allow: [], workspace: "/workspace" })
  ))
  expect(result.request).toEqual({ requestId: "permission-1", capability: site, tier: "sealed" })
  expect(result.again).toEqual({ requestId: "permission-2", capability: site, tier: "sealed" })
  expect(result.answered).toBe(true)
  expect(result.refusedReply).toBe(true)
  expect(result.refused).toEqual(denied(site, "permission request denied"))
  expect(result.stale).toBe(false)
  expect(result.unknown).toBe(false)
  expect(result.left).toEqual([])
})

test("a run answer covers the same operation for the store's life, and nothing else", async () => {
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const first = yield* Effect.forkChild(Capability.check(out))
      const same = yield* Effect.forkChild(Capability.check("fs:write:/workspace/out.txt"))
      const other = yield* Effect.forkChild(Capability.check("fs:write:/workspace/other.txt"))
      const secret = yield* Effect.flip(Capability.check("fs:write:/workspace/.env"))
      const requests = yield* waiting(3)
      const bogus = yield* Capability.reply(requests[0]!.requestId, "always" as Capability.Answer)
      yield* Capability.reply(requests[0]!.requestId, "run")
      yield* Fiber.join(first)
      yield* Fiber.join(same)
      const left = yield* waiting(1)
      // The same operation no longer asks. A different resource still does.
      yield* Capability.check(out)
      yield* Capability.reply(left[0]!.requestId, "once")
      yield* Fiber.join(other)
      // A ceiling still bounds an operation a person allowed.
      const narrowed = yield* Effect.flip(Capability.attenuate(["fs:read:**"])(Capability.check(out)))
      return { requests: requests.map((request) => request.capability.resource), bogus, left, secret, narrowed }
    }),
    Capability.grantStore({ allow: [], deny: ["fs:*:/workspace/.env"], workspace: "/workspace" })
  ))
  expect(result.requests).toEqual(["/workspace/out.txt", "/workspace/out.txt", "/workspace/other.txt"])
  expect(result.bogus).toBe(false)
  expect(result.left).toEqual([{ requestId: "permission-3", capability: Capability.make("fs:write", "/workspace/other.txt"), tier: "compensable" }])
  // A deny is decided before anyone is asked, so no answer can allow it.
  expect(result.secret).toEqual(denied(Capability.make("fs:write", "/workspace/.env"), "denied by permission policy"))
  expect(result.narrowed).toEqual(denied(out, "outside capability ceiling"))
})

test("an interrupted operation stops waiting, and closing the store refuses the rest", async () => {
  const result = await Effect.runPromise(Effect.gen(function*() {
    const scoped = yield* Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(Capability.grantStore({ allow: [] }))
      const store = Context.get(context, Capability.GrantStore)
      const interrupted = yield* Effect.forkChild(store.check(site))
      const kept = yield* Effect.forkChild(store.check(out))
      while ((yield* store.pending).length < 2) yield* Effect.yieldNow
      yield* Fiber.interrupt(interrupted)
      return { kept, store, afterInterrupt: yield* store.pending, late: yield* store.reply("permission-1", "once") }
    }))
    return {
      afterInterrupt: scoped.afterInterrupt,
      late: scoped.late,
      closed: yield* Effect.flip(Fiber.join(scoped.kept)),
      afterClose: yield* Effect.flip(scoped.store.check(site))
    }
  }))
  expect(result.afterInterrupt).toEqual([{ requestId: "permission-2", capability: out, tier: "irreversible" }])
  expect(result.late).toBe(false)
  expect(result.closed).toEqual(denied(out, "grant store closed"))
  expect(result.afterClose).toEqual(denied(site, "grant store closed"))
})

test("a faulty store fails closed: the operation behind the check never runs", async () => {
  const written: Array<string> = []
  const write = (file: string) =>
    Effect.andThen(Capability.check(Capability.make("fs:write", file)), Effect.sync(() => void written.push(file)))

  // A store whose backing service is down: every check dies.
  const offline = Layer.succeed(Capability.GrantStore, {
    check: () => Effect.die(new Error("grant store offline")),
    pending: Effect.succeed([]),
    reply: () => Effect.succeed(false)
  })
  const died = await Effect.runPromiseExit(Effect.provide(write("/workspace/a"), offline))
  expect(Exit.isFailure(died) && Cause.hasDies(died.cause)).toBe(true)

  // A store that refuses everything, in place of the real one.
  const refusing = Layer.succeed(Capability.GrantStore, {
    check: (capability) =>
      Effect.fail(denied(typeof capability === "string" ? Capability.make("fs:write", capability) : capability, "refused by the host")),
    pending: Effect.succeed([]),
    reply: () => Effect.succeed(false)
  })
  const refused = await Effect.runPromise(Effect.flip(Effect.provide(write("/workspace/b"), refusing)))
  expect(refused).toEqual(denied(Capability.make("fs:write", "/workspace/b"), "refused by the host"))

  // The real store, too full to hold another waiting operation.
  const full = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const fibers = yield* Effect.forEach(Array.from({ length: 1024 }, (_, index) => `/workspace/${index}`), (file) => Effect.forkChild(write(file)))
      yield* waiting(1024)
      const overflow = yield* Effect.flip(write("/workspace/overflow"))
      yield* Effect.forEach(fibers, Fiber.interrupt, { discard: true })
      return overflow
    }),
    Capability.grantStore({ allow: [] })
  ))
  expect(full).toEqual(denied(Capability.make("fs:write", "/workspace/overflow"), "too many pending permission requests"))

  expect(written).toEqual([])
})

test("what a store cannot read, it refuses", async () => {
  const unchecked = <A>(value: unknown) => value as A
  const built = await Effect.runPromiseExit(
    Effect.provide(Capability.check(readme), Capability.grantStore({ allow: ["*", unchecked("fs:raed:/workspace/**")] }))
  )
  expect(Exit.isFailure(built) && Cause.hasDies(built.cause)).toBe(true)
  expect(Exit.isFailure(built) ? String(Cause.squash(built.cause)) : "").toContain("not a capability pattern: fs:raed:/workspace/**")

  const all = Capability.grantStore({ allow: ["*"] })
  const noAction = await Effect.runPromiseExit(Effect.provide(Capability.check(unchecked("fs:delete:/workspace/a")), all))
  expect(Exit.isFailure(noAction) && Cause.hasDies(noAction.cause)).toBe(true)

  const long = await Effect.runPromise(
    Effect.flip(Effect.provide(Capability.check(Capability.make("fs:read", "a".repeat(5000))), all))
  )
  expect(long._tag).toBe("PermissionDenied")
  expect(long.capability.resource.length).toBe(4096)

  const dots = await Effect.runPromise(Effect.flip(Effect.provide(Capability.check("fs:read:/workspace/../etc/passwd"), all)))
  expect(dots).toEqual(denied(Capability.make("fs:read", "/workspace/../etc/passwd"), "denied by permission policy"))
})

test("a check passes exactly when the policy allows it and every ceiling holds it", async () => {
  await checkProperty(fc, {
    name: "capability-ceiling-narrows",
    rule: "VIP-58 rule 6: attenuate intersects the ceiling with one more group; a grant cannot reach past a ceiling, and a ceiling grants nothing",
    command,
    arbitrary: fc.record({
      allow: fc.array(anyPattern, { maxLength: 4 }),
      deny: fc.array(anyPattern, { maxLength: 2 }),
      groups: fc.array(fc.array(anyPattern, { maxLength: 3 }), { maxLength: 3 }),
      extra: fc.array(anyPattern, { maxLength: 3 }),
      capability: anyCapability
    }),
    numRuns: 1500,
    check: async ({ allow, deny, groups, extra, capability }: {
      allow: Array<Capability.Pattern>
      deny: Array<Capability.Pattern>
      groups: Array<Array<Capability.Pattern>>
      extra: Array<Capability.Pattern>
      capability: Capability.Capability
    }) => {
      const under = (ceilings: ReadonlyArray<ReadonlyArray<Capability.Pattern>>, policy: Capability.Policy) =>
        Effect.runPromise(Effect.provide(
          Effect.exit(ceilings.reduce<Effect.Effect<void, Capability.PermissionDenied | Capability.PermissionRequired>>(
            (effect, group) => Capability.attenuate(group)(effect),
            Capability.check(capability)
          )),
          Capability.grantStore({ ...policy, attended: false })
        ))
      const inside = (ceilings: ReadonlyArray<ReadonlyArray<Capability.Pattern>>) =>
        ceilings.every((group) => group.some((pattern) => modelMatches(pattern, capability)))

      const exit = await under(groups, { allow, deny })
      expect(Exit.isSuccess(exit)).toBe(inside(groups) && modelEvaluate({ allow, deny }, capability, []) === "allow")
      // Outside a ceiling the refusal is the ceiling's, whatever the policy says.
      if (!inside(groups)) {
        expect(exit).toEqual(Exit.fail(denied(capability, "outside capability ceiling")))
      }
      // One more group never turns a refusal into a success.
      const narrower = await under([...groups, extra], { allow, deny })
      if (Exit.isSuccess(narrower)) expect(Exit.isSuccess(exit)).toBe(true)
      // The order ceilings were applied in does not matter.
      expect(Exit.isSuccess(await under([...groups].reverse(), { allow, deny }))).toBe(Exit.isSuccess(exit))
      // A ceiling grants nothing: with nothing allowed, no ceiling lets it through.
      expect(Exit.isSuccess(await under(groups, { allow: [] }))).toBe(false)
    }
  })
}, 60000)

test("a store built inside another never widens it, and one id names one request", async () => {
  const outer = Capability.grantStore({ allow: ["fs:read:/workspace/**"], deny: ["fs:read:/workspace/.env"] })
  const inner = Capability.grantStore({ allow: ["*"], attended: false })
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const within = <A, E>(effect: Effect.Effect<A, E>) => Effect.provide(effect, inner)
      // The inner store allows everything. The outer one still decides.
      yield* within(Capability.check(readme))
      const vetoed = yield* within(Effect.flip(Capability.check("fs:read:/workspace/.env")))
      // What the outer store asks about parks there, and is answered from inside.
      const asking = yield* Effect.forkChild(within(Capability.check(out)))
      const seen = yield* waiting(1)
      const inside = yield* within(Capability.pending)
      const answered = yield* within(Capability.reply(seen[0]!.requestId, "once"))
      yield* Fiber.join(asking)
      // The inner store's own refusal, with an id the outer store did not use.
      const narrow = Capability.grantStore({ allow: [], attended: false })
      const own = yield* Effect.provide(Effect.flip(Capability.check(readme)), narrow)
      return { vetoed, seen, inside, answered, own }
    }),
    outer
  ))
  expect(result.vetoed).toEqual(denied(Capability.make("fs:read", "/workspace/.env"), "denied by permission policy"))
  expect(result.seen).toEqual([{ requestId: "permission-1", capability: out, tier: "irreversible" }])
  expect(result.inside).toEqual(result.seen)
  expect(result.answered).toBe(true)
  expect(result.own).toEqual(new Capability.PermissionRequired({ requestId: "permission-2", capability: readme, tier: "sealed" }))
})

// A journal over a real durable store: one run's append-only journal.
const journalOver = (store: Durable.Store, run: string): Capability.Journal => ({
  remembered: Effect.map(
    store.entries(run),
    (entries) => entries.filter((entry) => entry.eventType === "GrantRemembered").map((entry) => entry.payload)
  ),
  remember: (grant) => Effect.orDie(store.append(run, [{ eventType: "GrantRemembered", payload: grant }], Date.now()))
})

test("a journaled store writes a remembered grant before it takes effect, and a later store starts with it", async () => {
  const store = Durable.makeMemoryStore()
  const run = "run-1"
  await Effect.runPromise(store.open({ run, workflow: "test#Agent", payload: {}, parent: undefined, at: 0 }))
  const journal = Layer.succeed(Capability.GrantJournal, journalOver(store, run))
  const policy = { allow: [], deny: ["fs:write:/workspace/.env" as const], workspace: "/workspace" }
  const remembered = Effect.map(store.entries(run), (entries) => entries.filter((entry) => entry.eventType === "GrantRemembered"))

  const first = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const asking = yield* Effect.forkChild(Capability.check(out))
      const [request] = yield* waiting(1)
      const before = yield* remembered
      yield* Capability.reply(request!.requestId, "remembered")
      yield* Fiber.join(asking)
      // "run" and "once" are answers for this store's life only.
      const other = yield* Effect.forkChild(Capability.check(site))
      const [second] = yield* waiting(1)
      yield* Capability.reply(second!.requestId, "run")
      yield* Fiber.join(other)
      return { before, after: yield* remembered }
    }),
    Layer.provide(Capability.journaled(policy), journal)
  ))
  expect(first.before).toEqual([])
  expect(first.after.map((entry) => entry.payload)).toEqual([{ requestId: "permission-1", capability: out, tier: "compensable" }])

  // The process is gone. A new store over the same journal does not ask
  // again for what was remembered, asks again for what was not, and still
  // obeys its policy and the fiber's ceiling.
  const second = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      yield* Capability.check(out)
      return {
        notRemembered: yield* Effect.flip(Capability.check(site)),
        narrowed: yield* Effect.flip(Capability.attenuate(["fs:read:**"])(Capability.check(out)))
      }
    }),
    Layer.provide(Capability.journaled({ ...policy, attended: false }), journal)
  ))
  expect(second.notRemembered._tag).toBe("PermissionRequired")
  expect(second.narrowed).toEqual(denied(out, "outside capability ceiling"))

  // A journal cannot grant what the policy denies, and an entry that is not
  // a capability grants nothing.
  await Effect.runPromise(store.append(run, [
    { eventType: "GrantRemembered", payload: { requestId: "x", capability: { action: "fs:write", resource: "/workspace/.env" }, tier: "compensable" } },
    { eventType: "GrantRemembered", payload: { requestId: "y", capability: { action: "fs:delete", resource: "/workspace/a" } } },
    { eventType: "GrantRemembered", payload: "fs:write:/workspace/b" },
    { eventType: "GrantRemembered", payload: null }
  ], 1))
  const third = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      return {
        vetoed: yield* Effect.flip(Capability.check("fs:write:/workspace/.env")),
        unreadable: yield* Effect.flip(Capability.check("fs:write:/workspace/b"))
      }
    }),
    Layer.provide(Capability.journaled({ ...policy, attended: false }), journal)
  ))
  expect(third.vetoed).toEqual(denied(Capability.make("fs:write", "/workspace/.env"), "denied by permission policy"))
  expect(third.unreadable._tag).toBe("PermissionRequired")
})

test("a faulty journal grants nothing: the operation stays parked and can still be answered", async () => {
  let failing = true
  const written: Array<Capability.RememberedGrant> = []
  // A journal whose disk is full, then recovers.
  const journal = Layer.succeed(Capability.GrantJournal, {
    remembered: Effect.succeed([]),
    remember: (grant) => failing ? Effect.die(new Error("journal write failed")) : Effect.sync(() => void written.push(grant))
  })
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const asking = yield* Effect.forkChild(Capability.check(out))
      const [request] = yield* waiting(1)
      const failed = yield* Effect.exit(Capability.reply(request!.requestId, "remembered"))
      const parked = yield* Capability.pending
      const polled = asking.pollUnsafe()
      // Nothing was granted: the same operation asks again.
      const sameAgain = yield* Effect.forkChild(Capability.check(out))
      const both = yield* waiting(2)
      failing = false
      const answered = yield* Capability.reply(request!.requestId, "remembered")
      yield* Fiber.join(asking)
      yield* Fiber.join(sameAgain)
      // Without a journal, "remembered" is an answer for the store's life.
      const plain = yield* Effect.provide(
        Effect.gen(function*() {
          const again = yield* Effect.forkChild(Capability.check(site))
          const requests = yield* Capability.pending
          let mine = requests.filter((entry) => entry.capability.action === "net:get")
          while (mine.length === 0) {
            yield* Effect.yieldNow
            mine = (yield* Capability.pending).filter((entry) => entry.capability.action === "net:get")
          }
          yield* Capability.reply(mine[0]!.requestId, "remembered")
          yield* Fiber.join(again)
          yield* Capability.check(site)
        }),
        Capability.grantStore({ allow: [] })
      ).pipe(Effect.exit)
      return { failed, parked, polled, both: both.map((entry) => entry.requestId), answered, plain }
    }),
    Layer.provide(Capability.journaled({ allow: ["net:get:**"], workspace: "/workspace" }), journal)
  ))
  expect(Exit.isFailure(result.failed) && Cause.hasDies(result.failed.cause)).toBe(true)
  expect(result.parked).toEqual([{ requestId: "permission-1", capability: out, tier: "compensable" }])
  expect(result.polled).toBeUndefined()
  expect(result.both).toEqual(["permission-1", "permission-2"])
  expect(result.answered).toBe(true)
  expect(written).toEqual([{ requestId: "permission-1", capability: out, tier: "compensable" }])
  expect(Exit.isSuccess(result.plain)).toBe(true)
})

test("a grant is the capability as it was asked, whatever the caller does to its object afterwards", async () => {
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const mutable = { action: "fs:read" as Capability.Action, resource: "/a" }
      const asking = yield* Effect.forkChild(Capability.check(mutable))
      const [request] = yield* waiting(1)
      // The caller rewrites its object while the person is deciding.
      mutable.resource = "/b"
      const shown = (yield* Capability.pending)[0]!.capability.resource
      yield* Capability.reply(request!.requestId, "run")
      yield* Fiber.join(asking)
      // "/a" was granted. "/b" was not, and neither is a later rewrite.
      const other = yield* Effect.forkChild(Capability.check(mutable))
      const parked = yield* waiting(1)
      mutable.action = "fs:write"
      mutable.resource = "/etc/passwd"
      const third = yield* Effect.forkChild(Capability.check(mutable))
      const both = yield* waiting(2)
      yield* Fiber.interrupt(other)
      yield* Fiber.interrupt(third)
      yield* Capability.check("fs:read:/a")
      return { shown, parked: parked.map((entry) => entry.capability), both: both.map((entry) => Capability.format(entry.capability)) }
    }),
    Capability.grantStore({ allow: [] })
  ))
  expect(result.shown).toBe("/a")
  expect(result.parked).toEqual([Capability.make("fs:read", "/b")])
  expect(result.both).toEqual(["fs:read:/b", "fs:write:/etc/passwd"])
  // A policy is read when the store is built.
  const pattern = { action: "fs:read" as Capability.PatternAction, resource: "/workspace/**" }
  const widened = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      pattern.action = "*"
      pattern.resource = "**"
      return yield* Effect.flip(Capability.check("proc:spawn:rm -rf /"))
    }),
    Capability.grantStore({ allow: [pattern], attended: false })
  ))
  expect(widened._tag).toBe("PermissionRequired")
})

test("a remembered grant that reached the journal takes effect even if the reply is interrupted", async () => {
  const written: Array<Capability.RememberedGrant> = []
  let wrote = false
  // A journal that takes a moment after its write lands.
  const journal = Layer.succeed(Capability.GrantJournal, {
    remembered: Effect.succeed([]),
    remember: (grant) =>
      Effect.andThen(
        Effect.sync(() => {
          written.push(grant)
          wrote = true
        }),
        Effect.forEach([1, 2, 3, 4, 5], () => Effect.yieldNow, { discard: true })
      )
  })
  const result = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const asking = yield* Effect.forkChild(Capability.check(out))
      const [request] = yield* waiting(1)
      const replying = yield* Effect.forkChild(Capability.reply(request!.requestId, "remembered"))
      while (!wrote) yield* Effect.yieldNow
      yield* Fiber.interrupt(replying)
      // The journal holds the grant, so the store must too: a later "deny"
      // cannot leave the next process with a grant this one refused.
      const denied = yield* Capability.reply(request!.requestId, "deny")
      const outcome = yield* Effect.exit(Fiber.join(asking))
      return { denied, outcome }
    }),
    Layer.provide(Capability.journaled({ allow: [], workspace: "/workspace" }), journal)
  ))
  expect(written.length).toBe(1)
  expect(result.denied).toBe(false)
  expect(Exit.isSuccess(result.outcome)).toBe(true)
})

test("a host's store is asked as the object it is, and the journal and the store never disagree", async () => {
  // A store written as a class: its check reads its own fields.
  class HostStore implements Capability.Store {
    readonly asked: Array<string> = []
    constructor(readonly refuse: string) {}
    check(capability: Capability.Capability | Capability.CapabilityText) {
      const text = typeof capability === "string" ? capability : Capability.format(capability)
      this.asked.push(text)
      return text === this.refuse
        ? Effect.fail(denied(Capability.make("fs:read", "/workspace/README.md"), "refused by the host"))
        : Effect.void
    }
    readonly pending = Effect.succeed([])
    reply() {
      return Effect.succeed(false)
    }
  }
  const outer = new HostStore("fs:read:/workspace/README.md")
  const inner = new HostStore("never")
  const result = await Effect.runPromise(Effect.provide(
    Effect.provide(
      Effect.provide(
        Effect.gen(function*() {
          yield* Capability.check(out)
          return yield* Effect.flip(Capability.check(readme))
        }),
        Capability.grantStore({ allow: ["fs:write:**"], attended: false })
      ),
      Layer.succeed(Capability.GrantStore, inner)
    ),
    Layer.succeed(Capability.GrantStore, outer)
  ))
  // The inner host store replaced the outer one. It was asked through
  // `this`, and then the store built inside it decided.
  expect(inner.asked).toEqual(["fs:write:/workspace/out.txt", "fs:read:/workspace/README.md"])
  expect(outer.asked).toEqual([])
  expect(result._tag).toBe("PermissionRequired")

  // The asker leaves while the journal is writing. The journal holds the
  // grant, so the store holds it too: the next ask is not a question.
  const written: Array<Capability.RememberedGrant> = []
  let writing = false
  let release = false
  const journal = Layer.succeed(Capability.GrantJournal, {
    remembered: Effect.succeed([]),
    remember: (grant) =>
      Effect.gen(function*() {
        writing = true
        while (!release) yield* Effect.yieldNow
        written.push(grant)
      })
  })
  const agreed = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const asking = yield* Effect.forkChild(Capability.check(out))
      const [request] = yield* waiting(1)
      const replying = yield* Effect.forkChild(Capability.reply(request!.requestId, "remembered"))
      while (!writing) yield* Effect.yieldNow
      yield* Fiber.interrupt(asking)
      release = true
      yield* Fiber.join(replying)
      return { again: yield* Effect.exit(Capability.check(out)), pending: yield* Capability.pending }
    }),
    Layer.provide(Capability.journaled({ allow: [], workspace: "/workspace" }), journal)
  ))
  expect(written.length).toBe(1)
  expect(Exit.isSuccess(agreed.again)).toBe(true)
  expect(agreed.pending).toEqual([])
})
