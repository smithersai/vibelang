package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A misplaced effect modifier gets the diagnostic TypeScript gives async in
// the same position. The oracle compiles each form twice, as .ts with async
// and as .vibe with effect, and requires the same errors with the modifier's
// name exchanged. Where TypeScript rejects async on an abstract or ambient
// declaration (TS1243, TS1040), chapter 1 assigns EK0108. Comparing the
// compiler with itself on two inputs is what the quoted rule states.
const effectPlacementTarget = "FuzzEffectModifierPlacement"
const effectPlacementQuote = "A recognized `effect` modifier follows TypeScript’s `async` diagnostic recovery positions too."
const effectPlacementForbiddenQuote = "A recognized `effect` modifier in a TypeScript-forbidden `async` position is `EK0108`: on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member."

func TestEffectModifierPlacementQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", effectPlacementQuote)
	chapterSays(t, "001-functions.md", effectPlacementForbiddenQuote)
}

// Each home holds one declaration; %s is its modifier run, in which M is
// async or effect and R the callable's return type.
var effectPlacementHomes = []struct {
	key, pattern string
	member       bool
}{
	{"method", "export class Home { %s load() {} }", true},
	{"field", "export class Home { %s size = 1 }", true},
	{"function", "%s function load() {}", false},
	{"class", "%s class Home {}", false},
	{"const", "%s const size = 1", false},
	{"interface", "%s interface Shape {}", false},
	{"type", "%s type Size = 1", false},
	{"enum", "%s enum Kind { a }", false},
	{"namespace", "%s namespace Space { export const a = 1 }", false},
	{"object-property", "export const home = { %s size: 1 }", false},
	{"object-method", "export const home = { %s load() {} }", false},
	{"parameter", "export function home(%s size: number) { return size }", false},
}

var effectPlacementOrders = []struct {
	key, run          string
	member, statement bool
}{
	{"alone", "M", true, true},
	{"repeated", "M M", true, true},
	{"before-static", "M static", true, false},
	{"before-public", "M public", true, false},
	{"before-private", "M private", true, false},
	{"before-protected", "M protected", true, false},
	{"after-static", "static M", true, false},
	{"before-export", "M export", false, true},
	{"after-export", "export M", false, true},
}

// Object members take the single-modifier orders; a parameter takes one.
// TypeScript reports each repeated async on an object property separately
// (TS1042 twice), so that order stays out of the comparison.
var effectPlacementOnly = map[string][]string{
	"object-property": {"alone"},
	"object-method":   {"alone", "repeated"},
	"parameter":       {"alone"},
}

// The forms chapter 1 assigns EK0108, with their async twins' TS1243 and
// TS1040.
var effectPlacementForbidden = map[string]string{
	"abstract-method:forbidden":          "export abstract class Home { M abstract load(): R }",
	"declare-function:forbidden":         "M declare function load(): R",
	"declare-method:forbidden":           "export class Home { declare M load(): R }",
	"declare-method-reordered:forbidden": "export class Home { M declare load(): R }",
	"declare-method-public:forbidden":    "export class Home { public declare M load(): R }",
	"declare-method-static:forbidden":    "export class Home { static declare M load(): R }",
	"declare-method-computed:forbidden":  "export class Home { declare M [\"load\"](): R }",
	"declare-method-generic:forbidden":   "export class Home { declare M load<T>(x: T): R }",
	"declare-class-method:forbidden":     "export declare class Home { M load(): R }",
	"declare-namespace-method:forbidden": "declare namespace Home { class C { M load(): R } }",
}

