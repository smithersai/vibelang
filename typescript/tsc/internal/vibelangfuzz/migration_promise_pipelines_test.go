package vibelangfuzz

import (
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
