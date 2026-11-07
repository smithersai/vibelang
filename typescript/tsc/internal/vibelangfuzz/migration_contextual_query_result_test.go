package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const contextualQueryTarget = "FuzzMigrationContextualQueryResult"

func TestMigrationContextualQueryResultQuoted(t *testing.T) {
	chapterSays(t, "../vips/0003-effect-type-shorthand.md", "\x60A!E!R\x60 expands to \x60Effect.Effect<A, E, R>\x60")

	chapterSays(t, "001-functions.md", "An effect function's annotation means the same as the annotation on its Effect TypeScript twin.")
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
}

func contextualQueryFiles(t testing.TB, key string, mode uint8, native bool) map[string]string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "opencode-contextual-query-result.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture map[string]string
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for name, text := range fixture {
		if key == "written" || !native {
			expansion := "Effect.Effect<A, H[\"error\"], H[\"context\"]>"
			// VIP-3 expands through the real Effect binding. Renaming that
			// import leaves shorthand using the prelude's root Effect namespace.
			if !native && key == "shorthand" && mode&1 != 0 && strings.Contains(text, "A!H[\"error\"]!H[\"context\"]") {
				expansion = "Contract.Effect<A, H[\"error\"], H[\"context\"]>"
				text = "import { Effect as Contract } from \"effect\";\n" + text
			}
			text = strings.ReplaceAll(text, "A!H[\"error\"]!H[\"context\"]", expansion)
		}
		if mode&1 != 0 {
			text = strings.ReplaceAll(text, "* as Effect", "* as Fx")
			text = strings.ReplaceAll(text, "Effect.Effect", "Fx.Effect")
		}
		if mode&2 != 0 {
			text = strings.ReplaceAll(text, "\n", "\r\n")
		}
		if mode&4 != 0 {
			text = strings.ReplaceAll(text, "T = unknown", "T = string")
		}
		if mode&8 != 0 {
			text = strings.ReplaceAll(text, "sql => this.session.all(sql)", "(sql) => { return this.session.all(sql); }")
		}
		if !native {
			name = strings.ReplaceAll(name, ".vibe", ".ts")
			text = strings.ReplaceAll(text, "./raw.vibe", "./raw.js")
			text = strings.ReplaceAll(text, "./session.vibe", "./session.js")
		}
		files[name] = text
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
		t.Fatal(err)
	}
	options := config["compilerOptions"].(map[string]any)
	options["allowImportingTsExtensions"] = true
	options["rewriteRelativeImportExtensions"] = true
	options["allowArbitraryExtensions"] = true
	config["include"] = []string{"*.ts", "*.vibe"}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	files["tsconfig.json"] = string(encoded)
	return files
}

func checkContextualQueryResult(t *testing.T, w *Workspace, key string, mode uint8) {
	t.Helper()
	TestMigrationContextualQueryResultQuoted(t)
	referenceFiles := contextualQueryFiles(t, key, mode, false)
	reference := toolsCompile(t, w, contextualQueryTarget, referenceFiles)
	defer reference.Remove()
	if !toolsErrorFree(reference) {
		t.Fatalf("invalid TypeScript twin: %v\n%s", SortedKeys(Keys(reference.Dir, reference.Diagnostics)), Archive(referenceFiles))
	}
	native := contextualQueryFiles(t, key, mode, true)
	actual := toolsCompile(t, w, contextualQueryTarget, native)
	defer actual.Remove()
	if !toolsErrorFree(actual) {
		Gap(t, contextualQueryTarget, "compile:"+key, "the typed contextual callback keeps the generic result through the Effect contract: %v\n%s", SortedKeys(Keys(actual.Dir, actual.Diagnostics)), Archive(native))
	}
	dirs := []string{t.TempDir(), t.TempDir()}
	for i, outputs := range []map[string]string{reference.Outputs, actual.Outputs} {
		for name, text := range outputs {
			if isDeclaration(name) {
				if err := writeInside(dirs[i], name, text); err != nil {
					t.Fatal(err)
				}
			}
		}
		for name, text := range native {
			if strings.HasPrefix(name, "node_modules/") {
				if err := writeInside(dirs[i], name, text); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	if diff := compareDeclarationTrees(t, dirs[0], dirs[1]); diff != "" {
		Gap(t, contextualQueryTarget, "declaration:"+key, "the generic query result is API-identical to the TypeScript twin\n%s\n%s", diff, Archive(native))
	}
	ExpectPending(t, contextualQueryTarget, "compile:"+key)
	ExpectPending(t, contextualQueryTarget, "declaration:"+key)
	ExpectPending(t, contextualQueryTarget, specCorpusKey(t))
}

func TestMigrationContextualQueryResultStockTwin(t *testing.T) {
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	dir := emitDeclarationIdentityStock(t, w, tsc, Project{Files: contextualQueryFiles(t, "shorthand", 0, false), Config: DefaultConfig})
	defer os.RemoveAll(dir)
}
func FuzzMigrationContextualQueryResult(f *testing.F) {
	startShortBudget(f)
	f.Add("written", uint8(15))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains([]string{"shorthand", "written"}, key) {
			key = "shorthand"
		}
		checkContextualQueryResult(t, w, key, mode&15)
	})
}
func TestMigrationContextualQueryResultNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("extended matrix runs without -short")
	}
	w := NewWorkspace(t)
	for _, key := range []string{"shorthand", "written"} {
		for mode := range 16 {
			t.Run(key+"/"+strconv.Itoa(mode), func(t *testing.T) { checkContextualQueryResult(t, w, key, uint8(mode)) })
		}
	}
}
