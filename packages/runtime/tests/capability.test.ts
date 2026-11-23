import { expect, test } from "bun:test"
import fc from "fast-check"
import { Option, PlatformError } from "effect"
import { Capability } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { anyCapability, anyPattern, anyRule, modelEvaluate, modelMatches, modelMatchesAnswer, modelMatchesResource, shuffled } from "./fixtures/capability-model.ts"

const command = "bun test tests/capability.test.ts"

test("VIP-58's example: the read is allowed and the write is asked", () => {
  const policy: Capability.Policy = { allow: ["fs:read:/workspace/**"] }
  expect(Capability.evaluate(policy, "fs:read:/workspace/README.md")).toBe("allow")
  expect(Capability.evaluate(policy, "fs:write:/workspace/out.txt")).toBe("ask")
  expect(Capability.evaluate({ allow: ["net:*:**"], deny: ["net:post:https://api.x.dev/*"] }, "net:post:https://api.x.dev/v1")).toBe("deny")
})

test("text form: the action is the first two parts and the resource keeps its colons", () => {
  expect(Capability.parse("net:get:https://api.github.com/repos/a:b")).toEqual(
    Option.some(Capability.make("net:get", "https://api.github.com/repos/a:b"))
  )
  expect(Capability.parse("fs:read:")).toEqual(Option.some(Capability.make("fs:read", "")))
  expect(Capability.format(Capability.make("proc:spawn", "npm test"))).toBe("proc:spawn:npm test")
  for (const text of ["", "fs", "fs:read", "fs:delete:/x", "fs:*:/x", "*:/x", "FS:READ:/x", `fs:read:${"a".repeat(4097)}`]) {
    expect(Capability.parse(text)).toEqual(Option.none())
  }
  expect(Option.isSome(Capability.parse(`fs:read:${"a".repeat(4096)}`))).toBe(true)
})

test("actions are a closed list of eighteen, nine of them jj actions", () => {
  expect(Capability.actions).toEqual([
    "fs:read", "fs:write", "net:get", "net:post", "net:private", "model:call", "memory:read", "memory:write", "proc:spawn",
    "jj:status", "jj:diff", "jj:snapshot", "jj:restore", "jj:workspace-add", "jj:workspace-forget", "jj:root", "jj:revert",
    "jj:op-restore"
  ])
  for (const action of Capability.actions) {
    expect(Capability.parse(`${action}:x`)).toEqual(Option.some(Capability.make(action, "x")))
  }
})

test("patterns: a namespace, every action, and the bare star", () => {
  expect(Capability.parsePattern("fs:*:/workspace/**")).toEqual(Option.some({ action: "fs:*", resource: "/workspace/**" }))
  expect(Capability.parsePattern("*:/workspace/**")).toEqual(Option.some({ action: "*", resource: "/workspace/**" }))
  expect(Capability.parsePattern("*")).toEqual(Option.some({ action: "*", resource: "**" }))
  for (const text of ["", "fs", "fs:read", "fs:delete:/x", "disk:*:/x", "**"]) {
    expect(Capability.parsePattern(text)).toEqual(Option.none())
  }
  expect(Capability.matches("fs:*:/w/**", "fs:write:/w/a")).toBe(true)
  expect(Capability.matches("fs:*:/w/**", "net:get:/w/a")).toBe(false)
  expect(Capability.matches("*", "jj:status:.")).toBe(true)
  expect(Capability.matches("*:/w/*", "proc:spawn:/w/run")).toBe(true)
})

