package vipgen

// VIP-4, amended 2026-10-29: "A function that returns an Effect, whether an
// `effect` function or a `.ts` function whose return type is `Effect`, can't
// throw: calling it is never throw-tracked". Chapter 3 says what happens
// when a .ts implementation breaks that contract: "The exemption is a static
// contract, not a JavaScript runtime guarantee: a `.ts` implementation that
// throws before returning produces a defect when called inside effect
// code." The program imports such a function from lib.ts (Program.Files) and
// runs it with try; the reference runs the same emitted JavaScript with
// yield* inside Effect.gen, where the throw is a defect.

// tsThrowModule is lib.ts: load says it returns an Effect, logs, and throws
// before returning one.
const tsThrowModule = `import { Effect } from "effect"
import { ev } from "vip-events"

export function load(): Effect.Effect<number> {
  ev("load")
  throw new Error("x")
}
`

func init() {
	Register(&Construct{
		Key:      "vip04.ts-throw",
		VIP:      4,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      4,
			Template: "yield* ‹load›()",
			Quote:    "A function that returns an Effect, whether an `effect` function or a `.ts` function whose return type is `Effect`, can't throw: calling it is never throw-tracked, and its failures are its Effect's error channel",
			Reading:  "VIP-4 shows no Effect TS for calling a .ts function. try runs its Effect with yield* (VIP-5), and Chapter 3 says a .ts implementation that throws before returning produces a defect when called inside effect code, as a throw inside Effect.gen's body does.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			v := g.Name("v")
			run := &Const{Name: v, Value: &Try{X: tsThrowCall(g)}}
			s.Locals = append(s.Locals, v)
			return []Stmt{&Event{Label: g.Label()}, run, &Event{Label: g.Label()}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			return tsThrowCall(g)
		},
	})
}

// tsThrowCall adds lib.ts to the program and calls its load.
func tsThrowCall(g *Gen) Expr {
	g.AddFile("lib.ts", tsThrowModule, "load")
	return &Call{Name: "load"}
}
