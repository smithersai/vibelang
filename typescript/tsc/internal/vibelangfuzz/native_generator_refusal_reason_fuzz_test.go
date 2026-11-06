package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestNativeGeneratorRefusalReasonQuoted(t *testing.T) {
	nativeGeneratorRefusalReasonChapter(t)
}

func nativeGeneratorRefusalReasonChapter(t testing.TB) {
	t.Helper()
	nativeGeneratorsChapter(t)
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	quote := "otherwise the diagnostic explains why it has no automatic fix"
	if !strings.Contains(string(text), quote) {
		t.Fatalf("quick-fix chapter no longer says %q", quote)
	}
}

// VIP-21 admits ordinary generators. Chapter 7 requires an invalid producer's
// unavailable repair to explain its obstruction rather than repeat generic advice.
func FuzzNativeGeneratorRefusalReason(f *testing.F) {
	startShortBudget(f)
	nativeGeneratorRefusalReasonChapter(f)
	keys := []string{"try-catch", "try-finally", "try-catch-finally"}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input []byte) {
		key, rest, _ := strings.Cut(string(input), ":")
		api, mode, _ := strings.Cut(rest, ":")
		index := 0
		if len(input) > 0 {
			index = int(input[0]) % len(keys)
		}
		for i, candidate := range keys {
			if candidate == key {
				index = i
				break
			}
		}
		key = keys[index]
		bodies := []string{
			"try { return yield* Effect.succeed(1) } catch { return 0 }",
			"try { return yield* Effect.succeed(1) } finally { /* retain cleanup */ }",
			"try { return yield* Effect.succeed(1) } catch { return 0 } finally { /* retain cleanup */ }",
		}
		generator := "function* () { " + bodies[index] + " }"
		producer := mode == "producer"
		if producer {
			generator = "effect " + generator
		}
		call := "Effect.gen(" + generator + ")"
		if api == "named-fn" {
			call = "Effect.fn(\"result\")(" + generator + ")"
		}
		source := "import { Effect } from \"effect\";\nexport const result = " + call + ";\n"
		before, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if !producer && HasError(before.Diagnostics) {
			Gap(t, "FuzzNativeGeneratorRefusalReason", key+":"+api+":native", "VIP-21 native generator has errors: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		if !producer {
			text := source
			for name, file := range fixed.Files {
				if filepath.Base(name.AsString()) == "main.vibe" {
					text = file.Text
				}
			}
			// Other independent teaching fixes may apply. VIP-21 requires the
			// native generator and its JavaScript control flow to survive.
			if len(fixed.Refused) != 0 || !strings.Contains(text, "function*") || !strings.Contains(text, "try {") || !strings.Contains(text, "yield*") {
				Gap(t, "FuzzNativeGeneratorRefusalReason", key+":"+api+":native", "native generator or control flow changed, or acquired a refused error: %v\n%s", fixed.Refused, text)
			}
			if text != source {
				t.Logf("native generator retained after independent repairs:\n%s", text)
			}
			after, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": text}})
			if err != nil {
				t.Fatal(err)
			}
			defer after.Remove()
			if HasError(after.Diagnostics) {
				Gap(t, "FuzzNativeGeneratorRefusalReason", key+":"+api+":native", "independent teaching fixes introduced errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
			}
			return
		}
		found := false
		for _, site := range fixed.Sites {
			if site.Code == "EK1002" {
				found = true
				if !strings.Contains(site.Reason, "a try statement in a generator catches JavaScript exceptions") {
					Gap(t, "FuzzNativeGeneratorRefusalReason", key+":"+api+":producer", "refusal lost the planner's semantic explanation: %+v", site)
				}
			}
		}
		if !found {
			Gap(t, "FuzzNativeGeneratorRefusalReason", key+":"+api+":producer", "explicit producer must retain the EK1002 refusal: %+v", fixed.Sites)
		}
	})
}
