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

// Constructor bridges introduce a function. Refusals must name the
// suspension operand rather than leave the author with generic advice.
func FuzzGeneratorConstructorRefusalReason(f *testing.F) {
	startShortBudget(f)
	nativeGeneratorRefusalReasonChapter(f)
	for _, key := range []string{"yield-operand", "grouped-yield", "member-constructor", "alias-constructor"} {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		nativeGeneratorRefusalReasonChapter(t)
		constructor, operand := "Box", "yield* Effect.succeed(value)"
		declaration := ""
		switch key {
		case "grouped-yield":
			operand = "(yield* Effect.succeed(value))"
		case "member-constructor":
			constructor = "constructors.Box"
			declaration = "const constructors = { Box };\n"
		case "alias-constructor":
			constructor = "Alias"
			declaration = "const Alias = Box;\n"
		default:
			key = "yield-operand"
		}
		if trivia&1 != 0 {
			operand = "/* retain operand */ " + operand
		}
		source := "import { Effect } from \"effect\";\nimport { Box } from './helper.js'\n" + declaration +
			"export const main = (value: number) => Effect.gen(effect function* () { return new " + constructor + "(" + operand + ").value })\n"
		toolsGuard(t, "FuzzGeneratorConstructorRefusalReason", func() {
			before := toolsCompile(t, w, "FuzzGeneratorConstructorRefusalReason", map[string]string{
				"main.vibe": source,
				"helper.ts": "export class Box { constructor(readonly value: number) {} }\n",
			})
			defer before.Remove()
			hasProducerDiagnostic := false
			for _, diagnostic := range before.Diagnostics {
				if diagnostic.Source() == "EK" && diagnostic.Code() == 1002 {
					hasProducerDiagnostic = true
				}
			}
			if !hasProducerDiagnostic {
				Gap(t, "FuzzGeneratorConstructorRefusalReason", key+":producer", "VIP-21 requires the explicit producer to retain EK1002: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
			}
			fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			if fixed.Err != nil {
				t.Fatal(fixed.Err)
			}
			for name, file := range fixed.Files {
				if filepath.Base(name.AsString()) == "main.vibe" && file.Text != source {
					Gap(t, "FuzzGeneratorConstructorRefusalReason", key, "Chapter 7 requires a preserving repair; suspension operand source changed:\n%s", file.Text)
				}
			}
			for _, site := range fixed.Sites {
				if site.Code == "EK1002" && strings.Contains(site.Reason, "yield*") {
					return
				}
			}
			Gap(t, "FuzzGeneratorConstructorRefusalReason", key, "otherwise the diagnostic explains why it has no automatic fix; missing yield* reason: %+v", fixed.Sites)
		})
	})
}
