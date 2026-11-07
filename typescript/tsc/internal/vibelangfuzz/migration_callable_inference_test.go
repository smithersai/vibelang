package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const callableInferenceTarget = "FuzzMigrationCallableInference"

var callableInferenceKeys = []string{"default-parameter", "error-subtype", "annotated-default-control", "explicit-union-control"}

func TestMigrationCallableInferenceQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
	TestMigrationDeclarationFixQuoted(t)
}

func callableInferenceFiles(t testing.TB, key string, mode uint8) map[string]string {
	t.Helper()
	name := "opencode-default-parameter-inference.json"
	if key == "error-subtype" || key == "explicit-union-control" {
		name = "opencode-error-subtype-inference.json"
	}
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", name))
	if err != nil {
		t.Fatal(err)
	}
	var files map[string]string
	if err := json.Unmarshal(data, &files); err != nil {
		t.Fatal(err)
	}
	if key == "annotated-default-control" {
		files["main.ts"] = strings.ReplaceAll(files["main.ts"], "version =", "version: string =")
	}
	if key == "explicit-union-control" {
		files["foreign.ts"] = strings.Replace(files["foreign.ts"], "Effect.Effect<number, Error>;", "Effect.Effect<number, Error | Failed>;", 1)
		files["main.ts"] = strings.Replace(files["main.ts"], "yield* a; return yield* b;", "return yield* a;", 1)
	}
	for name, text := range files {
		if mode&4 != 0 {
			for _, label := range []string{"start", "f"} {
				text = strings.ReplaceAll(text, "Effect.fn(\""+label+"\")(", "Effect.fn(")
			}
		}
		if mode&8 != 0 {
			if strings.Contains(key, "default") || key == "default-parameter" {
				text = strings.ReplaceAll(text, "= \"unknown\"", "= 0")
				text = strings.ReplaceAll(text, "version: string", "version: number")
			} else if key == "error-subtype" {
				text = strings.ReplaceAll(text, "yield* a; return yield* b;", "const first = yield* a; void first; return yield* b;")
			} else {
				text = strings.ReplaceAll(text, "return yield* a;", "const result = yield* a; return result;")
			}
		}
		if mode&1 != 0 {
			text = strings.ReplaceAll(text, "import * as Effect from", "import * as Fx from")
			text = strings.ReplaceAll(text, "Effect.", "Fx.")
		}
		if mode&2 != 0 {
			text = strings.ReplaceAll(text, "\n", "\r\n")
		}
		files[name] = text
	}
	files["package.json"] = "{\"type\":\"module\"}\n"
	return files
}

