package vipgen

import (
	"fmt"
	"strings"
)

func init() {
	for _, mode := range []string{"number", "undefined", "promise", "array", "return-generator", "yield-generator", "effect", "iterator-throw", "next-throw", "bad-result", "typed-number", "typed-undefined", "typed-promise"} {
		Register(&Construct{
			Key: "vip05.tail-native-delegation-" + mode, VIP: 5,
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Citations: []Citation{{VIP: 5, Template: "return ‹prefix› yield* ‹operand›",
				Quote:   "After the static Effect-assignability check, `try e` is still `yield* e`, with no dynamic Effect guard, Promise conversion or non-Promise identity.",
				Reading: "Preserve native iterator acquisition, next/result getters and defects even in a tail result. A valid typed Effect can have an observable iterator getter too; suspend is not delegated yield.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				g.AddFile("tail-delegation.ts", tailDelegationModule, "makeValue", "inspectExit")
				name, value := g.Name("tail"), g.Name("operand")
				parameter, parameterName := "any", "value"
				if mode == "effect" || strings.HasPrefix(mode, "typed-") {
					parameter = "Effect.Effect<number>"
				}
				operand, refOperand := "try value", "yield* value"
				tail := g.Intn(5)
				callArgs := value + ".value"
				switch tail {
				case 1:
					operand, refOperand = "true ? try value : 0", "true ? (yield* value) : 0"
				case 2:
					operand, refOperand = "(ev(\"tail\"), try value)", "(ev(\"tail\"), yield* value)"
				case 3:
					operand, refOperand = "try (value)", "yield* (value)"
				case 4:
					parameter, parameterName = "() => "+parameter, "make"
					operand, refOperand = "try make()", "yield* make()"
					callArgs = "() => " + value + ".value"
				}
				body, refBody := "return "+operand, "return "+refOperand
				declaration := fmt.Sprintf("effect function %s(%s: %s) { %s }", name, parameterName, parameter, body)
				reference := fmt.Sprintf("function %s(%s) { return Effect.gen(function* () { %s }) }", name, parameterName, refBody)
				call := name
				form := g.Intn(6)
				switch form {
				case 1:
					declaration = fmt.Sprintf("const %s = effect (%s: %s) => %s", name, parameterName, parameter, operand)
					reference = fmt.Sprintf("const %s = (%s) => Effect.gen(function* () { %s })", name, parameterName, refBody)
				case 2:
					declaration = fmt.Sprintf("const %s = effect function (%s: %s) { %s }", name, parameterName, parameter, body)
					reference = fmt.Sprintf("const %s = function (%s) { return Effect.gen(function* () { %s }) }", name, parameterName, refBody)
				case 3:
					declaration = fmt.Sprintf("const %s = { effect run(%s: %s) { %s } }", name, parameterName, parameter, body)
					reference = fmt.Sprintf("const %s = { run(%s) { return Effect.gen(function* () { %s }) } }", name, parameterName, refBody)
					call += ".run"
				case 4, 5:
					captured, refCaptured := strings.ReplaceAll(operand, "value", value+".value"), strings.ReplaceAll(refOperand, "value", value+".value")
					prefix := ""
					if tail == 4 {
						factory := g.Name("make")
						prefix = fmt.Sprintf("const %s = () => %s.value;\n", factory, value)
						captured, refCaptured = "try "+factory+"()", "yield* "+factory+"()"
					}
					declaration = prefix + fmt.Sprintf("const %s = effect () => %s", name, captured)
					reference = prefix + fmt.Sprintf("const %s = () => Effect.gen(function* () { return %s })", name, refCaptured)
					if form == 5 {
						declaration = prefix + fmt.Sprintf("const %s = effect function inner() { return %s }", name, captured)
						reference = prefix + fmt.Sprintf("const %s = function inner() { return Effect.gen(function* () { return %s }) }", name, refCaptured)
					}
					callArgs = ""
				}
				metadata := fmt.Sprintf("ev(%s.name); ev(\"prototype\" in %s ? \"constructable\" : \"arrow\"); ev(\"arity:\" + %s.length);", call, call, call)
				setup := fmt.Sprintf("const %s = makeValue(%q, (s: string) => ev(s));", value, strings.TrimPrefix(mode, "typed-"))
				return []Stmt{&catchEdge{
					vibe: strings.Join([]string{declaration, metadata, setup, "return inspectExit(try Effect.exit(" + call + "(" + callArgs + ")), " + value + ".sentinel)"}, "\n"),
					ref:  strings.Join([]string{reference, metadata, strings.ReplaceAll(setup, ": string", ""), "return inspectExit(yield* Effect.exit(" + call + "(" + callArgs + ")), " + value + ".sentinel)"}, "\n"),
				}}
			},
		})
	}
}

const tailDelegationModule = "import { Effect } from \"effect\"\nexport const modes = [\"number\",\"undefined\",\"promise\",\"array\",\"return-generator\",\"yield-generator\",\"effect\",\"iterator-throw\",\"next-throw\",\"bad-result\"] as const\n/** @throws {never} */\nexport function makeValue(mode: typeof modes[number], record: (s: string) => void): { value: any; sentinel: Error } {\n  const sentinel = new Error(\"iterator sentinel\")\n  switch (mode) {\n    case \"number\": return { value: 5, sentinel }\n    case \"undefined\": return { value: undefined, sentinel }\n    case \"promise\": return { value: Promise.resolve(5), sentinel }\n    case \"array\": return { value: [], sentinel }\n    case \"return-generator\": return { value: (function* () { return 7 })(), sentinel }\n    case \"yield-generator\": return { value: (function* () { return yield* Effect.succeed(8) })(), sentinel }\n    case \"effect\": {\n      const value = Effect.succeed(7)\n      const base = value[Symbol.iterator].bind(value)\n      Object.defineProperty(value, Symbol.iterator, { get() { record(\"iterator\"); return base } })\n      return { value, sentinel }\n    }\n    case \"iterator-throw\": return { value: { get [Symbol.iterator]() { record(\"iterator\"); throw sentinel } }, sentinel }\n    case \"next-throw\": return { value: { [Symbol.iterator]() { record(\"iterator\"); return { get next() { record(\"next\"); throw sentinel } } } }, sentinel }\n    case \"bad-result\": return { value: { [Symbol.iterator]() { record(\"iterator\"); return { next() { record(\"next\"); return 3 } } } }, sentinel }\n  }\n  throw new Error(\"bad mode\")\n}\n\n// Canonical native iterator errors retain name and message.\n// Inspect the VIP-observable Exit tag, reason, defect class, message and identity;\n// events remain independently compared by the shared differential runner.\n/** @throws {never} */\nexport function inspectExit(exit: any, sentinel: unknown) {\n  return exit._tag === \"Success\" ? { tag: \"Success\", value: exit.value }\n    : { tag: \"Failure\", reasons: exit.cause.reasons.map((r: any) => r._tag === \"Die\"\n      ? { tag: \"Die\", name: r.defect?.constructor?.name, message: r.defect?.message, sentinel: r.defect === sentinel }\n      : { tag: r._tag }) }\n}\n"
