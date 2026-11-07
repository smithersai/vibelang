package vipgen

import "fmt"

func init() {
	Register(&Construct{
		Key: "vip05.catch-factory-result", VIP: 5,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP: 5, Template: "yield* Effect.catch(‹head›, () => Effect.succeed(‹factory()›))",
			Quote:   "Its syntax decides its kind: `x catch (e) => v` (also function expressions) is plain, and its result is the fallback value; `x catch effect (e) => …` runs an Effect and may fail again.",
			Reading: "Calling a factory constructs its result during handling. A plain handler returns that Effect as data, so its body runs only at the following written try. Handler syntax, rather than its result type, decides whether it runs Effects.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			name, value := g.Name("factory"), g.Name("program")
			run, created, after := g.Label(), g.Label(), g.Label()
			n := g.Intn(31) + 1
			call := fmt.Sprintf("Effect.sync(() => { ev(%q); return %d })", run, n)
			prefix, refPrefix := "", ""
			switch g.Intn(3) {
			case 1:
				prefix = fmt.Sprintf("const %s = () => { ev(%q); return %s };", name, created, call)
				refPrefix = prefix
				call = name + "()"
			case 2:
				prefix = fmt.Sprintf("effect function %s() { ev(%q); return %d }", name, run, n)
				refPrefix = fmt.Sprintf("function %s() { return Effect.gen(function* () { ev(%q); return %d }) }", name, run, n)
				call = name + "()"
			}
			handler := "() => " + call
			switch g.Intn(4) {
			case 1:
				handler = "() => { return " + call + " }"
			case 2:
				handler = "function (error: string) { return " + call + " }"
			case 3:
				handler = "((error: string) => " + call + ")"
			}
			vibe := fmt.Sprintf("%s const %s = Effect.fail(\"bad\") catch %s; ev(%q); return try %s", prefix, value, handler, after, value)
			ref := fmt.Sprintf("%s const %s = yield* Effect.catch(Effect.fail(\"bad\"), () => Effect.succeed(%s)); ev(%q); return yield* %s", refPrefix, value, call, after, value)
			return []Stmt{&catchEdge{vibe: vibe, ref: ref}}
		},
	})
}
