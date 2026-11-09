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
	"abstract-method:forbidden":  "export abstract class Home { M abstract load(): R }",
	"declare-function:forbidden": "M declare function load(): R",
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
	for key := range effectPlacementForbidden {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func effectPlacementSource(key string) string {
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
				// async on an abstract or ambient declaration (TS1243, TS1040), and
				// effect there (EK0108). A TypeScript diagnostic carries no source here.
				if d.Source() == "EK" && d.Code() == 108 || d.Source() != "EK" && (d.Code() == 1243 || d.Code() == 1040) {
					errors = append(errors, "EK0108")
					continue
				}
				errors = append(errors, fmt.Sprintf("%d %s", d.Code(), strings.ReplaceAll(d.MessageText(), "'async'", "'effect'")))
			}
			slices.Sort(errors)
			return errors
		}
		want := check("main.ts", program("async", "Promise<void>"))
		got := check("main.vibe", program("effect", "void!!"))
		if !slices.Equal(got, want) {
			Gap(t, effectPlacementTarget, key, "%s\n%s\nasync twin, effect named: %v\neffect: %v", effectPlacementQuote, program("effect", "void!!"), want, got)
		}
	})
}
