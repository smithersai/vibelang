package vipgen

import (
	"fmt"
	"strings"
)

// Chapter 2, Region bodies, "Effect observers": the finalizer of a layer around
// a provide or interruption region sees the accepted generator's success
// payload. The layer logs that payload, so a compiler control record that
// reaches the primitive success channel differs from the reference.
const observerQuote = "A `provide` or interruption region preserves its source completion separately from the primitive Effect success value."

const observerReading = "The reference writes each region as the accepted generator, so a finalizer sees the returned value, or undefined for a normal end, a break or a continue. The jump's target stays private to the region."

// Each form names its observing layer LIVE and its value VALUE. The reference
// reaches the same statement through ordinary state, as 002-running.md's
// observer witness does.
var observerForms = []struct{ key, vibe, reference string }{
	{"return", `provide LIVE { return VALUE }`,
		`return yield* Effect.provide(Effect.gen(function* () { return VALUE }), LIVE)`},
	{"bare-return", `provide LIVE { return }`,
		`return yield* Effect.provide(Effect.gen(function* () { return }), LIVE)`},
	{"nested-return", `provide LIVE { provide LIVE { return VALUE } }`,
		`return yield* Effect.provide(Effect.provide(Effect.gen(function* () { return VALUE }), LIVE), LIVE)`},
	{"masked-return", `provide LIVE { uninterruptible { return VALUE } }`,
		`return yield* Effect.provide(Effect.uninterruptibleMask(() => Effect.gen(function* () { return VALUE })), LIVE)`},
	{"restored-return", `provide LIVE { uninterruptible { restore { return VALUE } } }`,
		`return yield* Effect.provide(Effect.uninterruptibleMask((restore) => restore(Effect.gen(function* () { return VALUE }))), LIVE)`},
	{"normal", `const v: number = do { provide LIVE { VALUE } }; return v`,
		`let v = 0; yield* Effect.provide(Effect.gen(function* () { v = VALUE }), LIVE); return v`},
	{"break", `while (true) { provide LIVE { break } }; return VALUE`,
		`yield* Effect.provide(Effect.gen(function* () { }), LIVE); return VALUE`},
	{"labeled-break", `outer: for (const a of [1]) { for (const b of [1]) { provide LIVE { break outer } } }; return VALUE`,
		`yield* Effect.provide(Effect.gen(function* () { }), LIVE); return VALUE`},
	{"continue", `for (const n of [1, 2]) { provide LIVE { if (n === 1) continue; ev("after") } }; return VALUE`,
		`for (const n of [1, 2]) { yield* Effect.provide(Effect.gen(function* () { if (n !== 1) ev("after") }), LIVE) }; return VALUE`},
	{"loop-return", `for (const n of [VALUE]) { provide LIVE { return n } }; return 0`,
		`return yield* Effect.provide(Effect.gen(function* () { return VALUE }), LIVE)`},
}

func init() {
	for _, form := range observerForms {
		Register(&Construct{
			Key: "vip12.observer-" + form.key, VIP: 12,
			Requires:  []string{"vip01.effect-function", "vip05.try", "vip12.provide", "vip22.uninterruptible"},
			Citations: []Citation{{VIP: 12, Template: "yield* Effect.provide(Effect.gen(function* () { ‹body› }), ‹layer›)", Quote: observerQuote, Reading: observerReading}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				g.UseModule("Layer", true)
				live, label := g.Name("observerLive"), g.Label()
				decl := fmt.Sprintf("const %s = Layer.effectDiscard(Effect.acquireRelease(Effect.succeed(undefined), (_, exit) => Effect.sync(() => ev(%q + (exit._tag === \"Success\" ? String(exit.value) : exit._tag)))))", live, label+":")
				g.AddDecl(&Code{V: decl, E: decl})
				rename := strings.NewReplacer("LIVE", live, "VALUE", fmt.Sprint(1+g.Intn(30)))
				return []Stmt{&catchEdge{vibe: rename.Replace(form.vibe), ref: rename.Replace(form.reference)}}
			},
		})
	}
}
