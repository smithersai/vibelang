package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const fiberPlacementTarget = "FuzzFiberPlacement"

func fiberPlacementChapter(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	const quote = "| `fork` or `join` outside effect code | `EK1701` |"
	if !strings.Contains(string(chapter), quote) {
		t.Fatalf("VIP-17 no longer says %q", quote)
	}
	const joinQuote = "| `join f` | `Fiber.join(f)`, giving the fiber's success or propagating its failure |"
	if !strings.Contains(string(chapter), joinQuote) {
		t.Fatalf("VIP-17 no longer says %q", joinQuote)
	}
	const importedQuote = "| `EK3801` | `effecttsgo/floatingEffect` | 38 | [Tooling](007-tooling.md) | `error` |"
	if !strings.Contains(SpecText("007-tooling.md"), importedQuote) {
		t.Fatalf("VIP-38 no longer says %q", importedQuote)
	}
}

func TestFiberPlacementQuoted(t *testing.T) { fiberPlacementChapter(t) }

// VIP-17 assigns EK1701 by source placement, independently of the operand.
// The paired ordinary Effect call is legal cold-program construction at each
// boundary. Names in saved corpus select a stable operator/boundary pair.
func FuzzFiberPlacement(f *testing.F) {
	startShortBudget(f)
	fiberPlacementChapter(f)
	boundaries := []struct{ key, source string }{
		{"function", "function f() { const value = %s }"},
		{"arrow", "const f = () => { const value = %s }"},
		{"async-function", "async function f() { const value = %s }"},
		{"async-arrow", "const f = async () => %s"},
		{"concise", "const f = () => %s"},
		{"nested-function", "effect function outer() { function f() { return %s }; return 1 }"},
		{"nested-arrow", "effect function outer() { const f = () => %s; return 1 }"},
		{"callback", "effect function outer() { [1].map(() => %s); return 1 }"},
		{"catch-handler", "effect function outer() { return Effect.fail(1) catch () => %s }"},
		{"method", "class C { f() { return %s } }"},
		{"field", "class C { value = %s }"},
		{"effect-field", "effect function outer() { class C { value = %s }; return 1 }"},
		{"static", "class C { static { const value = %s } }"},
		{"effect-static", "effect function outer() { class C { static { const value = %s } }; return 1 }"},
		{"constructor", "class C { constructor() { const value = %s } }"},
		{"getter", "class C { get value() { return %s } }"},
		{"default", "function f(value = %s) { return value }"},
		{"effect-default", "effect function f(value = %s) { return 1 }"},
		{"top-level", "const value = %s"},
		{"function-statement", "function f() { %s; }"},
		{"arrow-statement", "const f = () => { %s; }"},
		{"async-statement", "async function f() { %s; }"},
		{"static-statement", "class C { static { %s; } }"},
		{"effect-static-statement", "effect function outer() { class C { static { %s; } }; return 1 }"},
		{"nested-static-statement", "effect function outer() { class C { static { class D { static { %s; } } } }; return 1 }"},
		{"parenthesized-static-statement", "effect function outer() { class C { static { ((%s)); } }; return 1 }"},
	}
	keys := []string{}
	for _, operator := range []string{"fork", "join"} {
		for _, boundary := range boundaries {
			key := operator + ":" + boundary.key
			keys = append(keys, key)
			f.Add([]byte(key))
			if strings.HasSuffix(boundary.key, "-statement") {
				f.Add([]byte(key + ":imported"))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, tail := 0, data
		if len(data) != 0 {
			choice, tail = int(data[0])%len(keys), data[1:]
		}
		for i, key := range keys {
			if string(data) == key {
				choice, tail = i, nil
				break
			}
			if rest, ok := strings.CutPrefix(string(data), key+":"); ok {
				choice, tail = i, []byte(rest)
				break
			}
		}
		selected := strings.HasSuffix(string(data), ":imported")
		config := DefaultConfig
		if selected {
			config = fiberPlacementImportedConfig(t)
		}
		n := 1
		if len(tail) != 0 {
			n += int(tail[0])
		}
		operator, _, _ := strings.Cut(keys[choice], ":")
		operand := fmt.Sprintf("Effect.succeed(%d)", n)
		ordinary := "Effect.forkScoped(" + operand + ")"
		if operator == "join" {
			operand, ordinary = "child", "Fiber.join(child)"
		}
		prefix := "import { Effect, Fiber } from \"effect\"; declare const child: Fiber.Fiber<number>;\n"
		template := boundaries[choice%len(boundaries)].source
		compile := func(expression string) (int, []int32) {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": prefix + fmt.Sprintf(template, expression)}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			count, codes := 0, []int32{}
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					count++
					codes = append(codes, d.Code())
				}
			}
			return count, codes
		}
		// Ordinary cold API statements retain their discard diagnostic;
		// a misplaced fiber operator has the owning placement diagnostic.
		if count, codes := compile(ordinary); strings.HasSuffix(keys[choice], "-statement") {
			want := int32(4801)
			if selected {
				want = 3801
			}
			if count != 1 || codes[0] != want {
				Gap(t, fiberPlacementTarget, "control:"+keys[choice], "discarded ordinary Effect must retain EK%d; got %v", want, codes)
				return
			}
		} else if count != 0 {
			Gap(t, fiberPlacementTarget, "control:"+keys[choice], "ordinary cold Effect call must compile; got %v", codes)
			return
		}
		count, codes := compile(operator + " " + operand)
		if count != 1 || codes[0] != 1701 {
			Gap(t, fiberPlacementTarget, "placement:"+keys[choice], "VIP-17 requires exactly EK1701 outside effect code; got %v; template %s", codes, template)
			return
		}
		ExpectPending(t, fiberPlacementTarget, "placement:"+keys[choice])
		ExpectPending(t, fiberPlacementTarget, specCorpusKey(t))
	})
}

// The imported rule must still report a real cold Effect returned by a valid
// join. VIP-17 maps join to Fiber.join; compare both source forms as VIP-38
// requires, rather than hiding every diagnostic on a compiler-written helper.
func TestFiberPlacementImportedColdResult(t *testing.T) {
	fiberPlacementChapter(t)
	w := NewWorkspace(t)
	prefix := "import { Effect, Fiber } from \"effect\"; declare const child: Fiber.Fiber<Effect.Effect<number>>;\n"
	r, err := w.Compile(t.Context(), Project{
		Files: map[string]string{
			"main.vibe": prefix + "export effect function main(_input: number) { join child; return 1 }",
			"native.ts": prefix + "export function main(_input: number) { return Effect.gen(function* () { yield* Fiber.join(child); return 1 }) }",
		},
		Config: fiberPlacementImportedConfig(t),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	got := map[string]int{}
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if !IsEK(d) || d.Code() != 3801 {
			t.Fatalf("unexpected diagnostic: %s", d.String())
		}
		got[filepath.Base(d.File().FileName().AsString())]++
	}
	if got["main.vibe"] != 1 || got["native.ts"] != 1 {
		t.Fatalf("a valid join discarding a cold Effect must retain EK3801 in both inputs; got %v", got)
	}
}

func fiberPlacementImportedConfig(t testing.TB) string {
	t.Helper()
	var options map[string]any
	if err := json.Unmarshal([]byte(DefaultConfig), &options); err != nil {
		t.Fatal(err)
	}
	options["compilerOptions"].(map[string]any)["plugins"] = []any{map[string]any{
		"name":               "@effect/language-service",
		"diagnosticSeverity": map[string]string{"floatingEffect": "error"},
	}}
	encoded, err := json.Marshal(options)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
