package vipgen

import "strings"

func init() {
	Register(&Construct{
		Key: "vip05.unchecked-try", VIP: 5,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{VIP: 5, Template: "yield* ‹e›",
			Quote:   "An unchecked noniterable produces its native `TypeError` as a defect.",
			Reading: "An any operand retains native yield-star iteration in tail positions, including its iterator errors and ordinary iterator completions. Compare normalized Exit values through the shared differential oracle."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			name := g.Name("unchecked")
			// Cover direct, conditional and comma result positions, plus the
			// function forms that share the return-try optimization.
			forms := []string{
				"effect function NAME(value: any) { return try value }",
				"effect function NAME(value: any) { return true ? try value : 0 }",
				"effect function NAME(value: any) { return (void 0, try value) }",
				"const NAME = effect (value: any) => try value",
				"effect function NAME(value: any) { return try (() => value)() }",
				"const NAME = { effect run(value: any) { return try value } }.run",
				"function NAME(value: any) { return effect { return try value } }",
			}
			vibe := strings.ReplaceAll(forms[g.Intn(len(forms))], "NAME", name)
			ref := "function " + name + "(value) { return Effect.gen(function* () { return yield* value }) }"
			g.AddDecl(&Code{V: vibe, E: ref})
			operands := []string{"5", "undefined", "Promise.resolve(5)", "[]", "(function* () { return 7 })()", "Effect.succeed(8)", "(function* () { return yield* Effect.succeed(9) })()", "[Effect.succeed(10)]", "({ [Symbol.iterator]: 1 })"}
			operand := operands[g.Intn(len(operands))]
			// Error messages include generated identifier names, so observe
			// native TypeError identity instead of comparing message text.
			tail := "(" + name + "(" + operand + ")); return result._tag === \"Success\" ? [\"Success\", result.value] : [\"Failure\", result.cause.reasons.map(r => r._tag === \"Die\" ? [\"Die\", r.defect instanceof TypeError] : [r._tag])];"
			return []Stmt{&catchEdge{vibe: "const result = try Effect.exit" + tail, ref: "const result = yield* Effect.exit" + tail}}
		},
	})
}
