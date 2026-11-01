package vipgen

// R11 ASTRA-1: observe a resolved Promise executor and retain both native
// results by identity. No Promise is awaited or raced; any exempts EK0507.
func init() {
	Register(&Construct{
		Key: "vip05.catch-native-result-arrow", VIP: 5,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 5,
			Template: "yield* Effect.catch(‹x›, () => Effect.succeed(‹result›))",
			Quote:    "A successful `try` and a plain `catch` handler result likewise keep their immediate value as data, without recursive execution or thenable assimilation.",
			Reading:  "Use the VIP table's Effect.succeed and the shared differential comparator. The ordinary Promise executor runs synchronously; an untouched thenable never invokes then. Probe both result identities and the existing event trace.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "let promised: any;\nconst make = (): any => { ev(\"factory\"); promised = new Promise<number>((resolve) => { ev(\"executor\"); resolve(7) }); return promised };\nconst lazy: any = { then: (resolve: any) => { ev(\"then-called\"); resolve(9) } };\nconst first = Effect.fail(0) catch () => make();\nconst second = Effect.fail(0) catch () => lazy;\nreturn [first === promised, second === lazy];", ref: "let promised;\nconst make = () => { ev(\"factory\"); promised = new Promise((resolve) => { ev(\"executor\"); resolve(7) }); return promised };\nconst lazy = { then: (resolve) => { ev(\"then-called\"); resolve(9) } };\nconst first = yield* Effect.catch(Effect.fail(0), () => Effect.succeed(make()));\nconst second = yield* Effect.catch(Effect.fail(0), () => Effect.succeed(lazy));\nreturn [first === promised, second === lazy];"}}
		},
	})
}

// R11 ASTRA-1: observe a resolved Promise executor and retain both native
// results by identity. No Promise is awaited or raced; any exempts EK0507.
func init() {
	Register(&Construct{
		Key: "vip05.catch-native-result-block", VIP: 5,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 5,
			Template: "yield* Effect.catch(‹x›, () => Effect.succeed(‹result›))",
			Quote:    "A successful `try` and a plain `catch` handler result likewise keep their immediate value as data, without recursive execution or thenable assimilation.",
			Reading:  "Use the VIP table's Effect.succeed and the shared differential comparator. The ordinary Promise executor runs synchronously; an untouched thenable never invokes then. Probe both result identities and the existing event trace.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "let promised: any;\nconst make = (): any => { ev(\"factory\"); promised = new Promise<number>((resolve) => { ev(\"executor\"); resolve(7) }); return promised };\nconst lazy: any = { then: (resolve: any) => { ev(\"then-called\"); resolve(9) } };\nconst first = Effect.fail(0) catch () => { return make() };\nconst second = Effect.fail(0) catch () => { return lazy };\nreturn [first === promised, second === lazy];", ref: "let promised;\nconst make = () => { ev(\"factory\"); promised = new Promise((resolve) => { ev(\"executor\"); resolve(7) }); return promised };\nconst lazy = { then: (resolve) => { ev(\"then-called\"); resolve(9) } };\nconst first = yield* Effect.catch(Effect.fail(0), () => { return Effect.succeed(make()) });\nconst second = yield* Effect.catch(Effect.fail(0), () => { return Effect.succeed(lazy) });\nreturn [first === promised, second === lazy];"}}
		},
	})
}

// R11 ASTRA-1: observe a resolved Promise executor and retain both native
// results by identity. No Promise is awaited or raced; any exempts EK0507.
func init() {
	Register(&Construct{
		Key: "vip05.catch-native-result-function", VIP: 5,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 5,
			Template: "yield* Effect.catch(‹x›, function () { return Effect.succeed(‹result›) })",
			Quote:    "A successful `try` and a plain `catch` handler result likewise keep their immediate value as data, without recursive execution or thenable assimilation.",
			Reading:  "Use the VIP table's Effect.catch and Effect.succeed with a plain function-expression handler, which VIP-5 admits alongside an arrow, and the shared differential comparator. The ordinary Promise executor runs synchronously; an untouched thenable never invokes then. Probe both result identities and the existing event trace.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "let promised: any;\nconst make = (): any => { ev(\"factory\"); promised = new Promise<number>((resolve) => { ev(\"executor\"); resolve(7) }); return promised };\nconst lazy: any = { then: (resolve: any) => { ev(\"then-called\"); resolve(9) } };\nconst first = Effect.fail(0) catch function () { return make() };\nconst second = Effect.fail(0) catch function () { return lazy };\nreturn [first === promised, second === lazy];", ref: "let promised;\nconst make = () => { ev(\"factory\"); promised = new Promise((resolve) => { ev(\"executor\"); resolve(7) }); return promised };\nconst lazy = { then: (resolve) => { ev(\"then-called\"); resolve(9) } };\nconst first = yield* Effect.catch(Effect.fail(0), function () { return Effect.succeed(make()) });\nconst second = yield* Effect.catch(Effect.fail(0), function () { return Effect.succeed(lazy) });\nreturn [first === promised, second === lazy];"}}
		},
	})
}