test("globs: a star crosses slashes, a question mark is one unit, nothing escapes", () => {
  expect(Capability.matches("fs:read:/w/*", "fs:read:/w/a/b/c.txt")).toBe(true)
  expect(Capability.matches("fs:read:/w/*.txt", "fs:read:/w/a/b/c.txt")).toBe(true)
  expect(Capability.matches("fs:read:/w/*.txt", "fs:read:/w/a.md")).toBe(false)
  expect(Capability.matches("fs:read:/w/?.txt", "fs:read:/w/a.txt")).toBe(true)
  expect(Capability.matches("fs:read:/w/?.txt", "fs:read:/w/ab.txt")).toBe(false)
  expect(Capability.matches("fs:read:/w/?.txt", "fs:read:/w/.txt")).toBe(false)
  // No escape: a backslash is an ordinary character, so `\*` still globs.
  expect(Capability.matches("fs:read:/w/\\*", "fs:read:/w/\\anything")).toBe(true)
  expect(Capability.matches("fs:read:/w/\\*", "fs:read:/w/*")).toBe(false)
  // Matching is exact text: no case folding, and the whole resource.
  expect(Capability.matches("fs:read:/w/a", "fs:read:/W/a")).toBe(false)
  expect(Capability.matches("fs:read:/w", "fs:read:/w/a")).toBe(false)
  // A command grant ending in " *" also grants the bare command.
  expect(Capability.matches("proc:spawn:npm *", "proc:spawn:npm")).toBe(true)
  expect(Capability.matches("proc:spawn:npm *", "proc:spawn:npm test --watch")).toBe(true)
  expect(Capability.matches("proc:spawn:npm *", "proc:spawn:npmx")).toBe(false)
  // A pattern built to backtrack still answers at once.
  const started = performance.now()
  expect(Capability.matches(`fs:read:${"a*".repeat(1000)}b`, `fs:read:${"a".repeat(4000)}`)).toBe(false)
  expect(performance.now() - started).toBeLessThan(2000)
})

test("order: a deny is a veto, an unmatched request asks, and the last matching answer wins", () => {
  const policy: Capability.Policy = { allow: ["fs:*:/w/**"], deny: ["fs:write:/w/secrets/**"] }
  expect(Capability.evaluate(policy, "fs:write:/w/a")).toBe("allow")
  expect(Capability.evaluate(policy, "fs:write:/w/secrets/key")).toBe("deny")
  expect(Capability.evaluate(policy, "net:get:https://example.com/")).toBe("ask")
  // The same patterns in another order decide the same way.
  expect(Capability.evaluate({ deny: policy.deny, allow: policy.allow }, "fs:write:/w/secrets/key")).toBe("deny")
  // An empty policy allows nothing.
  expect(Capability.evaluate({ allow: [] }, "fs:read:/w/a")).toBe("ask")

  const allow = (pattern: Capability.PatternText): Capability.Rule => ({ effect: "allow", pattern })
  const deny = (pattern: Capability.PatternText): Capability.Rule => ({ effect: "deny", pattern })
  const net = "net:get:https://example.com/"
  expect(Capability.evaluate(policy, net, [allow("net:get:https://example.com/*")])).toBe("allow")
  expect(Capability.evaluate(policy, net, [allow("net:get:**"), deny("net:get:https://example.com/*")])).toBe("deny")
  expect(Capability.evaluate(policy, net, [deny("net:get:https://example.com/*"), allow("net:get:**")])).toBe("allow")
  expect(Capability.evaluate(policy, net, [allow("net:get:**"), { effect: "ask", pattern: "net:get:**" }])).toBe("ask")
  // A later deny overrides the policy's allow. No later allow overrides the policy's deny.
  expect(Capability.evaluate(policy, "fs:write:/w/a", [deny("fs:write:/w/a")])).toBe("deny")
  expect(Capability.evaluate(policy, "fs:write:/w/secrets/key", [allow("*")])).toBe("deny")
})

test("what cannot be decided is denied", () => {
  const all: Capability.Policy = { allow: ["*"] }
  // An absolute path that still holds a dot segment names nothing certain.
  expect(Capability.evaluate(all, "fs:read:/w/../etc/passwd")).toBe("deny")
  expect(Capability.evaluate(all, "fs:read:/w/./a")).toBe("deny")
  expect(Capability.evaluate(all, "fs:write:src/../../etc")).toBe("deny")
  // A relative path is read as its text and as its normal form.
  expect(Capability.evaluate({ allow: ["fs:read:src/**"] }, "fs:read:src/a/../b")).toBe("allow")
  expect(Capability.evaluate({ allow: ["fs:read:**"], deny: ["fs:read:secrets/key"] }, "fs:read:x/../secrets/key")).toBe("deny")
  // A dot segment means nothing in a URL or a command line.
  expect(Capability.evaluate(all, "net:get:https://example.com/a/../b")).toBe("allow")
  // Values that reached the function without passing the types.
  const unchecked = <A>(value: unknown) => value as A
  expect(Capability.evaluate(all, unchecked("fs:delete:/w/a"))).toBe("deny")
  expect(Capability.evaluate(all, unchecked({ action: "fs:read", resource: "a".repeat(4097) }))).toBe("deny")
  expect(Capability.evaluate(all, unchecked({ action: "fs:delete", resource: "/w/a" }))).toBe("deny")
  expect(Capability.evaluate({ allow: ["*", unchecked("fs:raed:/w/**")] }, "fs:read:/w/a")).toBe("deny")
  expect(Capability.evaluate({ allow: ["*"], deny: [unchecked("nonsense")] }, "fs:read:/w/a")).toBe("deny")
  expect(Capability.evaluate(all, "fs:read:/w/a", [{ effect: "allow", pattern: unchecked("nonsense") }])).toBe("deny")
  expect(Capability.evaluate(all, "fs:read:/w/a", [{ effect: unchecked("permit"), pattern: "*" }])).toBe("deny")
})

