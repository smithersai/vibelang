package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestLegacyEffectAliasBindingsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacyAliasQuote) {
		t.Fatal(legacyAliasQuote)
	}
}
func FuzzLegacyEffectAliasBindings(f *testing.F) {
	startShortBudget(f)
	keys := []string{"legacy-global", "local-type", "imported-type", "legacy-disabled", "legacy-effect-return", "legacy-callback-union", "legacy-service-requirement"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	for shape := range uint8(4) {
		for _, key := range []string{"legacy-effect-return", "legacy-callback-union", "legacy-service-requirement"} {
			f.Add(key, shape)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape uint8) {
		TestLegacyEffectAliasBindingsQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		typ := []string{"number", "string", "number | string", "readonly number[]"}[int(shape)%4]
		use := "export let result: Effect<" + typ + ">;"
		files := map[string]string{}
		switch key {
		case "legacy-effect-return":
			// plain-contract-exceptions: a legacy alias on an effect return
			// annotation still warns when all three slots are explicit.
			value := []string{"1", "\"value\"", "1", "[]"}[int(shape)%4]
			use = fmt.Sprintf("export effect function result(): Effect<%s, never, never> { return %s }", typ, value)
		case "legacy-callback-union":
			// A void callback may ignore an Effect result, but its written
			// legacy alias still needs the migration warning (VIP-1/VIP-3).
			value := []string{"1", "\"value\"", "1", "[]"}[int(shape)%4]
			use = fmt.Sprintf("effect function task() { return %s }; export const callback: () => number | Effect<%s> = task; export const erased: () => void = callback;", value, typ)
		case "legacy-service-requirement":
			use = "service Port { static readonly key = \"pmfix/port\"; value: " + typ + " }; export let result: Effect<" + typ + ", never, Port>;"
		case "legacy-disabled":
			use = "// @vibelang-diagnostics-next-line EK4856:off\n" + use
		case "local-type":
			use = "type Effect<A> = { value:A };" + use
		case "imported-type":
			use = "import type { Effect } from \"./native.js\";" + use
			files["native.ts"] = "export type Effect<A> = { value:A };"
		}
		files["main.vibe"] = use
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		warnings, errors := 0, []string{}
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4856 {
				warnings++
			}
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, fmt.Sprint(d))
			}
		}
		want := 0
		if strings.HasPrefix(key, "legacy-") && key != "legacy-disabled" {
			want = 1
		}
		if warnings != want || len(errors) != 0 {
			Gap(t, "FuzzLegacyEffectAliasBindings", key, "chapter 007 %q: want %d EK4856 and no errors; got %d, %v; %s", legacyAliasQuote, want, warnings, errors, use)
		}
	})
}