func checkCallableInference(t *testing.T, w *Workspace, key string, mode uint8) {
	t.Helper()
	TestMigrationCallableInferenceQuoted(t)
	files := callableInferenceFiles(t, key, mode&15)
	reference := toolsCompile(t, w, callableInferenceTarget, files)
	defer reference.Remove()
	if !toolsErrorFree(reference) {
		t.Fatalf("invalid TypeScript reference: %v\n%s", SortedKeys(Keys(reference.Dir, reference.Diagnostics)), Archive(files))
	}
	native := maps.Clone(files)
	native["main.vibe"] = native["main.ts"]
	delete(native, "main.ts")
	before := toolsCompile(t, w, callableInferenceTarget, native)
	defer before.Remove()
	if !toolsErrorFree(before) {
		t.Fatalf("valid original native callable rejected: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), Archive(native))
	}
	flavor := "named"
	if mode&4 != 0 {
		flavor = "unnamed"
	}
	check := func(stage string, outputs map[string]string) {
		t.Helper()
		gapKey := stage + ":" + key + ":" + flavor
		if diff := compareDeclarationOutputs(t, reference.Outputs, outputs); diff != "" {
			if strings.HasSuffix(key, "-control") {
				t.Fatalf("explicit contract control changed: %s\n%s", diff, Archive(native))
			}
			Gap(t, callableInferenceTarget, gapKey, "Chapters 1 and 7 require preserved callable parameter, result and error types; conditional projections remain observable\n%s\n%s", diff, Archive(native))
		}
		ExpectPending(t, callableInferenceTarget, gapKey)
	}
	check("original", before.Outputs)
	config := toolsConfig(w, before.Dir)
	if config == nil || len(config.Errors) != 0 {
		t.Fatal("invalid callable project")
	}
	result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
	if result.Err != nil {
		Gap(t, callableInferenceTarget, "converge:"+key, "preserving repair failed: %v", result.Err)
	}
	fixed := maps.Clone(native)
	for name, file := range result.Files {
		rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
		if rel != "main.vibe" {
			t.Fatalf("repair changed a dependency: %s", rel)
		}
		fixed[rel] = file.Text
	}
	after := toolsCompile(t, w, callableInferenceTarget, fixed)
	defer after.Remove()
	if !toolsErrorFree(after) {
		Gap(t, callableInferenceTarget, "compile:"+key, "repair rejected the typed original: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(fixed))
	}
	check("repair", after.Outputs)
	ExpectPending(t, callableInferenceTarget, specCorpusKey(t))
}

func TestMigrationCallableInferenceStockTwins(t *testing.T) {
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	for _, key := range callableInferenceKeys {
		t.Run(key, func(t *testing.T) {
			var child *testing.T
			t.Run("stock", func(t *testing.T) {
				child = t
				dir := emitDeclarationIdentityStock(t, w, tsc, Project{Files: callableInferenceFiles(t, key, 0), Config: DefaultConfig})
				defer os.RemoveAll(dir)
			})
			if child.Skipped() {
				t.Fatal("stock compiler did not admit the minimized callable")
			}
		})
	}
}

func FuzzMigrationCallableInference(f *testing.F) {
	startShortBudget(f)
	f.Add("annotated-default-control", uint8(15))
	f.Add("explicit-union-control", uint8(0))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(callableInferenceKeys, key) {
			if key == "" {
				key = callableInferenceKeys[0]
			} else {
				key = callableInferenceKeys[int(key[0])%len(callableInferenceKeys)]
			}
		}
		checkCallableInference(t, w, key, mode&15)
	})
}

func TestMigrationCallableInferenceNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("extended matrix runs without -short")
	}
	w := NewWorkspace(t)
	for _, key := range callableInferenceKeys {
		for mode := range 16 {
			t.Run(key+"/"+strconv.Itoa(mode), func(t *testing.T) { checkCallableInference(t, w, key, uint8(mode)) })
		}
	}
}

func TestMigrationCallableInferenceOracleControls(t *testing.T) {
	before := map[string]string{"out/main.d.ts": "export declare const start: (version?: any) => string;\n"}
	narrowed := map[string]string{"out/main.d.ts": "export declare const start: (version?: string) => string;\n"}
	if diff := compareDeclarationOutputs(t, before, before); diff != "" {
		t.Fatalf("identical default parameter control differs: %s", diff)
	}
	if diff := compareDeclarationOutputs(t, before, narrowed); diff == "" {
		t.Fatal("default parameter narrowing was not observable")
	}
	union := "import type * as Effect from \"effect/Effect\";\nexport declare class Failed extends Error { readonly _tag: \"Failed\"; }\nexport declare const f: () => Effect.Effect<number, Error | Failed, never>;\nexport type FailurePart = Extract<Effect.Error<ReturnType<typeof f>>, Failed>;\n"
	reduced := strings.Replace(union, "Error | Failed", "Error", 1)
	if diff := compareDeclarationOutputs(t, map[string]string{"out/main.d.ts": union}, map[string]string{"out/main.d.ts": union}); diff != "" {
		t.Fatalf("identical subtype projection differs: %s", diff)
	}
	if diff := compareDeclarationOutputs(t, map[string]string{"out/main.d.ts": reduced}, map[string]string{"out/main.d.ts": union}); diff == "" {
		t.Fatal("a changed Extract projection was not observable")
	}
}
