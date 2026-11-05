package vipgen

// A class evaluates its members' computed names where it is defined, so in
// effect code a try there runs in the enclosing Effect, as await does in an
// async function (chapter 2; VIP-5, amended 2026-10-29).

var classMemberKeyCitation = Citation{VIP: 5, Template: "yield* ‹x›",
	Quote:   "It is a unary operator with `await`'s precedence, and where `await` can't appear in an `async` function (its parameter list, a class field initializer, a `static` block), `try` can't appear in an `effect` function.",
	Reading: "A computed class member name is not among those positions: await is allowed there, so the reference evaluates each name with yield* where the class is defined, in member order after the extends expression."}

func init() {
	for _, p := range []struct{ key, vibe, ref string }{
		{"vip05.class-member-key-method",
			"class C { [(ev(\"k\"), try Effect.succeed(\"m\"))]() { return 1 } }; return Object.getOwnPropertyNames(C.prototype).length",
			"class C { [(ev(\"k\"), yield* Effect.succeed(\"m\"))]() { return 1 } }; return Object.getOwnPropertyNames(C.prototype).length"},
		{"vip05.class-member-key-order",
			"const B = class { }; class C extends (ev(\"base\"), B) { [(ev(\"a\"), try Effect.succeed(\"a\"))]() { return 1 }; static [(ev(\"b\"), try Effect.succeed(\"b\"))]() { return 2 } }; return try Effect.sync(() => (C as any).b())",
			"const B = class { }; class C extends (ev(\"base\"), B) { [(ev(\"a\"), yield* Effect.succeed(\"a\"))]() { return 1 }; static [(ev(\"b\"), yield* Effect.succeed(\"b\"))]() { return 2 } }; return yield* Effect.sync(() => C.b())"},
		{"vip05.class-member-key-getter",
			"class C { get [try Effect.succeed(\"g\")]() { ev(\"get\"); return 4 } }; return (new C() as any).g",
			"class C { get [yield* Effect.succeed(\"g\")]() { ev(\"get\"); return 4 } }; return new C().g"},
		{"vip05.class-member-key-failure",
			"class C { [(ev(\"k\"), try Effect.fail(3))]() { return 1 } }; ev(\"after\"); return 0",
			"class C { [(ev(\"k\"), yield* Effect.fail(3))]() { return 1 } }; ev(\"after\"); return 0"},
	} {
		p := p
		Register(&Construct{
			Key: p.key, VIP: 5,
			Requires:  []string{"vip01.effect-function", "vip05.try"},
			Citations: []Citation{classMemberKeyCitation},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				return []Stmt{&catchEdge{vibe: p.vibe, ref: p.ref}}
			},
		})
	}
}
