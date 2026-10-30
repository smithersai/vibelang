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
			// Until the compiler stops passing an Effect-typed argument by
			// name, it calls load() inside the Effect.suspend it wraps the
			// argument in, after the call that takes it has run, where
			// JavaScript calls it first (vip04.ts-throw-argument). Unless
			// that construct is on, the operand stands in Effect.suspend,
			// which both prints call where the Effect runs.
			if g.On("vip04.ts-throw-argument") {
				g.Use("vip04.ts-throw-argument")
				return tsThrowCall(g)
			}
			return &ModCall{Mod: "Effect", Fn: "suspend", Args: []Expr{&Arrow{Body: tsThrowCall(g)}}}
		},
	})
	// An argument is evaluated where the call stands, before the call, as
	// every operand is (Chapter 2), whatever the parameter's type (Will's
	// OTHER-7: a call's meaning comes from its syntax). load() throws while
	// Effect.ensuring's arguments are evaluated, so no finalizer is added.
	Register(&Construct{
		Key:      "vip04.ts-throw-argument",
		VIP:      4,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip04.ts-throw"},
		Citations: []Citation{{
			VIP:      4,
			Template: "yield* ‹load›()",
			Quote:    "A function that returns an Effect, whether an `effect` function or a `.ts` function whose return type is `Effect`, can't throw: calling it is never throw-tracked, and its failures are its Effect's error channel",
			Reading:  "Not tracked is not deferred: the call is Effect.ensuring's argument, which JavaScript evaluates before Effect.ensuring runs, so its throw is a defect of main and Effect.ensuring never adds its finalizer.",
		}},
		// The probe logs, then runs Effect.ensuring(load(), log): load logs
		// and throws, and the finalizer's log never comes.
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.Use("vip04.ts-throw")
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			run := &Const{Name: v, Value: &Try{X: &ModCall{Mod: "Effect", Fn: "ensuring", Args: []Expr{tsThrowCall(g), &SyncLog{Label: g.Label()}}}}}
			return []Stmt{&Event{Label: g.Label()}, run}
		},
	})
}

// tsThrowCall adds lib.ts to the program and calls its load.
func tsThrowCall(g *Gen) Expr {
	g.AddFile("lib.ts", tsThrowModule, "load")
	return &Call{Name: "load"}
}
