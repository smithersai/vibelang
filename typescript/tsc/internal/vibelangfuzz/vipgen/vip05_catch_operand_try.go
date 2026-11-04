package vipgen

// A try in a catch's left side runs where it stands, before the catch, so the
// catch receives the Effect the left side gives (VIP-5, amended 2026-10-29;
// chapter 2's catch table: (try x) catch h is yield* Effect.catch(yield* x, h)).

var catchOperandTryCitation = Citation{VIP: 5, Template: "yield* Effect.catch(‹x›, ‹handler›)",
	Quote:   "`(try x) catch h` is allowed: it catches the Effect that `x` succeeds with.",
	Reading: "The reference runs the left side's yield* in the enclosing generator, then Effect.catch receives the Effect that the left side gives; a failure of that earlier run is the enclosing code's."}

func init() {
	for _, p := range []struct{ key, vibe, ref string }{
		{"vip05.catch-operand-try-outer",
			"const nested = Effect.fail(5); return (try nested) catch () => 7",
			"const nested = Effect.fail(5); return yield* Effect.catch(yield* nested, () => Effect.succeed(7))"},
		{"vip05.catch-operand-try-inner",
			"const nested = Effect.succeed(Effect.fail(5)); return (try nested) catch () => 7",
			"const nested = Effect.succeed(Effect.fail(5)); return yield* Effect.catch(yield* nested, () => Effect.succeed(7))"},
		{"vip05.catch-operand-try-argument",
			"const a = Effect.fail(2); return Effect.succeed(try a) catch () => 7",
			"const a = Effect.fail(2); return yield* Effect.catch(Effect.succeed(yield* a), () => Effect.succeed(7))"},
		{"vip05.catch-operand-try-order",
			"const g = (n: number) => { ev(\"g\"); return n > 2 ? Effect.fail(n) : Effect.succeed(n) }; return g((ev(\"l\"), 1) + (try Effect.sync(() => { ev(\"t\"); return 2 }))) catch (e) => e + 10",
			"const g = (n) => { ev(\"g\"); return n > 2 ? Effect.fail(n) : Effect.succeed(n) }; return yield* Effect.catch(g((ev(\"l\"), 1) + (yield* Effect.sync(() => { ev(\"t\"); return 2 }))), (e) => Effect.succeed(e + 10))"},
	} {
		p := p
		Register(&Construct{
			Key: p.key, VIP: 5,
			Requires:  []string{"vip01.effect-function", "vip05.try"},
			Citations: []Citation{catchOperandTryCitation},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				return []Stmt{&catchEdge{vibe: p.vibe, ref: p.ref}}
			},
		})
	}
}
