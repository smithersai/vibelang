package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const plainHandlerEffectAdviceQuote = "A plain handler whose result type is an Effect gets a VIP-38 lint warning (`EK0508`)"
const plainHandlerEffectResultQuote = "A type answers yes when it is not `never`, `any` or `unknown` and at least one union member is an Effect."

func TestPlainHandlerEffectAdviceQuoted(t *testing.T) {
	chapter := SpecText("002-running.md")
	for _, quote := range []string{plainHandlerEffectAdviceQuote, plainHandlerEffectResultQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("chapter 2 no longer says %q", quote)
		}
	}
}

// Vary the result's type, literal handler spelling, and configurable severity.
// The oracle comes from the result test, not the operand's every-member test.
func FuzzPlainHandlerEffectAdvice(f *testing.F) {
	startShortBudget(f)
	types := []struct {
		key, source string
		warns       bool
	}{
		{"effect", "Effect.Effect<number>", true},
		{"union", "Effect.Effect<number> | number", true},
		{"optional", "Effect.Effect<number> | undefined", true},
		{"intersection", "Effect.Effect<number> & {tag:string}", true},
		{"nested", "Effect.Effect<Effect.Effect<number>>", true},
		{"any", "any", false}, {"unknown", "unknown", false}, {"never", "never", false},
		{"number", "number", false}, {"promise", "Promise<number>", false},
	}
	for _, typ := range types {
		for shape := uint8(0); shape < 4; shape++ {
			f.Add(typ.key, shape, uint8(0))
		}
	}
	for severity := uint8(1); severity < 4; severity++ {
		f.Add("effect", uint8(0), severity)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape, severity uint8) {
		TestPlainHandlerEffectAdviceQuoted(t)
		i := slices.IndexFunc(types, func(v struct {
			key, source string
			warns       bool
		}) bool {
			return v.key == key
		})
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(types)
		}
		typ := types[i]
		handler := []string{"() => input", "() => { return input }", "function () { return input }", "((() => input))"}[shape%4]
		source := fmt.Sprintf("declare const input: %s; export effect function load() {return Effect.fail(\"bad\") catch %s}", typ.source, handler)
		config := DefaultConfig
		if severity%4 != 0 {
			level := []string{"warning", "error", "suggestion", "off"}[severity%4]
			config = strings.TrimSuffix(strings.TrimSpace(config), "}") + fmt.Sprintf(",\"vibe\":{\"severities\":{\"EK0508\":%q}}}", level)
		}
		result, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		all := append(result.Diagnostics, result.Program.GetSuggestionDiagnostics(t.Context(), nil)...)
		for _, d := range all {
			if d.Source() != "EK" || d.Code() != 508 {
				continue
			}
			count++
			category := []diagnostics.Category{diagnostics.CategoryWarning, diagnostics.CategoryError, diagnostics.CategorySuggestion, diagnostics.CategoryWarning}[severity%4]
			if d.Category() != category {
				t.Errorf("EK0508 category=%v, want %v", d.Category(), category)
			}
		}
		want := 0
		if typ.warns && severity%4 != 3 {
			want = 1
		}
		if count != want {
			Gap(t, "FuzzPlainHandlerEffectAdvice", fmt.Sprintf("%s/%d/%d", typ.key, shape%4, severity%4), "%s: got %d warnings, want %d\n%s", plainHandlerEffectAdviceQuote, count, want, source)
		}
	})
}
