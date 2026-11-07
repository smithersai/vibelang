package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const promisePipelineQuote = "Generator repairs preserve nested pipeline edits when an outer pipeline captures its receiver and stages."

// The oracle is the existing Chapter 7 declaration-preservation oracle. This
// target varies Promise-returning boundaries around a generator rather than
// adding a runtime comparison; runtime equivalence stays in FuzzVIPDifferential.
func TestMigrationPromisePipelinesQuoted(t *testing.T) {
	TestMigrationDeclarationFixQuoted(t)
	if !strings.Contains(SpecText("007-tooling.md"), promisePipelineQuote) {
		t.Fatalf("Chapter 7 no longer says %q", promisePipelineQuote)
	}
}

type promisePipelineModel struct {
	annotation, wrapper, stages, imports, layout string
}

func parsePromisePipeline(data []byte) promisePipelineModel {
	choices := [][]string{
		{"written", "inferred"},
		{"arrow", "function", "held"},
		{"scoped", "mapped", "plain"},
		{"namespace", "named"},
		{"lf", "crlf"},
	}
	parts := strings.Split(strings.TrimPrefix(string(data), "promise-pipeline:"), ":")
	picked := make([]string, len(choices))
	for i, values := range choices {
		picked[i] = values[0]
		if strings.HasPrefix(string(data), "promise-pipeline:") && i < len(parts) {
			for _, value := range values {
				if parts[i] == value {
					picked[i] = value
				}
			}
		} else if i < len(data) {
			picked[i] = values[int(data[i])%len(values)]
		}
	}
	return promisePipelineModel{picked[0], picked[1], picked[2], picked[3], picked[4]}
}

func (m promisePipelineModel) source() string {
	prefix := "import * as Effect from \"effect/Effect\";\n"
	if m.imports == "named" {
		prefix = "import { Effect } from \"effect\";\n"
	}
	annotation := ""
	if m.annotation == "written" {
		annotation = ": Promise<void>"
	}
	stages := "Effect.scoped, Effect.runPromise"
	if m.stages == "mapped" {
		stages = "Effect.scoped, Effect.map(() => undefined), Effect.runPromise"
	} else if m.stages == "plain" {
		stages = "Effect.runPromise"
	}
	program := "Effect.gen(function* () { yield* Effect.void; }).pipe(" + stages + ")"
	var body string
	switch m.wrapper {
	case "function":
		body = "export function bootstrap()" + annotation + " { return " + program + "; }\n"
	case "held":
		body = "export const bootstrap = ()" + annotation + " => { const program = " + program + "; return program; };\n"
	default:
		body = "export const bootstrap = ()" + annotation + " => " + program + ";\n"
	}
	source := prefix + body
	if m.layout == "crlf" {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source
}

func checkPromisePipeline(t *testing.T, w *Workspace, api, source string) {
	t.Helper()
	var child *testing.T
	t.Run("declaration-preservation", func(t *testing.T) {
		child = t
		checkMigrationDeclarationFix(t, w, api, Archive(map[string]string{"main.vibe": source}))
	})
	// Unlike arbitrary archive mutations, all model inputs are valid sources.
	// A missing declaration or rejected original cannot silently shrink coverage.
	if child.Skipped() {
		t.Fatal("valid Promise pipeline was not admitted")
	}
}

func TestMigrationPromisePipelineCorpus(t *testing.T) {
	TestMigrationPromisePipelinesQuoted(t)
	data, err := os.ReadFile(filepath.Join("testdata", "corpus", "alchemy-promise-scoped-generator.ts"))
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorkspace(t)
	api := declarationIdentityAPI(t)
	var stock *testing.T
	t.Run("stock-twin", func(t *testing.T) {
		stock = t
		CheckDeclarationIdentity(t, w, StockTypeScript(t), api, Archive(map[string]string{"main.ts": string(data)}))
	})
	if stock.Skipped() {
		t.Fatal("original Promise-returning stock twin was not admitted")
	}
	checkPromisePipeline(t, w, api, string(data))
}

// Knock out the Promise boundary independently of source printing and fixing.
// Both a changed result and a changed export must fail the canonical API gate.
func TestMigrationPromisePipelineOracleControls(t *testing.T) {
	original := map[string]string{"main.d.ts": "export declare const bootstrap: () => Promise<void>;\n"}
	for _, source := range []string{
		"export declare const bootstrap: () => void;\n",
		"export declare const bootstrap: () => Promise<number>;\n",
		"export declare const renamed: () => Promise<void>;\n",
	} {
		if diff := compareDeclarationOutputs(t, original, map[string]string{"main.d.ts": source}); diff == "" {
			t.Fatalf("API oracle accepted a changed Promise contract: %s", source)
		}
	}
}

func FuzzMigrationPromisePipelines(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{
		"promise-pipeline:written:arrow:scoped:namespace:lf",
		"promise-pipeline:inferred:function:mapped:named:crlf",
		"promise-pipeline:written:held:plain:named:lf",
		"promise-pipeline:inferred:held:scoped:namespace:crlf",
	} {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	api := declarationIdentityAPI(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestMigrationPromisePipelinesQuoted(t)
		checkPromisePipeline(t, w, api, parsePromisePipeline(data).source())
	})
}
