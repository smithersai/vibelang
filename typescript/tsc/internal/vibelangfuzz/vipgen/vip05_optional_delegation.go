package vipgen

import (
	"fmt"
	"strings"
)

// Native optional chaining selects an operand. It does not turn an absent
// operand into Effect.succeed(undefined) before delegated yield.
func init() {
	for _, mode := range []string{"absent-undefined", "absent-null", "effect", "effect-undefined", "undefined-result", "null-result", "number-result", "array-result", "throw-result"} {
		Register(&Construct{
			Key: "vip05.optional-native-delegation-" + mode, VIP: 5,
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Citations: []Citation{{VIP: 5, Template: "yield* ‹e›",
				Quote:   "After the static Effect-assignability check, `try e` is still `yield* e`, with no dynamic Effect guard, Promise conversion or non-Promise identity.",
				Reading: "An unchecked optional call preserves native receiver/key/argument evaluation and delegates its result, including undefined on an absent branch. Observe the native defect class and events rather than engine-dependent error text.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				g.AddFile("tail-delegation.ts", tailDelegationModule, "inspectExit")
				g.AddFile("optional-delegation.ts", optionalDelegationModule, "makeOptional")
				name, value := g.Name("optional"), g.Name("operand")
				argument, refArgument := "(ev(\"argument\"), 1)", "(ev(\"argument\"), 1)"
				switch g.Intn(3) {
				case 1:
					argument, refArgument = "try Effect.sync(() => { ev(\"argument\"); return 1 })", "yield* Effect.sync(() => { ev(\"argument\"); return 1 })"
				case 2:
					argument, refArgument = "do { ev(\"argument\"); 1 }", "(() => { ev(\"argument\"); return 1 })()"
				}
				// Type-only assertions leave each native optional chain intact.
				// The fixture may still supply an absent callable or an invalid
				// runtime result after the static Effect-factory check.
				forms := [][2]string{
					{"(input.callable!)?.(%s)", "input.callable?.(%s)"},
					{"(input.object!)?.run(%s)", "input.object?.run(%s)"},
					{"(input.method.run!)?.(%s)", "input.method.run?.(%s)"},
					{"(input.object!)?.run?.(%s)", "input.object?.run?.(%s)"},
					{"(input.method[(ev(\"key\"), \"run\")]!)?.(%s)", "input.method[(ev(\"key\"), \"run\")]?.(%s)"},
				}
				form := forms[g.Intn(len(forms))]
				operand, refOperand := "try "+fmt.Sprintf(form[0], argument), "yield* "+fmt.Sprintf(form[1], refArgument)
				body, refBody := "return "+operand, "return "+refOperand
				switch g.Intn(4) {
				case 1:
					body, refBody = "const result = "+operand+"; ev(\"after\"); return result", "const result = "+refOperand+"; ev(\"after\"); return result"
				case 2:
					body, refBody = "return true ? "+operand+" : 0", "return true ? ("+refOperand+") : 0"
				case 3:
					body, refBody = "return try ("+fmt.Sprintf(form[0], argument)+")", "return yield* ("+fmt.Sprintf(form[1], refArgument)+")"
				}
				inputType := "{ callable?: ((n: number) => Effect.Effect<unknown>) | null; object?: { run(n: number): Effect.Effect<unknown> } | null; method: { run?: ((n: number) => Effect.Effect<unknown>) | null } }"
				declaration := fmt.Sprintf("effect function %s(input: %s) { %s }", name, inputType, body)
				reference := fmt.Sprintf("function %s(input) { return Effect.gen(function* () { %s }) }", name, refBody)
				if g.Intn(2) != 0 {
					declaration = fmt.Sprintf("const %s = effect (input: %s) => { %s }", name, inputType, body)
					reference = fmt.Sprintf("const %s = (input) => Effect.gen(function* () { %s })", name, refBody)
				}
				setup := fmt.Sprintf("const %s = makeOptional(%q, (s: string) => ev(s));", value, mode)
				return []Stmt{&catchEdge{
					vibe: strings.Join([]string{declaration, setup, "return inspectExit(try Effect.exit(" + name + "(" + value + ")), " + value + ".sentinel)"}, "\n"),
					ref:  strings.Join([]string{reference, strings.ReplaceAll(setup, ": string", ""), "return inspectExit(yield* Effect.exit(" + name + "(" + value + ")), " + value + ".sentinel)"}, "\n"),
				}}
			},
		})
	}
}

const optionalDelegationModule = `import { Effect } from "effect"
/** @throws {never} */
export function makeOptional(mode: string, record: (s: string) => void): any {
 const sentinel = new Error("optional sentinel")
 const absent = mode === "absent-null" ? null : undefined
 const present = !mode.startsWith("absent-")
 const callable = function(this: any, n: number) {
  record("call:" + (this?.tag ?? "none") + ":" + n)
  switch (mode) {
   case "effect": return Effect.succeed(7)
   case "effect-undefined": return Effect.succeed(undefined)
   case "undefined-result": return undefined
   case "null-result": return null
   case "number-result": return 5
   case "array-result": return []
   case "throw-result": throw sentinel
  }
  throw new Error("absent callable was invoked")
 }
 const receiver = { tag: "receiver", get run() { record("get"); return callable } }
 const method = { tag: "method", get run() { record("get"); return present ? callable : absent } }
 return { callable: present ? callable : absent, object: present ? receiver : absent, method, sentinel }
}
`
