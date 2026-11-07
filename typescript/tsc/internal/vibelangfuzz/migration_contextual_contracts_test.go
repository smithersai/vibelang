package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const contextualContractTarget = "FuzzMigrationContextualContracts"
const contextualContractQuote = "each export's type identical to `tsc`'s in both directions (a type-level check)"

var contextualContractForms = []string{"satisfies", "returned", "generic", "written-control", "direct-control"}

func TestMigrationContextualContractsQuoted(t *testing.T) {
	TestMigrationDeclarationFixQuoted(t)
	if !strings.Contains(SpecText("001-functions.md"), contextualContractQuote) {
		t.Fatalf("Chapter 1 no longer says %q", contextualContractQuote)
	}
}

func contextualContractSource(tb testing.TB, form string, mode int) string {
	tb.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "corpus", "opencode-contextual-factory-requirements.ts"))
	if err != nil {
		tb.Fatal(err)
	}
	source := string(data)
	prefix, _, ok := strings.Cut(source, "export const plugin")
	if !ok {
		tb.Fatal("missing minimized factory")
	}
	body := "Effect.fn(\"Plugin\")(function* (ctx: string) { yield* Model; })"
	if mode&4 != 0 {
		body = "Effect.fn(function* (ctx: string) { yield* Model; yield* Effect.void; })"
	}
	object := "{ effect: " + body + " }"
	wide := "Plugin<Scope.Scope | Model | Other>"
	switch form {
	case "returned":
		source = prefix + "export function make() { return define(" + object + " satisfies " + wide + "); }\n"
	case "generic":
		source = prefix + "export function make<T>(value: T) { void value; return define(" + object + " satisfies " + wide + "); }\n"
	case "written-control":
		source = prefix + "export const plugin: " + wide + " = define(" + object + ");\n"
	case "direct-control":
		source = prefix + "export const plugin = define(" + object + ");\n"
	default:
		source = prefix + "export const plugin = define(" + object + " satisfies " + wide + ");\n"
	}
	if mode&1 != 0 {
		source = strings.ReplaceAll(source, "{ Context, Effect, Scope }", "{ Context, Effect as Fx, Scope }")
		source = strings.ReplaceAll(source, "Effect.", "Fx.")
	}
	if mode&8 != 0 {
		source = strings.ReplaceAll(source, "export ", "/** Public factory. */\nexport ")
	}
	if mode&2 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source
}

func checkContextualContract(t *testing.T, w *Workspace, form string, mode int, source string) {
	t.Helper()
	TestMigrationContextualContractsQuoted(t)
	toolsGuard(t, contextualContractTarget, func() {
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, contextualContractTarget, files)
		defer before.Remove()
		if !toolsErrorFree(before) {
			t.Fatalf("invalid original factory: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), source)
		}
		config := toolsConfig(w, before.Dir)
		if before.Program == nil || config == nil || len(config.Errors) != 0 {
			t.Fatal("factory does not form a valid project")
		}
		var result *vibelang.FixResult
		toolsRun(t, contextualContractTarget, "fix", source, nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, contextualContractTarget, "converge:"+form, "Chapter 7: %q; fix failed: %v\n%s", migrationDeclarationFixQuote, result.Err, source)
		}
		fixed := maps.Clone(files)
		for path, file := range result.Files {
			rel := strings.TrimPrefix(path.AsString(), filepath.ToSlash(before.Dir)+"/")
			if _, own := files[rel]; !own {
				t.Fatalf("factory repair changed an unowned source: %s", rel)
			}
			fixed[rel] = file.Text
		}
		after := toolsCompile(t, w, contextualContractTarget, fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, contextualContractTarget, "compile:"+form, "Chapter 7: %q; new errors: %v\n%s", migrationDeclarationFixQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(fixed))
		}
		flavor := "named"
		if mode&4 != 0 {
			flavor = "unnamed"
		}
		key := "declaration:" + form + ":" + flavor
		if diff := compareDeclarationOutputs(t, before.Outputs, after.Outputs); diff != "" {
			Gap(t, contextualContractTarget, key, "Chapter 1: %q; Chapter 7: %q\n%s\noriginal:\n%s\nfixed:\n%s", contextualContractQuote, migrationDeclarationFixQuote, diff, source, Archive(fixed))
		}
		ExpectPending(t, contextualContractTarget, key)
		ExpectPending(t, contextualContractTarget, specCorpusKey(t))
	})
}

func TestMigrationContextualContractsCorpus(t *testing.T) {
	w := NewWorkspace(t)
	api := declarationIdentityAPI(t)
	source := contextualContractSource(t, "satisfies", 0)
	var child *testing.T
	t.Run("stock-twin", func(t *testing.T) {
		child = t
		CheckDeclarationIdentity(t, w, StockTypeScript(t), api, Archive(map[string]string{"main.ts": source}))
	})
	if child.Skipped() {
		t.Fatal("valid contextual factory stock twin was not admitted")
	}
	checkContextualContract(t, w, "satisfies", 0, source)
}

func TestMigrationContextualContractOracleControls(t *testing.T) {
	original := "export declare const plugin: { effect: (ctx: string) => { readonly requirements: \"model\" } };\n"
	changed := strings.ReplaceAll(original, "\"model\"", "\"model\" | \"other\"")
	if diff := compareDeclarationOutputs(t, map[string]string{"main.d.ts": original}, map[string]string{"main.d.ts": changed}); diff == "" {
		t.Fatal("API oracle accepted widened requirements")
	}
}

func FuzzMigrationContextualContracts(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"context:satisfies:4", "context:satisfies:0", "context:satisfies:15", "context:returned:0", "context:returned:15", "context:generic:10", "context:generic:15", "context:written-control:3", "context:direct-control:0"} {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		form, mode := contextualContractForms[0], 0
		parts := strings.Split(string(data), ":")
		if len(parts) == 3 && parts[0] == "context" {
			for _, known := range contextualContractForms {
				if parts[1] == known {
					form = known
				}
			}
			value, err := strconv.ParseUint(parts[2], 10, 8)
			if err == nil {
				mode = int(value) % 16
			}
		} else if len(data) > 0 {
			form = contextualContractForms[int(data[0])%len(contextualContractForms)]
			if len(data) > 1 {
				mode = int(data[1]) % 16
			}
		}
		checkContextualContract(t, w, form, mode, contextualContractSource(t, form, mode))
	})
}
