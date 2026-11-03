package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const objectFallbackQuote = "Its syntax decides its kind: `x catch (e) => v` (also function expressions) is plain, and its result is the fallback value; `x catch effect (e) => …` runs an Effect and may fail again."

func TestCatchObjectFallbackQuoted(t *testing.T) { checkCatchObjectFallbackQuote(t) }

func checkCatchObjectFallbackQuote(t testing.TB) {
	data, err := os.ReadFile(SpecPath("../vips/0005-try-runs-effects.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), objectFallbackQuote) {
		t.Fatal("VIP-5 handler-kind quote changed")
	}
}

// Static quick-fix coverage: the explicit plain handler must still return
// the original object, rather than parse its braces as a void block.
// Runtime comparisons remain in FuzzVIPDifferential/FuzzFix.
func FuzzCatchObjectFallback(f *testing.F) {
	startShortBudget(f)
	checkCatchObjectFallbackQuote(f)
	for _, key := range []string{"empty", "field", "shorthand", "computed", "spread", "nested", "comment", "parenthesized", "asserted", "satisfies", "non-null", "member"} {
		f.Add("shape:" + key + "\x00x")
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data string) {
		key, tail, ok := strings.Cut(strings.TrimPrefix(data, "shape:"), "\x00")
		if !ok {
			return
		}
		value := 0
		if len(tail) > 0 {
			value = int(tail[0])%33 - 16
		}
		n := fmt.Sprint(value)
		body, typ := "", "{ value: number }"
		switch key {
		case "empty":
			body, typ = "{}", "{}"
		case "field":
			body = "{ value: " + n + " }"
		case "shorthand":
			body = "{ value }"
		case "computed":
			body = "{ [\"value\"]: " + n + " }"
		case "spread":
			body = "{ ...{ value: " + n + " } }"
		case "nested":
			body, typ = "{ value: { nested: "+n+" } }", "{ value: { nested: number } }"
		case "comment":
			body = "{ /* keep object fallback */ value: " + n + " }"
		case "parenthesized":
			body = "({ value: " + n + " })"
		case "asserted":
			body = "{ value: " + n + " } as { value: number }"
		case "satisfies":
			body = "{ value: " + n + " } satisfies { value: number }"
		case "non-null":
			body = "{ value: " + n + " }!"
		case "member":
			body, typ = "{ value: "+n+" }.value", "number"
		default:
			return
		}
		source := "const value = " + n + "\nexport effect function main(): " + typ + "!! { return Effect.fail(\"missing\") catch " + body + " }\n"
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzCatchObjectFallback", files)
		defer r.Remove()
		config := toolsConfig(w, r.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatal("invalid generated project configuration")
		}
		var fixed *vibelang.FixResult
		Within("fix", func() {
			fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		})
		if fixed.Err != nil || len(fixed.Refused) > 0 || len(fixed.Files) != 1 {
			Gap(t, "FuzzCatchObjectFallback", "apply/"+key, "VIP-5: %s; object fallback has no applicable preserving repair: %+v\n%s", objectFallbackQuote, fixed, source)
		}
		next := maps.Clone(files)
		for _, file := range fixed.Files {
			next["main.vibe"] = file.Text
		}
		after := toolsCompile(t, w, "FuzzCatchObjectFallback", next)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzCatchObjectFallback", "compile/"+key, "plain handler must return the original object: %s\n%s", strings.Join(errors, "\n"), next["main.vibe"])
		}
		if key == "comment" && !strings.Contains(next["main.vibe"], "/* keep object fallback */") {
			Gap(t, "FuzzCatchObjectFallback", "comment/"+key, "object comment disappeared: %s", next["main.vibe"])
		}
	})
}
