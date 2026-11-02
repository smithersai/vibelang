package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var settledShapeQuotes = []string{
	"a tuple for an array literal",
	"A non-literal tuple whose elements differ in type is TypeScript's error there",
	"TypeScript types the spread part as an array, not a tuple",
}

func settledShapesChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range settledShapeQuotes {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 2 no longer says %q", quote)
		}
	}
}
func TestTryAllSettledShapesQuoted(t *testing.T) { settledShapesChapter(t) }

// The native .map(Effect.exit) counterpart is the static oracle. Literal
// elements use individual Effect.exit calls; a spread first builds its array.
// No runtime Exit comparison or new language semantics is introduced here.
func FuzzTryAllSettledShapes(f *testing.F) {
	startShortBudget(f)
	settledShapesChapter(f)
	rules := []struct {
		key, gap       string
		spread, length bool
	}{
		{"held-heterogeneous", "admission:held-heterogeneous", false, false},
		{"spread-heterogeneous", "admission:spread-heterogeneous", true, false},
		{"held-tuple-length", "type:held-tuple-length", false, true},
		{"spread-tuple-length", "type:spread-tuple-length", true, true},
	}
	for _, r := range rules {
		for _, suffix := range []string{"", ":paren", ":alias", ":mutable", ":alias-paren"} {
			f.Add([]byte(r.key + suffix))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		settledShapesChapter(t)
		parts := strings.SplitN(string(data), ":", 2)
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % len(rules)
		}
		for i, r := range rules {
			if r.key == parts[0] {
				index = i
				break
			}
		}
		rule := rules[index]
		suffix := ""
		if len(parts) > 1 {
			suffix = parts[1]
		}
		second := "string"
		if rule.length {
			second = "number"
		}
		tuple := "readonly [Effect.Effect<number>, Effect.Effect<" + second + ">]"
		if strings.Contains(suffix, "mutable") {
			tuple = strings.TrimPrefix(tuple, "readonly ")
		}
		prefix := "import { Effect } from \"effect\";\n"
		if strings.Contains(suffix, "alias") {
			prefix += "type Rows = " + tuple + ";\n"
			tuple = "Rows"
		}
		operand := "rows"
		if rule.spread {
			operand = "[...rows]"
		}
		if strings.Contains(suffix, "paren") {
			operand = "(" + operand + ")"
		}
		goodVibe := "return try.allSettled [rows[0], rows[1]]"
		badVibe := "return try.allSettled " + operand
		literalNative := "yield* Effect.all([Effect.exit(rows[0]), Effect.exit(rows[1])], { concurrency: \"unbounded\" })"
		mappedNative := "yield* Effect.all(source.map(Effect.exit), { concurrency: \"unbounded\" })"
		goodNative := "return " + literalNative
		badNative := "const source = " + operand + "; return " + mappedNative
		if rule.length {
			tail := "; const length: 2 = results.length; return length"
			goodVibe = "const results = try.allSettled [rows[0], rows[1]]" + tail
			badVibe = "const results = try.allSettled " + operand + tail
			goodNative = "const results = " + literalNative + tail
			badNative = "const source = " + operand + "; const results = " + mappedNative + tail
		}
		vibe := func(body string) string {
			return fmt.Sprintf("%sexport effect function check(rows: %s): Effect.Effect<unknown> { %s }\n", prefix, tuple, body)
		}
		native := func(body string) string {
			return fmt.Sprintf("%sexport function check(rows: %s): Effect.Effect<unknown> { return Effect.gen(function* () { %s }) }\n", prefix, tuple, body)
		}
		compile := func(name, source string) (int, bool, string) {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{name: source}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			count, ek := 0, false
			var messages []string
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					if !IsEK(d) && d.Code() == 2307 {
						t.Fatalf("missing reference dependency: %s", d.String())
					}
					count++
					ek = ek || IsEK(d)
					messages = append(messages, d.String())
				}
			}
			return count, ek, strings.Join(messages, "\n")
		}
		for _, control := range []struct{ name, source string }{{"main.ts", native(goodNative)}, {"main.vibe", vibe(goodVibe)}} {
			if count, _, errors := compile(control.name, control.source); count != 0 {
				t.Fatalf("%s valid literal control fails:\n%s\n%s", rule.key, errors, control.source)
			}
		}
		if count, _, _ := compile("main.ts", native(badNative)); count == 0 {
			t.Fatalf("invalid oracle: native counterpart accepts %s:\n%s", rule.key, native(badNative))
		}
		count, ek, errors := compile("main.vibe", vibe(badVibe))
		if count == 0 {
			Gap(t, "FuzzTryAllSettledShapes", rule.gap, "VIP-18/chapter 2 requires the native counterpart's rejection; source was accepted:\n%s", vibe(badVibe))
			return
		}
		if ek {
			t.Fatalf("%s needs ordinary TypeScript type checks, not an Effect-operand rejection:\n%s", rule.key, errors)
		}
		ExpectPending(t, "FuzzTryAllSettledShapes", rule.gap)
	})
}