test("net:private is granted only by name", () => {
  const address = "net:private:http://10.0.0.1/"
  expect(Capability.evaluate({ allow: ["*"] }, address)).toBe("ask")
  expect(Capability.evaluate({ allow: ["net:*:**"] }, address)).toBe("ask")
  expect(Capability.evaluate({ allow: ["net:private:http://10.0.0.1/*"] }, address)).toBe("allow")
  expect(Capability.evaluate({ allow: ["net:private:**"], deny: ["net:*:http://10.*"] }, address)).toBe("deny")
  expect(Capability.evaluate({ allow: [] }, address, [{ effect: "allow", pattern: "*" }])).toBe("ask")
})

test("tiers follow VIP-58's table", () => {
  const workspace = { workspace: "/workspace" }
  for (const sealed of ["fs:read:/etc/hosts", "net:get:https://example.com/", "model:call:claude", "memory:read:notes"] as const) {
    expect(Capability.tierOf(sealed, workspace)).toBe("sealed")
  }
  expect(Capability.tierOf("fs:write:/workspace/out.txt", workspace)).toBe("compensable")
  expect(Capability.tierOf("fs:write:out.txt", workspace)).toBe("compensable")
  expect(Capability.tierOf("fs:write:/workspace", workspace)).toBe("compensable")
  for (
    const irreversible of [
      "net:post:https://example.com/",
      "proc:spawn:npm test",
      "memory:write:notes",
      "fs:write:/etc/hosts",
      "fs:write:/workspace/../etc/hosts",
      "fs:write:../out.txt",
      "fs:write:/workspace-other/out.txt",
      "fs:write:C:\\workspace\\out.txt",
      "fs:write:~/out.txt"
    ] as const
  ) {
    expect(Capability.tierOf(irreversible, workspace)).toBe("irreversible")
  }
  // With no workspace to be inside, every write is irreversible.
  expect(Capability.tierOf("fs:write:out.txt", { workspace: "." })).toBe("irreversible")
  expect(Capability.tierOf("fs:delete:/workspace/a" as Capability.CapabilityText, workspace)).toBe("irreversible")
})

test("a refusal travels in a PlatformError and reads back out", () => {
  const capability = Capability.make("fs:write", "/workspace/out.txt")
  const asked = new Capability.PermissionRequired({ requestId: "permission-1", capability, tier: "compensable" })
  const refused = new Capability.PermissionDenied({ capability, reason: "denied by permission policy" })
  const wrap = (error: Capability.PermissionRequired | Capability.PermissionDenied) =>
    Capability.toPlatformError({ module: "FileSystem", method: "writeFileString", pathOrDescriptor: capability.resource, error })

  const requiredError = wrap(asked)
  expect(PlatformError.isPlatformError(requiredError)).toBe(true)
  expect(requiredError.reason._tag).toBe("PermissionDenied")
  expect(requiredError.message).toContain("permission required: fs:write:/workspace/out.txt (tier compensable, request permission-1)")
  expect(Capability.required(requiredError)).toEqual(Option.some(asked))
  expect(Capability.denied(requiredError)).toEqual(Option.none())

  const deniedError = wrap(refused)
  expect(deniedError.message).toContain("permission denied: fs:write:/workspace/out.txt: denied by permission policy")
  expect(Capability.denied(deniedError)).toEqual(Option.some(refused))
  expect(Capability.required(deniedError)).toEqual(Option.none())

  // The operating system's own refusal is not a kernel decision, and neither
  // is an object that only looks like one.
  const eacces = PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "open", cause: new Error("EACCES") })
  const forged = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "open",
    cause: { _tag: "PermissionDenied", capability, reason: "forged" }
  })
  const missing = PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method: "open", cause: refused })
  for (const other of [eacces, forged, missing]) {
    expect(Capability.required(other)).toEqual(Option.none())
    expect(Capability.denied(other)).toEqual(Option.none())
  }

  // A resource is outside text: one line, control characters shown, bounded.
  const hostile = new Capability.PermissionDenied({
    capability: Capability.make("proc:spawn", `rm -rf /\nok ${"x".repeat(400)}`),
    reason: "outside capability ceiling"
  })
  expect(hostile.message).toContain("rm -rf /\\nok ")
  expect(hostile.message).not.toContain("\n")
  expect(hostile.message.length).toBeLessThan(400)
})

