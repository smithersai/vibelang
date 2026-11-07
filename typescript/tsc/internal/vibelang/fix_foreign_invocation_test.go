package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestForeignInvocationDefectBridgeScopes(t *testing.T) {
	const helper = `
export class Box { constructor(readonly value: number) {} }
export class UnknownBox {
/** @throws {unknown} */
constructor(readonly value: number) {}
}
export class NeverBox {
/** @throws {never} */
constructor(readonly value: number) {}
}
export class Failure extends Error {}
export class NamedBox {
/** @throws {Failure} */
constructor(readonly value: number) {}
}
export function tag(parts: TemplateStringsArray, value?: number): number { return value ?? 0 }
/** @throws {never} */
export function safeTag(parts: TemplateStringsArray, value?: number): number { return value ?? 0 }
/** @throws {Failure} */
export function namedTag(parts: TemplateStringsArray, value?: number): number { return value ?? 0 }
`
	for _, tc := range []struct {
		name, body string
		want       bool
	}{
		{"constructor", "return new Box(value).value", true},
		{"unknown constructor", "return new UnknownBox(value).value", true},
		{"tag", "return tag`raw${value}`", true},
		{"tag without substitutions", "return tag`raw`", true},
		{"suspending constructor", "return new Box(try succeed(value)).value", false},
		{"suspending tag", "return tag`raw${try succeed(value)}`", false},
		{"narrowed constructor operand", "if (box.value !== undefined) return new Box(box.value).value; return 0", false},
		{"narrowed tag operand", "if (box.value !== undefined) return tag`raw${box.value}`; return 0", false},
		{"eval constructor operand", "return new Box(eval('value')).value", false},
		{"eval tag operand", "return tag`raw${eval('value')}`", false},
		{"named constructor failure", "return new NamedBox(value).value", false},
		{"named tag failure", "return namedTag`raw${value}`", false},
		{"nonthrowing constructor", "return new NeverBox(value).value", false},
		{"nonthrowing tag", "return safeTag`raw${value}`", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := neverFixFiles(helper, "helper.ts")
			files[neverFixRoot+"main.vibe"] = "import { Box, UnknownBox, NeverBox, NamedBox, Failure, tag, safeTag, namedTag } from './helper.js'\nexport effect function main(value: number, box: { value?: number }) { " + tc.body + " }\n"
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile(neverFixRoot + "main.vibe")
			checker, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			seen := 0
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsNewExpression(node) || ast.IsTaggedTemplateExpression(node) {
					seen++
					if strings.Contains(tc.name, "constructor") {
						switch tc.name {
						case "unknown constructor", "named constructor failure", "nonthrowing constructor":
							bound, written := foreignThrowsContract(checker, node)
							if !written {
								t.Fatal("constructor fixture has no attached throws contract")
							}
							if tc.name == "nonthrowing constructor" && bound != "" {
								t.Fatalf("never fixture has bound %q", bound)
							}
							if tc.name == "named constructor failure" && !strings.Contains(bound, "Failure") {
								t.Fatalf("named fixture has bound %q", bound)
							}
						}
					}
					plan := planForeignCall(checker, file, node)
					if (plan != nil) != tc.want {
						t.Fatalf("bridge offered=%v, want %v", plan != nil, tc.want)
					}
					if plan != nil {
						got := applyEdits(file.Text(), plan.edits)
						if !strings.Contains(got, "try Effect.orDie(Effect.try({ try: () => "+nodeText(file, node)) ||
							!strings.Contains(got, "catch: (e) => e") {
							t.Fatalf("invocation was not retained in the native defect bridge:\n%s", got)
						}
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if seen != 1 {
				t.Fatalf("saw %d constructor/tag sites, want 1", seen)
			}
		})
	}
}

func TestForeignInvocationDefectBridgeParametersAndPlainBodies(t *testing.T) {
	const helper = "export class Box { constructor(readonly value: number) {} }"
	for _, source := range []string{
		"export effect function main(value = new Box(1)) { return value.value }",
		"export function main(value: number): number { return new Box(value).value }",
	} {
		files := neverFixFiles(helper, "helper.ts")
		files[neverFixRoot+"main.vibe"] = "import { Box } from './helper.js'\n" + source
		program := computedKeyProgram(t, files)
		file := program.GetSourceFile(neverFixRoot + "main.vibe")
		checker, done := program.GetTypeCheckerForFile(t.Context(), file)
		seen := false
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsNewExpression(node) {
				seen = true
				if planForeignCall(checker, file, node) != nil {
					t.Fatal("a defect bridge cannot move parameter or plain-body execution into an Effect")
				}
			}
			return node.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		done()
		if !seen {
			t.Fatal("missing constructor site")
		}
	}
}

func TestGeneratorConstructorDefectBridgeRefusesDirectEval(t *testing.T) {
	files := neverFixFiles("export class Box { constructor(readonly value: number) {} }", "helper.ts")
	files[neverFixRoot+"main.vibe"] = "import { Box } from './helper.js'\nexport const main = (value: number) => Effect.gen(function* () { return new Box(eval('value')).value })"
	program := computedKeyProgram(t, files)
	file := program.GetSourceFile(neverFixRoot + "main.vibe")
	checker, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	seen := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isGeneratorExpression(node) {
			seen = true
			scan := scanEffectGenBody(checker, analyzerFor(checker), file, node)
			if !strings.Contains(scan.why, "direct eval") {
				t.Fatalf("a constructor bridge must preserve eval's function scope; refusal=%q", scan.why)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if !seen {
		t.Fatal("missing generator site")
	}
}

func TestForeignInvocationDirectEvalCalleeGrouping(t *testing.T) {
	for _, test := range []struct {
		operand string
		want    bool
	}{
		{"eval('value')", true},
		{"(eval)('value')", true},
		{"((eval))('value')", true},
		{"(0, eval)('value')", false},
		{"globalThis.eval('value')", false},
		{"(() => eval('value'))", false},
	} {
		t.Run(test.operand, func(t *testing.T) {
			files := neverFixFiles("export class Box { constructor(readonly value: unknown) {} }", "helper.ts")
			files[neverFixRoot+"main.vibe"] = "import { Box } from './helper.js'\nexport const main = (value: number) => new Box(" + test.operand + ")"
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile(neverFixRoot + "main.vibe")
			seen := false
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsNewExpression(node) {
					seen = true
					if got := foreignInvocationHasDirectEval(node); got != test.want {
						t.Fatalf("direct eval detection = %t; want %t", got, test.want)
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !seen {
				t.Fatal("missing constructor site")
			}
		})
	}
}
