package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const layerMergeAdviceQuote = "Layers are composed with Effect's own Layer API; there is no `wire`"

var layerMergeAdviceKeys = []string{"dependency", "reverse", "alias", "extra", "no-dependency", "unrelated", "shadow"}

func TestLayerMergeAdviceQuoted(t *testing.T) { layerMergeAdviceQuoted(t) }
func layerMergeAdviceQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), layerMergeAdviceQuote) {
		t.Fatalf("chapter 5 no longer says %q", layerMergeAdviceQuote)
	}
}

func layerMergeAdviceText(d *ast.Diagnostic) string {
	text := d.String()
	for _, child := range d.MessageChain() {
		text += "\n" + layerMergeAdviceText(child)
	}
	return text
}

func TestLayerMergeNativeAdvice(t *testing.T) {
	layerMergeAdviceQuoted(t)
	checkLayerMergeAdvice(t, NewWorkspace(t), "dependency", 0)
}

// A real provider/dependent pair must point to native Layer composition.
// Reordering, aliases, trivia and unrelated providers retain the rule; plain
// objects and independent Layers must not acquire its diagnostic.
func FuzzLayerMergeAdvice(f *testing.F) {
	startShortBudget(f)
	layerMergeAdviceQuoted(f)
	for _, key := range layerMergeAdviceKeys {
		for variant := byte(0); variant < 4; variant++ {
			f.Add([]byte(key + "\x00" + string([]byte{variant})))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key, variant := parts[0], byte(0)
		if !slices.Contains(layerMergeAdviceKeys, key) {
			key = "dependency"
		}
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		checkLayerMergeAdvice(t, w, key, variant)
	})
}

func checkLayerMergeAdvice(t testing.TB, w *Workspace, key string, variant byte) {
	t.Helper()
	name := "Base"
	if variant&1 != 0 {
		name = "BaseCafé"
	}
	layer, imported := "Layer", "Layer"
	if key == "alias" {
		layer, imported = "L", "Layer as L"
	}
	if key == "shadow" {
		layer, imported = "NativeLayer", "Layer as NativeLayer"
	}
	dependency := name
	if key == "unrelated" {
		dependency = "Other"
	}
	dependent := fmt.Sprintf("%s.effect(Output, Effect.map(%s, n => n + 1))", layer, dependency)
	if key == "no-dependency" {
		dependent = layer + ".succeed(Output, 8)"
	}
	separator := ", "
	if variant&2 != 0 {
		separator = ", /* preserve\nprovider trivia */ "
	}
	args := "supplied" + separator + "dependent"
	if key == "reverse" {
		args = "dependent" + separator + "supplied"
	}
	if key == "extra" {
		args += separator + layer + ".succeed(Other, 9)"
	}
	call := layer + ".mergeAll"
	shadow := ""
	if key == "shadow" {
		shadow = "const local = { mergeAll: (...providers: unknown[]): unknown[] => providers };\n"
		call = "local.mergeAll"
	}
	source := fmt.Sprintf("import { Context, Effect, %s } from \"effect\";\nclass %s extends Context.Service<%s, number>()(\"advice/Base\") {}\nclass Output extends Context.Service<Output, number>()(\"advice/Output\") {}\nclass Other extends Context.Service<Other, number>()(\"advice/Other\") {}\nconst supplied = %s.succeed(%s, 7);\nconst dependent = %s;\n%sexport const merged = %s(%s);\n", imported, name, name, layer, name, dependent, shadow, call, args)
	result, err := w.Compile(t.Context(), Project{
		Config: `{"compilerOptions":{"strict":true,"noEmit":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
		Files:  map[string]string{"main.vibe": source},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	want := 1
	if key == "no-dependency" || key == "unrelated" || key == "shadow" {
		want = 0
	}
	got := 0
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("fixture rejected: %s\n%s", d.String(), source)
		}
		if d.Source() != "EK" || d.Code() != 4807 {
			continue
		}
		got++
		text := layerMergeAdviceText(d)
		if strings.Contains(text, "wire") || !strings.Contains(text, "Layer.provide") || !strings.Contains(text, "Layer.provideMerge") {
			Gap(t, "FuzzLayerMergeAdvice", key, "chapter 5: %s; obsolete composition advice: %s", layerMergeAdviceQuote, text)
			return
		}
	}
	if got != want {
		Gap(t, "FuzzLayerMergeAdvice", key, "want %d EK4807, got %d in %q", want, got, source)
		return
	}
	if want != 0 {
		// Type-check the suggested native composition, retaining both outputs.
		composition := layer + ".provideMerge(supplied)(dependent)"
		if key == "extra" {
			composition = layer + ".mergeAll(" + composition + ", " + layer + ".succeed(Other, 9))"
		}
		repaired := strings.Replace(source, call+"("+args+")", composition, 1)
		repaired += fmt.Sprintf("\nconst outputComplete: Effect.Effect<number> = Effect.provide(Output, merged);\nconst baseComplete: Effect.Effect<number> = Effect.provide(%s, merged);\n", name)
		checked, err := w.Compile(t.Context(), Project{
			Config: `{"compilerOptions":{"strict":true,"noEmit":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
			Files:  map[string]string{"main.vibe": repaired},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer checked.Remove()
		for _, d := range checked.Diagnostics {
			if d.Category() == diagnostics.CategoryError || d.Source() == "EK" && d.Code() == 4807 {
				Gap(t, "FuzzLayerMergeAdvice", key+":counterpart", "native Layer.provideMerge advice does not type-check cleanly: %s", layerMergeAdviceText(d))
				return
			}
		}
	}
	if tt, ok := t.(*testing.T); ok {
		ExpectPending(tt, "FuzzLayerMergeAdvice", key)
		ExpectPending(tt, "FuzzLayerMergeAdvice", specCorpusKey(tt))
	}
}