const anyCase = fc.record({
  allow: fc.array(anyPattern, { maxLength: 5 }),
  deny: fc.array(anyPattern, { maxLength: 3 }),
  answers: fc.array(anyRule, { maxLength: 5 }),
  capability: anyCapability,
  seed: fc.integer()
})
type Case = typeof anyCase extends fc.Arbitrary<infer A> ? A : never

test("the matcher agrees with a regular expression on every glob", async () => {
  await checkProperty(fc, {
    name: "capability-glob-matches-model",
    rule: "VIP-58 rule 2: `*` matches any run of characters, `/` included, and `?` matches one character",
    command,
    arbitrary: fc.record({ pattern: anyPattern, capability: anyCapability }),
    numRuns: 2000,
    check: ({ pattern, capability }: { pattern: Capability.Pattern; capability: Capability.Capability }) => {
      expect(Capability.matches(pattern, capability)).toBe(modelMatches(pattern, capability))
      // The text form and the structural form are one pattern.
      const formatted = Capability.format(pattern) as Capability.PatternText
      expect(Capability.matches(formatted, capability)).toBe(modelMatches(pattern, capability))
    }
  })
})

test("a deny anywhere vetoes", async () => {
  await checkProperty(fc, {
    name: "capability-deny-vetoes",
    rule: "VIP-58 rule 4: a configured deny is a veto",
    command,
    arbitrary: anyCase,
    numRuns: 2000,
    check: ({ allow, deny, answers, capability, seed }: Case) => {
      // Deny the request itself, at any position among the denies, and add
      // an answer that allows everything: the decision is still deny.
      const veto: Capability.Pattern = { action: capability.action, resource: capability.resource }
      const denies = shuffled([...deny, veto], seed)
      const overriding = [...answers, { effect: "allow" as const, pattern: "*" as const }]
      expect(Capability.evaluate({ allow: shuffled([...allow, { action: "*", resource: "**" }], seed), deny: denies }, capability, overriding))
        .toBe("deny")
      // And a deny decides only what it matches.
      if (!deny.some((pattern) => modelMatches(pattern, capability, "wide"))) {
        expect(Capability.evaluate({ allow, deny }, capability, overriding)).toBe("allow")
      }
    }
  })
})

test("rule order changes only which answer is last", async () => {
  await checkProperty(fc, {
    name: "capability-order",
    rule: "VIP-58 rule 4: the last rule that matches wins, except that a configured deny is a veto; a request no rule matches is ask",
    command,
    arbitrary: anyCase,
    numRuns: 3000,
    check: ({ allow, deny, answers, capability, seed }: Case) => {
      const expected = modelEvaluate({ allow, deny }, capability, answers)
      expect(Capability.evaluate({ allow, deny }, capability, answers)).toBe(expected)
      // A policy's own order never matters.
      expect(Capability.evaluate({ allow: shuffled(allow, seed), deny: shuffled(deny, seed + 1) }, capability, answers)).toBe(expected)
      // Among answers, only the last one that matches counts: moving every
      // other answer around it, or dropping them, changes nothing.
      const matching = answers.filter((rule) => modelMatchesAnswer(rule, capability))
      const last = matching.at(-1)
      if (last !== undefined) {
        const others = shuffled(answers.filter((rule) => rule !== last), seed)
        expect(Capability.evaluate({ allow, deny }, capability, [...others, last])).toBe(expected)
        expect(Capability.evaluate({ allow, deny }, capability, [last])).toBe(expected)
      }
      // An answer that does not match changes nothing, wherever it stands.
      const silent = answers.filter((rule) => !modelMatchesAnswer(rule, capability))
      expect(Capability.evaluate({ allow, deny }, capability, [...matching, ...silent])).toBe(expected)
      // Without a deny or an answer, an unmatched request is ask, never allow.
      if (!allow.some((pattern) => modelMatches(pattern, capability))) {
        expect(Capability.evaluate({ allow }, capability)).toBe("ask")
      }
    }
  })
})

