package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const explicitDiscardTarget = "FuzzEffectGenExplicitDiscards"
const explicitDiscardQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestEffectGenExplicitDiscardsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), explicitDiscardQuote) {
		t.Fatalf("Chapter 7 no longer says %q", explicitDiscardQuote)
	}
}

// Generator migration must preserve a TypeScript statement that drops a cold
// Effect, and produce an admitted explicit discard rather than running it.
func FuzzEffectGenExplicitDiscards(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("007-tooling.md"), explicitDiscardQuote) {
		f.Fatal("generator preservation quote changed")
	}
	forms := []string{"gen", "fn", "named", "untraced"}
	shapes := []string{"direct", "parenthesized", "reference", "conditional", "callback", "pipeline", "explicit", "returned", "yielded-program"}
	for i, shape := range shapes {
		f.Add([]byte("key:" + forms[i%len(forms)] + "/" + shape))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := strings.TrimPrefix(string(data), "key:")
		parts := strings.Split(key, "/")
		if len(parts) != 2 || !slices.Contains(forms, parts[0]) || !slices.Contains(shapes, parts[1]) {
			if len(data) == 0 {
				data = []byte{0}
			}
			parts = []string{forms[int(data[0])%len(forms)], shapes[int(data[len(data)-1])%len(shapes)]}
			key = strings.Join(parts, "/")
		}
		body := map[string]string{
			"direct":          "Effect.succeed(1); return yield* Effect.succeed(2);",
			"parenthesized":   "(Effect.succeed(1)); return yield* Effect.succeed(2);",
			"reference":       "const job = Effect.succeed(1); job; return yield* Effect.succeed(2);",
			"conditional":     "const job = Effect.succeed(1); true ? job : Effect.succeed(2); return yield* Effect.succeed(3);",
			"callback":        "const values = [1].map(n => { Effect.succeed(n); return n; }); return yield* Effect.succeed(values);",
			"pipeline":        "Effect.succeed(1).pipe(Effect.map(n => n + 1)); return yield* Effect.succeed(2);",
			"explicit":        "void Effect.succeed(1); return yield* Effect.succeed(2);",
			"yielded-program": "yield* Effect.succeed(Effect.succeed(1)); return yield* Effect.succeed(2);",
			"returned":        "return yield* Effect.succeed(Effect.succeed(1));",
		}[parts[1]]
		generator := "function* () { " + body + " }"
		call := map[string]string{
			"gen":      "Effect.gen(" + generator + ")",
			"fn":       "Effect.fn(" + generator + ")",
			"named":    "Effect.fn(\"work\")(" + generator + ")",
			"untraced": "Effect.fnUntraced(" + generator + ")",
		}[parts[0]]
		files := map[string]string{"main.vibe": "import { Effect } from \"effect\"\nexport const work = " + call + "\n"}
		before := toolsCompile(t, w, explicitDiscardTarget, files)
		defer before.Remove()
		result := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir))
		if result.Err != nil || len(result.Refused) != 0 {
			t.Fatalf("fix: %v, refused: %+v", result.Err, result.Refused)
		}
		fixed := maps.Clone(files)
		for path, file := range result.Files {
			fixed[strings.TrimPrefix(path.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		text := fixed["main.vibe"]
		if strings.Contains(text, "function*") {
			Gap(t, explicitDiscardTarget, key, "%s: generator remains:\n%s", explicitDiscardQuote, text)
		}
		after := toolsCompile(t, w, explicitDiscardTarget, fixed)
		defer after.Remove()
		for _, d := range after.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, explicitDiscardTarget, key, "%s: repaired generator reports %s\n%s", explicitDiscardQuote, d.String(), text)
			}
		}
		count := strings.Count(text, "void ")
		if want := map[bool]int{true: 0, false: 1}[parts[1] == "returned"]; count != want {
			Gap(t, explicitDiscardTarget, key, "discarded versus returned programs changed: got %d explicit discards, want %d\n%s", count, want, text)
		}
		if strings.Contains(text, "try Effect.succeed(1)") {
			Gap(t, explicitDiscardTarget, key, "discarded program was run:\n%s", text)
		}
	})
}