// A type member has no async function return contract. Its native TS1070
// becomes EK0108, while its written return type keeps its TypeScript meaning.
var effectPlacementTypeMemberReturns = map[string]string{
	"interface-return-void":     "export interface Home { M load(): void }",
	"interface-return-number":   "export interface Home { M load?(): number }",
	"interface-return-any":      "export interface Home { M load(): any }",
	"interface-return-unknown":  "export interface Home { M load(): unknown }",
	"interface-return-never":    "export interface Home { M load(): never }",
	"interface-return-generic":  "export interface Home { M load<T>(value: T): T }",
	"interface-return-computed": "export interface Home { M [Symbol.iterator](): Iterator<number> }",
	"literal-return-void":       "export type Home = { M load(): void }",
	"literal-return-number":     "export type Home = { M load?(): number }",
	"literal-return-any":        "export type Home = { M load(): any }",
	"literal-return-unknown":    "export type Home = { M load(): unknown }",
	"literal-return-never":      "export type Home = { M load(): never }",
	"literal-return-generic":    "export type Home = { M load<T>(value: T): T }",
	"literal-return-union":      "export type Home = { M load(): string | number }",
}

func effectPlacementKeys() []string {
	var keys []string
	for _, home := range effectPlacementHomes {
		for _, order := range effectPlacementOrders {
			if only, ok := effectPlacementOnly[home.key]; ok {
				if slices.Contains(only, order.key) {
					keys = append(keys, home.key+":"+order.key)
				}
			} else if home.member && order.member || !home.member && order.statement {
				keys = append(keys, home.key+":"+order.key)
			}
		}
	}
	for key := range effectPlacementTypeMemberReturns {
		keys = append(keys, key)
	}
	for key := range effectPlacementForbidden {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func effectPlacementSource(key string) string {
	if source, ok := effectPlacementTypeMemberReturns[key]; ok {
		return source
	}
	if source, ok := effectPlacementForbidden[key]; ok {
		return source
	}
	home, order, _ := strings.Cut(key, ":")
	for _, h := range effectPlacementHomes {
		for _, o := range effectPlacementOrders {
			if h.key == home && o.key == order {
				return fmt.Sprintf(h.pattern, o.run)
			}
		}
	}
	return ""
}

func FuzzEffectModifierPlacement(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", effectPlacementQuote)
	chapterSays(f, "001-functions.md", effectPlacementForbiddenQuote)
	w := NewWorkspace(f)
	keys := effectPlacementKeys()
	for i, key := range keys {
		f.Add(key, uint8(i))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(variant)%len(keys)]
		}
		source := effectPlacementSource(key)
		program := func(modifier, result string) string {
			return strings.ReplaceAll(strings.ReplaceAll(source, "M", modifier), "R", result) + "\nexport {}\n"
		}
		check := func(file, text string) []string {
			r, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{file: text}, Config: fmt.Sprintf(errorTwinConfig, file)}, OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				// async on an abstract, ambient or type member declaration (TS1243, TS1040, TS1070), and
				// effect there (EK0108). A TypeScript diagnostic carries no source here.
				if d.Source() == "EK" && d.Code() == 108 || d.Source() != "EK" && (d.Code() == 1243 || d.Code() == 1040 || d.Code() == 1070) {
					errors = append(errors, "EK0108")
					continue
				}
				errors = append(errors, fmt.Sprintf("%d %s", d.Code(), strings.ReplaceAll(d.MessageText(), "'async'", "'effect'")))
			}
			slices.Sort(errors)
			return errors
		}
		want := check("main.ts", program("async", "Promise<void>"))
		// A direct declare modifier has its own native TS1031, which can
		// prevent TypeScript from checking async at all. Chapter 1 still
		// requires EK0108 for effect in that ambient context. Compare the
		// remaining native declaration with its unmodified TypeScript twin.
		if strings.HasPrefix(key, "declare-method") {
			want = append(check("main.ts", program("", "void")), "EK0108")
			slices.Sort(want)
		}
		got := check("main.vibe", program("effect", "void!!"))
		if !slices.Equal(got, want) {
			Gap(t, effectPlacementTarget, key, "%s\n%s\nasync twin, effect named: %v\neffect: %v", effectPlacementQuote, program("effect", "void!!"), want, got)
		}
	})
}