test("a deny applies on the widest reading, and an allow on the narrowest", () => {
  // A deny that selects only the text with its dot segments still applies.
  expect(Capability.evaluate({ allow: ["fs:write:*"], deny: ["fs:write:*/../*"] }, "fs:write:build/../.env")).toBe("deny")
  // A file-system deny ignores case, because some volumes do. An allow never does.
  const git: Capability.Policy = { allow: ["fs:write:/ws/*"], deny: ["fs:write:/ws/.git/*"] }
  expect(Capability.evaluate(git, "fs:write:/ws/.GIT/config")).toBe("deny")
  expect(Capability.evaluate(git, "fs:write:/ws/src/a.ts")).toBe("allow")
  expect(Capability.evaluate({ allow: ["fs:read:/ws/a"] }, "fs:read:/WS/a")).toBe("ask")
  expect(Capability.evaluate({ allow: ["net:get:**"], deny: ["net:get:https://example.com/Admin/*"] }, "net:get:https://example.com/admin/x")).toBe("allow")
})

test("a wildcard in a URL's host stays in the host", () => {
  const subdomains = "net:get:https://*.example.com/*"
  expect(Capability.matches(subdomains, "net:get:https://api.example.com/v1")).toBe(true)
  expect(Capability.matches(subdomains, "net:get:https://evil.test/.example.com/")).toBe(false)
  expect(Capability.matches(subdomains, "net:get:https://evil.test/x?u=https://a.example.com/")).toBe(false)
  expect(Capability.evaluate({ allow: [subdomains] }, "net:get:https://evil.test/.example.com/")).toBe("ask")
  // The path part keeps crossing slashes, and a pattern with no scheme is one text.
  expect(Capability.matches("net:get:https://api.github.com/repos/**", "net:get:https://api.github.com/repos/a/b?page=2")).toBe(true)
  expect(Capability.matches("net:get:**", "net:get:https://evil.test/.example.com/")).toBe(true)
  expect(Capability.matches("net:*:*", "net:post:http://127.0.0.1:8080/x")).toBe(true)
  // A pattern that stops inside the host is one text, as the documentation warns.
  expect(Capability.matches("net:get:https://api.github.com*", "net:get:https://api.github.com.evil.test/")).toBe(true)
  // A deny takes the wide reading: the star may cross into the path.
  const policy: Capability.Policy = { allow: ["net:get:**"], deny: ["net:get:https://*/admin/*"] }
  expect(Capability.evaluate(policy, "net:get:https://a.test/admin/x")).toBe("deny")
  expect(Capability.evaluate(policy, "net:get:https://a.test/x/admin/y")).toBe("deny")
  expect(Capability.evaluate(policy, "net:get:https://a.test/x")).toBe("allow")
})

