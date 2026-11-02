package vipgen

import (
	"fmt"
	"strings"
)

func init() {
	for _, mode := range []string{"number", "undefined", "promise", "array", "return-generator", "yield-generator", "effect", "iterator-throw", "next-throw", "bad-result"} {
		Register(&Construct{
			Key: "vip05.tail-native-delegation-" + mode, VIP: 5,
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Citations: []Citation{{VIP: 5, Template: "yield* ‹e›",
				Quote:   "After the static Effect-assignability check, `try e` is still `yield* e`, with no dynamic Effect guard, Promise conversion or non-Promise identity.",
				Reading: "Preserve native iterator acquisition, next/result getters and defects even in a tail result. A valid typed Effect can have an observable iterator getter too; suspend is not delegated yield.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				g.AddFile("tail-delegation.ts", tailDelegationModule, "makeValue", "inspectExit")
				name := g.Name("tail")
				parameter := "any"
				if mode == "effect" {
					parameter = "Effect.Effect<number>"
				}
				operand, refOperand := "try value", "yield* value"
				switch g.Intn(4) {
				case 1:
					operand, refOperand = "true ? try value : 0", "true ? (yield* value) : 0"
				case 2:
					operand, refOperand = "(ev(\"tail\"), try value)", "(ev(\"tail\"), yield* value)"
				case 3:
					operand, refOperand = "try (value)", "yield* (value)"
				}
				body := fmt.Sprintf("return %s", operand)
				refBody := fmt.Sprintf("return %s", refOperand)
				declaration := fmt.Sprintf("effect function %s(value: %s) { %s }", name, parameter, body)
				reference := fmt.Sprintf("function %s(value) { return Effect.gen(function* () { %s }) }", name, refBody)
				call := name
				switch g.Intn(4) {
				case 1:
					declaration = fmt.Sprintf("const %s = effect (value: %s) => %s", name, parameter, operand)
					reference = fmt.Sprintf("const %s = (value) => Effect.gen(function* () { %s })", name, refBody)
				case 2:
					declaration = fmt.Sprintf("const %s = effect function (value: %s) { %s }", name, parameter, body)
					reference = fmt.Sprintf("const %s = function (value) { return Effect.gen(function* () { %s }) }", name, refBody)
				case 3:
					declaration = fmt.Sprintf("const %s = { effect run(value: %s) { %s } }", name, parameter, body)
					reference = fmt.Sprintf("const %s = { run(value) { return Effect.gen(function* () { %s }) } }", name, refBody)
					call += ".run"
				}
				metadata := fmt.Sprintf("ev(%s.name); ev(\"prototype\" in %s ? \"constructable\" : \"arrow\");", call, call)
				value := g.Name("operand")
				setup := fmt.Sprintf("const %s = makeValue(%q, (s: string) => ev(s));", value, mode)
				return []Stmt{&catchEdge{
					vibe: strings.Join([]string{declaration, metadata, setup, "return inspectExit(try Effect.exit(" + call + "(" + value + ".value)), " + value + ".sentinel)"}, "\n"),
					ref:  strings.Join([]string{reference, metadata, strings.ReplaceAll(setup, ": string", ""), "return inspectExit(yield* Effect.exit(" + call + "(" + value + ".value)), " + value + ".sentinel)"}, "\n"),
				}}
			},
		})
	}
}

const tailDelegationModule = "import { Effect } from \"effect\"\nexport const modes = [\"number\",\"undefined\",\"promise\",\"array\",\"return-generator\",\"yield-generator\",\"effect\",\"iterator-throw\",\"next-throw\",\"bad-result\"] as const\n/** @throws {never} */\nexport function makeValue(mode: typeof modes[number], record: (s: string) => void): { value: any; sentinel: Error } {\n  const sentinel = new Error(\"iterator sentinel\")\n  switch (mode) {\n    case \"number\": return { value: 5, sentinel }\n    case \"undefined\": return { value: undefined, sentinel }\n    case \"promise\": return { value: Promise.resolve(5), sentinel }\n    case \"array\": return { value: [], sentinel }\n    case \"return-generator\": return { value: (function* () { return 7 })(), sentinel }\n    case \"yield-generator\": return { value: (function* () { return yield* Effect.succeed(8) })(), sentinel }\n    case \"effect\": {\n      const value = Effect.succeed(7)\n      const base = value[Symbol.iterator].bind(value)\n      Object.defineProperty(value, Symbol.iterator, { get() { record(\"iterator\"); return base } })\n      return { value, sentinel }\n    }\n    case \"iterator-throw\": return { value: { get [Symbol.iterator]() { record(\"iterator\"); throw sentinel } }, sentinel }\n    case \"next-throw\": return { value: { [Symbol.iterator]() { record(\"iterator\"); return { get next() { record(\"next\"); throw sentinel } } } }, sentinel }\n    case \"bad-result\": return { value: { [Symbol.iterator]() { record(\"iterator\"); return { next() { record(\"next\"); return 3 } } } }, sentinel }\n  }\n  throw new Error(\"bad mode\")\n}\n\n// Native iterator error wording is engine/source-expression dependent.\n// Inspect the VIP-observable Exit tag, reason, defect class and identity;\n// events remain independently compared by the shared differential runner.\n/** @throws {never} */\nexport function inspectExit(exit: any, sentinel: unknown) {\n  return exit._tag === \"Success\" ? { tag: \"Success\", value: exit.value }\n    : { tag: \"Failure\", reasons: exit.cause.reasons.map((r: any) => r._tag === \"Die\"\n      ? { tag: \"Die\", name: r.defect?.constructor?.name, sentinel: r.defect === sentinel }\n      : { tag: r._tag }) }\n}\n"
