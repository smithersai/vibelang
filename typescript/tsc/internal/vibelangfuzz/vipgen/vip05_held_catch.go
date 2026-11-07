package vipgen

import "fmt"

func init() {
	Register(&Construct{
		Key: "vip05.catch-held-operand", VIP: 5,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{
			VIP: 5, Template: "yield* Effect.catch(‹operand›, () => Effect.succeed(‹fallback›))",
			Quote:   "| `x catch (e) => f(e)` (a plain function; a `throw` inside is `EK0401`, VIP-4, amended 2026-10-31) | `Effect.catch(x, (e) => Effect.succeed(f(e)))` |",
			Reading: "The evaluated operand may be a held Effect or a property. Effect.catch runs it once, and the plain handler's value becomes the success only on failure. Events distinguish construction, execution and following statements.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			held, box, value := g.Name("held"), g.Name("box"), g.Name("value")
			run, fallback, after := g.Label(), g.Label(), g.Label()
			n := g.Intn(31) + 1
			init := fmt.Sprintf("Effect.sync(() => { ev(%q); return %d })", run, n)
			if g.Intn(2) != 0 {
				init = fmt.Sprintf("Effect.fail(%d)", n)
			}
			operand, reference := held, held
			switch g.Intn(6) {
			case 1:
				operand = "(" + held + " as Effect.Effect<number, number>)"
			case 2:
				operand = "(" + held + " satisfies Effect.Effect<number, number>)"
			case 3:
				operand = "(true ? " + held + " : Effect.succeed(0))"
				reference = operand
			case 4:
				operand = box + ".held"
				reference = operand
			case 5:
				operand = box + "[\"held\"]"
				reference = operand
			}
			setup := fmt.Sprintf("const %s: Effect.Effect<number, number> = %s; const %s = { held: %s };", held, init, box, held)
			refSetup := fmt.Sprintf("const %s = %s; const %s = { held: %s };", held, init, box, held)
			vibe := fmt.Sprintf("%s const %s = %s catch () => { ev(%q); return 99 }; ev(%q); return %s", setup, value, operand, fallback, after, value)
			ref := fmt.Sprintf("%s const %s = yield* Effect.catch(%s, () => Effect.succeed((ev(%q), 99))); ev(%q); return %s", refSetup, value, reference, fallback, after, value)
			return []Stmt{&catchEdge{vibe: vibe, ref: ref}}
		},
	})
}
