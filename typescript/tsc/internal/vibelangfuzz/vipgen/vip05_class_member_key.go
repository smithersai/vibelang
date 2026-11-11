package vipgen

// A class evaluates its members' computed names where it is defined, so in
// effect code a try there runs in the enclosing Effect, as await does in an
// async function (chapter 2; VIP-5, amended 2026-10-29).

var classMemberKeyCitation = Citation{VIP: 5, Template: "yield* Effect.‹operation›(‹value›)",
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

// A decorator expression also runs where its class is defined, in decorator,
// heritage and member order, so in effect code a try there runs in the
// enclosing Effect, as await does in an async function (chapter 2: @(try d)
// is allowed where @(await d) is). The reference is plain JavaScript, which
// has no decorators, and its decorator, mark, returns what it decorates, so
// each reference evaluates the same decorator expression at the same point and
// leaves out the identity application: a class decorator before its class,
// whose decorators run first, and a member decorator in a computed name at its
// member's position.
var classDecoratorCitation = Citation{VIP: 5, Template: "yield* Effect.‹operation›(‹value›)",
	Quote:   classMemberKeyCitation.Quote,
	Reading: "A decorator expression is not among those positions: await is allowed there, so the reference evaluates each decorator with yield* where the class is defined, class decorators first, then the extends expression, then each member's decorators before its name."}

func init() {
	const vibeMark = "const mark = <V>(value: V, _context: unknown): V => value; const B = class { }; "
	const refMark = "const mark = (value, _context) => value; const B = class { }; "
	for _, p := range []struct{ key, vibe, ref string }{
		{"vip05.class-decorator-order",
			vibeMark + "@(ev(\"cd\"), try Effect.succeed(mark)) class C extends (ev(\"base\"), B) { [(ev(\"k\"), \"m\")]() { return 1 } }; return try Effect.sync(() => (new C() as any).m())",
			refMark + "const $cd = (ev(\"cd\"), yield* Effect.succeed(mark)); void $cd; class C extends (ev(\"base\"), B) { [(ev(\"k\"), \"m\")]() { return 1 } }; return yield* Effect.sync(() => new C().m())"},
		{"vip05.member-decorator-order",
			vibeMark + "class C extends (ev(\"base\"), B) { [(ev(\"k\"), \"a\")]() { return 1 } @(ev(\"d\"), try Effect.succeed(mark)) m() { return 2 } static n() { return 3 } }; return try Effect.sync(() => (new C() as any).m() + (C as any).n())",
			refMark + "class C extends (ev(\"base\"), B) { [(ev(\"k\"), \"a\")]() { return 1 } [(ev(\"d\"), yield* Effect.succeed(mark), \"m\")]() { return 2 } static n() { return 3 } }; return yield* Effect.sync(() => new C().m() + C.n())"},
		{"vip05.member-decorator-failure",
			vibeMark + "class C extends (ev(\"base\"), B) { @(ev(\"d\"), try Effect.fail(3).pipe(Effect.as(mark))) m() { return 2 } }; ev(\"after\"); return 0",
			refMark + "class C extends (ev(\"base\"), B) { [(ev(\"d\"), yield* Effect.fail(3).pipe(Effect.as(mark)), \"m\")]() { return 2 } }; ev(\"after\"); return 0"},
	} {
		p := p
		Register(&Construct{
			Key: p.key, VIP: 5,
			Requires:  []string{"vip01.effect-function", "vip05.try"},
			Citations: []Citation{classDecoratorCitation},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				return []Stmt{&catchEdge{vibe: p.vibe, ref: p.ref}}
			},
		})
	}
}
