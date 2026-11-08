package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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

func TestMigrationContextualContractOracleControls(t *testing.T) {
	original := "export declare const plugin: { effect: (ctx: string) => { readonly requirements: \"model\" } };\n"
	changed := strings.ReplaceAll(original, "\"model\"", "\"model\" | \"other\"")
	if diff := compareDeclarationOutputs(t, map[string]string{"main.d.ts": original}, map[string]string{"main.d.ts": changed}); diff == "" {
		t.Fatal("API oracle accepted widened requirements")
	}
}
