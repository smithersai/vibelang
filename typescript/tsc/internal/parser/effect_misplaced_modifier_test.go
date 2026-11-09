package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func parseMisplaced(source string) *ast.SourceFile {
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
}

func misplacedCodes(file *ast.SourceFile) []string {
	var codes []string
	for _, d := range file.Diagnostics() {
		source := d.Source()
		if source == "" {
			source = "TS"
		}
		codes = append(codes, fmt.Sprintf("%s%d", source, d.Code()))
	}
	return codes
}

func misplacedEffectCallables(file *ast.SourceFile) int {
	count := 0
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Flags&ast.NodeFlagsVibeLangEffect != 0 && (n.Kind == ast.KindMethodDeclaration || n.Kind == ast.KindFunctionDeclaration) {
			count++
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return count
}

// VIP-1, modifier placement: "A recognized `effect` modifier follows the
// valid and diagnostic recovery positions of TypeScript's `async`." Each row
// is the single diagnostic TypeScript gives the async twin, naming effect.
func TestMisplacedEffectModifier(t *testing.T) {
	for _, test := range []struct {
		source, code, at, message string
		effect                    int
	}{
		{"class C { effect static load() { return 1 } }", "TS1029", "static", "'static' modifier must precede 'effect' modifier.", 1},
		{"class C { effect public load() { return 1 } }", "TS1029", "public", "'public' modifier must precede 'effect' modifier.", 1},
		{"class C { effect private load() { return 1 } }", "TS1029", "private", "'private' modifier must precede 'effect' modifier.", 1},
		{"class C { effect protected load() { return 1 } }", "TS1029", "protected", "'protected' modifier must precede 'effect' modifier.", 1},
		{"class C { effect override load() { return 1 } }", "TS1029", "override", "'override' modifier must precede 'effect' modifier.", 1},
		{"class C { effect static *items() { yield 1 } }", "TS1029", "static", "'static' modifier must precede 'effect' modifier.", 1},
		{"class C { effect static [key]<T>(x: T) { return x } }", "TS1029", "static", "'static' modifier must precede 'effect' modifier.", 1},
		{"class C { effect private static load() { return 1 } }", "TS1029", "private", "'private' modifier must precede 'effect' modifier.", 1},
		{"class C { @dec effect static load() { return 1 } }", "TS1029", "static", "'static' modifier must precede 'effect' modifier.", 1},
		{"class C { effect static size = 1 }", "TS1029", "static", "'static' modifier must precede 'effect' modifier.", 0},
		{"class C { effect static get size() { return 1 } }", "TS1029", "static", "'static' modifier must precede 'effect' modifier.", 0},
		{"class C { effect effect load() { return 1 } }", "TS1030", "effect load", "'effect' modifier already seen.", 1},
		{"class C { static effect effect load() { return 1 } }", "TS1030", "effect load", "'effect' modifier already seen.", 1},
		{"class C { effect size = 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect size: number = 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect size }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect 'size' = 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect #size = 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect [key] = 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { static effect size = 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect readonly size = 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect declare size: number }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"class C { effect [key: string]: number }", "TS1071", "effect", "'effect' modifier cannot appear on an index signature.", 0},
		{"class C { effect static { } }", "TS1184", "effect", "Modifiers cannot appear here.", 0},
		{"class C { effect readonly get size() { return 1 } }", "EK104", "effect", "", 0},
		{"effect export function load() { return 1 }", "TS1029", "export", "'export' modifier must precede 'effect' modifier.", 1},
		{"effect export default function load() { return 1 }", "TS1029", "export", "'export' modifier must precede 'effect' modifier.", 1},
		{"effect export function* items() { yield 1 }", "TS1029", "export", "'export' modifier must precede 'effect' modifier.", 1},
		{"effect effect function load() { return 1 }", "TS1030", "effect function", "'effect' modifier already seen.", 1},
		{"effect class C { }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect abstract class C { }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect const x = 1", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect let x = 1", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect interface I { }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect type T = 1", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect enum E { a }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect namespace N { }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect declare const x: number", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"export effect const x = 1", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"export effect class C { }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"effect export const x = 1", "TS1029", "export", "'export' modifier must precede 'effect' modifier.", 0},
		{"export const o = { effect size: 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"const size = 1; export const o = { effect size }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"export const o = { effect 'size': 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"export const o = { effect [key]: 1 }", "TS1042", "effect", "'effect' modifier cannot be used here.", 0},
		{"export const o = { effect effect load() { return 1 } }", "TS1030", "effect load", "'effect' modifier already seen.", 1},
		{"export const o = { effect get size() { return 1 } }", "EK104", "effect", "", 0},
		{"export function f(effect x: number) { return x }", "TS1090", "effect", "'effect' modifier cannot appear on a parameter.", 0},
		{"export function f(effect ...xs: number[]) { return xs }", "TS1090", "effect", "'effect' modifier cannot appear on a parameter.", 0},
		{"export function f(effect { x }: { x: number }) { return x }", "TS1090", "effect", "'effect' modifier cannot appear on a parameter.", 0},
		{"export class C { m(effect x: number) { return x } }", "TS1090", "effect", "'effect' modifier cannot appear on a parameter.", 0},
		{"export class C { effect m(effect x: number) { return x } }", "TS1090", "effect x", "'effect' modifier cannot appear on a parameter.", 1},
	} {
		t.Run(test.source, func(t *testing.T) {
			file := parseMisplaced(test.source)
			ds := file.Diagnostics()
			if len(ds) != 1 || misplacedCodes(file)[0] != test.code {
				t.Fatalf("want exactly %s, got %v: %v", test.code, misplacedCodes(file), ds)
			}
			if ds[0].Pos() != strings.Index(test.source, test.at) {
				t.Errorf("want the diagnostic at %q (%d), got %d", test.at, strings.Index(test.source, test.at), ds[0].Pos())
			}
			if test.message != "" && ds[0].String() != test.message {
				t.Errorf("want %q, got %q", test.message, ds[0].String())
			}
			if got := misplacedEffectCallables(file); got != test.effect {
				t.Errorf("want %d Effect callables, got %d", test.effect, got)
			}
		})
	}
}

// The checker rejects these modifiers on an Effect function or method
// wherever they stand, so the parser recovers the reordered declaration, an
// Effect callable, and adds nothing.
func TestMisplacedEffectModifierLeftToChecker(t *testing.T) {
	for _, source := range []string{
		"abstract class C { effect abstract load(): number!! }",
		"class C { effect readonly load() { return 1 } }",
		"class C { effect accessor load() { return 1 } }",
		"class C { effect declare load() { return 1 } }",
		"effect declare function load(): number!!",
		"effect abstract function load() { return 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseMisplaced(source)
			if codes := misplacedCodes(file); len(codes) != 0 {
				t.Fatalf("want no parser diagnostic, got %v", codes)
			}
			if got := misplacedEffectCallables(file); got != 1 {
				t.Errorf("want one Effect callable, got %d", got)
			}
		})
	}
}

// effect stays an identifier, and every admitted Effect form its form, where
// TypeScript would not read async as a misplaced modifier.
func TestMisplacedEffectModifierControls(t *testing.T) {
	for _, test := range []struct {
		source string
		effect int
	}{
		{"class C { effect\n static load() { return 1 } }", 0},
		{"class C { effect; size = 1 }", 0},
		{"class C { effect = 1 }", 0},
		{"class C { effect: number = 1 }", 0},
		{"class C { effect?: number }", 0},
		{"class C { effect!: number }", 0},
		{"class C { effect() { return 1 } }", 0},
		{"class C { effect<T>(x: T) { return x } }", 0},
		{"class C { effect static() { return 1 } }", 1},
		{"class C { effect public() { return 1 } }", 1},
		{"class C { effect readonly<T>(x: T) { return x } }", 1},
		{"class C { effect effect() { return 1 } }", 1},
		{"class C { static effect load() { return 1 } }", 1},
		{"class C { static effect *items() { yield 1 } }", 1},
		{"class C { private static effect #load() { return 1 } }", 1},
		{"class C { effect get() { return 1 } }", 1},
		{"class C { effect constructor<T>() { } }", 0},
		{"const effect = 1\nclass C { }", 0},
		{"declare const effect: number\neffect\nclass C { }", 0},
		{"declare const effect: number\neffect\nexport function f() { return 1 }", 0},
		{"declare const effect: number\neffect\nconst x = 1", 0},
		{"effect function load() { return 1 }", 1},
		{"export effect function load() { return 1 }", 1},
		{"export default effect function () { return 1 }", 1},
		{"declare const effect: { type: number }\nconst x = effect.type", 0},
		{"const effect = 1, y = effect as number", 0},
		{"const effect = 1; export const o = { effect }", 0},
		{"const effect = 1; export const o = { effect, size: 2 }", 0},
		{"export const o = { effect: 1 }", 0},
		{"export const o = { effect() { return 1 } }", 0},
		{"export const o = { effect static() { return 1 } }", 1},
		{"export const o = { effect\n size: 1 }", 0},
		{"export function f(effect: number) { return effect }", 0},
		{"export function f(effect?: number, x = 1) { return [effect, x] }", 0},
		{"export function f(effect = 1) { return effect }", 0},
		{"export const g = (effect: number) => effect", 0},
		{"export type F = (effect: number) => number", 0},
	} {
		t.Run(test.source, func(t *testing.T) {
			file := parseMisplaced(test.source)
			for _, code := range misplacedCodes(file) {
				if code == "TS1029" || code == "TS1030" || code == "TS1042" || code == "TS1071" || code == "TS1184" {
					t.Fatalf("a form that is not a misplaced modifier got %s", code)
				}
			}
			if got := misplacedEffectCallables(file); got != test.effect {
				t.Errorf("want %d Effect callables, got %d", test.effect, got)
			}
		})
	}
}

func TestEffectDeclaredClassMemberContext(t *testing.T) {
	for _, source := range []string{
		"class C { declare effect read(): number!! }",
		"class C { effect declare read(): number!! }",
		"class C { public declare effect read(): number!! }",
		"class C { static declare effect read(): number!! }",
		"class C { declare effect [key](): number!! }",
		"class C { declare effect read<T>(x: T): T!! }",
		"declare class C { effect read(): number!! }",
		"declare namespace API { class C { effect read(): number!! } }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseMisplaced(source)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("unexpected parser diagnostics: %v", misplacedCodes(file))
			}
			count := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if n.Kind == ast.KindMethodDeclaration && n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
					count++
					if n.Flags&ast.NodeFlagsAmbient == 0 {
						t.Error("declared Effect method lost its ambient context")
					}
					for _, modifier := range n.ModifierNodes() {
						if modifier.Flags&ast.NodeFlagsAmbient == 0 {
							t.Error("declared Effect method modifier lost its ambient context")
						}
					}
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if count != 1 {
				t.Fatalf("want one Effect method, got %d", count)
			}
		})
	}
}