test("an allow's reading of a URL pattern only ever narrows the deny's", async () => {
  const hostText = fc.array(fc.constantFrom("a", "b", ".", "*", "?"), { minLength: 1, maxLength: 5 }).map((parts) => parts.join(""))
  const pathText = fc.array(fc.constantFrom("a", "b", "/", ".", "*", "?"), { maxLength: 6 }).map((parts) => parts.join(""))
  const literal = (units: ReadonlyArray<string>, minLength: number) =>
    fc.array(fc.constantFrom(...units), { minLength, maxLength: 6 }).map((parts) => parts.join(""))
  await checkProperty(fc, {
    name: "capability-url-narrow-within-wide",
    rule: "VIP-58 rule 2 with the host refinement: an allow matches host and path separately, a deny matches the whole text, and the first is always inside the second",
    command,
    arbitrary: fc.record({
      patternHost: hostText,
      patternPath: pathText,
      host: literal(["a", "b", "."], 1),
      path: literal(["a", "b", "/", "."], 0)
    }),
    numRuns: 3000,
    check: ({ patternHost, patternPath, host, path }: { patternHost: string; patternPath: string; host: string; path: string }) => {
      const pattern = `net:get:https://${patternHost}/${patternPath}` as Capability.PatternText
      const capability = Capability.make("net:get", `https://${host}/${path}`)
      const narrow = modelMatchesResource(`https://${patternHost}`, `https://${host}`) && modelMatchesResource(`/${patternPath}`, `/${path}`)
      const wide = modelMatchesResource(`https://${patternHost}/${patternPath}`, capability.resource)
      expect(Capability.matches(pattern, capability)).toBe(narrow)
      expect(Capability.evaluate({ allow: [pattern] }, capability)).toBe(narrow ? "allow" : "ask")
      expect(Capability.evaluate({ allow: ["net:get:**"], deny: [pattern] }, capability)).toBe(wide ? "deny" : "allow")
      // Whatever the allow selects, the same pattern as a deny selects too.
      if (narrow) expect(wide).toBe(true)
    }
  })
})

test("a host wildcard stays in the host however the pattern is written, and escapes are read one way", () => {
  // No slash after the host, and no scheme at all.
  expect(Capability.evaluate({ allow: ["net:get:https://*.example.com*"] }, "net:get:https://evil.test/.example.com")).toBe("ask")
  expect(Capability.evaluate({ allow: ["net:get:https://*.example.com*"] }, "net:get:https://api.example.com/v1")).toBe("allow")
  expect(Capability.evaluate({ allow: ["net:get:*.example.com/*"] }, "net:get:https://evil.test/a.example.com/x")).toBe("ask")
  expect(Capability.evaluate({ allow: ["net:get:*.example.com/*"] }, "net:get:https://a.example.com/x")).toBe("allow")
  expect(Capability.evaluate({ allow: ["net:get:*"] }, "net:get:https://a.example.com/x")).toBe("allow")
  expect(Capability.evaluate({ allow: ["net:*:**"] }, "net:post:http://127.0.0.1:8080/x?y=1")).toBe("allow")
  // The command rule for a trailing " *" is not a way round the host.
  expect(Capability.matches("net:get:https://* */admin", "net:get:https://h/admin")).toBe(false)
  // %7E is "~" and needs no escape: a pattern and a request agree whichever way each wrote it.
  const tilde: Capability.Policy = { allow: ["net:get:https://h/**"], deny: ["net:get:https://h/%7Eadmin/*"] }
  expect(Capability.evaluate(tilde, "net:get:https://h/%7Eadmin/x")).toBe("deny")
  expect(Capability.evaluate(tilde, "net:get:https://h/~admin/x")).toBe("deny")
  expect(Capability.evaluate({ allow: ["net:get:https://h/a%2fb"] }, "net:get:https://h/a%2Fb")).toBe("allow")
  // A file name is not a URL: its text is exact.
  expect(Capability.evaluate({ allow: ["fs:read:/w/%7Ea"] }, "fs:read:/w/~a")).toBe("ask")
})

test("a pattern's host ends at its first slash, wherever a later URL appears, and escapes are decoded once", () => {
  const callback: Capability.Policy = { allow: ["net:get:*.example.com/cb?next=https://*"] }
  expect(Capability.evaluate(callback, "net:get:https://a.example.com/cb?next=https://b.test/")).toBe("allow")
  expect(Capability.evaluate(callback, "net:get:https://evil.test/a.example.com/cb?next=https://b.test/")).toBe("ask")
  // "%%36%31" is a literal percent sign and then "61": one reading gives "%61dmin", not "admin".
  expect(Capability.evaluate({ allow: ["net:get:https://x.test/admin"] }, "net:get:https://x.test/%%36%31dmin")).toBe("ask")
  expect(Capability.evaluate({ allow: ["net:get:https://x.test/admin"] }, "net:get:https://x.test/%61dmin")).toBe("allow")
})
