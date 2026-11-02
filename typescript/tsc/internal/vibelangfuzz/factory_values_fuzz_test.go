package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const nativeFactoryQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."

func TestNativeFactoryDestinationsQuoted(t *testing.T) { requireNativeFactoryQuote(t) }

func requireNativeFactoryQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), nativeFactoryQuote) {
		t.Fatalf("chapter 1 no longer says %q", nativeFactoryQuote)
	}
}

// VIP-1/detail303: a factory is ordinary data at an assignment or call.
// Compare every generated VibeLang consumer with its Effect TypeScript twin,
// including true native incompatibilities instead of assuming no diagnostics.
func FuzzNativeEffectFactoryDestinations(f *testing.F) {
	startShortBudget(f)
	requireNativeFactoryQuote(f)
	kinds := []string{"native", "plain", "written"}
	targets := []string{"void", "any", "unknown", "Function", "number"}
	places := []string{"initializer", "assignment", "property", "array", "return", "argument"}
	for _, kind := range kinds {
		for _, place := range places {
			for _, target := range targets {
				f.Add(kind + "/" + target + "/" + place)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		pieces := strings.Split(key, "/")
		if len(pieces) != 3 || !slices.Contains(kinds, pieces[0]) || !slices.Contains(targets, pieces[1]) || !slices.Contains(places, pieces[2]) {
			// Arbitrary byte mutations still explore the complete product of
			// source kinds, destinations and homes, rather than one fallback.
			var choice uint64
			for i, b := range []byte(key) {
				choice = choice*33 + uint64(b) + uint64(i)
			}
			kind := kinds[choice%uint64(len(kinds))]
			choice /= uint64(len(kinds))
			target := targets[choice%uint64(len(targets))]
			choice /= uint64(len(targets))
			place := places[choice%uint64(len(places))]
			key = kind + "/" + target + "/" + place
			pieces = []string{kind, target, place}
		}
		kind, target, place := pieces[0], pieces[1], pieces[2]
		typ := "() => " + target
		if target == "Function" {
			typ = "Function"
		}
		consumer := "type Target = " + typ + ";\n"
		switch place {
		case "initializer":
			consumer += "export const value: Target = make;\n"
		case "assignment":
			consumer += "let value: Target; value=make; export { value };\n"
		case "property":
			consumer += "export const value: {make:Target} = {make};\n"
		case "array":
			consumer += "export const value: ReadonlyArray<Target> = [make,make];\n"
		case "return":
			consumer += "export function value():Target { return make }\n"
		case "argument":
			consumer += "function receive(f:Target) { return f }; export const value=receive(make);\n"
		}
		head := "import * as Effect from \"effect/Effect\";\n"
		plain := "export function make():Effect.Effect<number> { return Effect.succeed(7) }\n"
		vibe, native := head+plain+consumer, head+plain+consumer
		provider := ""
		if kind == "native" {
			provider = head + plain
			vibe = "import {make} from \"./factory.ts\";\n" + consumer
			native = vibe
		}
		if kind == "written" {
			vibe = head + "export effect function make() { return 7 }\n" + consumer
			native = head + "export function make() { return Effect.gen(function* () { return 7 }) }\n" + consumer
		}
		codes := func(name, text string) []string {
			files := map[string]string{name: text}
			if provider != "" {
				files["factory.ts"] = provider
			}
			r, err := w.Compile(t.Context(), Project{Files: files, Config: unionDataConfig})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var out []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					out = append(out, fmt.Sprintf("%s%d", d.Source(), d.Code()))
				}
			}
			slices.Sort(out)
			return out
		}
		got, want := codes("main.vibe", vibe), codes("main.ts", native)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzNativeEffectFactoryDestinations", "factory:"+key, "VIP-1/detail303: %s; native=%v, VibeLang=%v\n%s", nativeFactoryQuote, want, got, vibe)
		}
		ExpectPending(t, "FuzzNativeEffectFactoryDestinations", specCorpusKey(t))
	})
}
