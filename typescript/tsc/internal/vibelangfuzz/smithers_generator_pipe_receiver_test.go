package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Smithers' GitHub modules return `Effect.gen(...).pipe(Effect.withSpan(name,
// attributes(arg)))` from a function. A stage whose options are built by a
// call makes the fix capture the pipe, and the generator, its receiver, is
// rewritten inside that capture. Keys are stages:form. The oracle is static:
// the repaired file parses, type-checks, holds no generator and is a fixed
// point.
const generatorReceiverCaptureQuote = "Generator repairs preserve nested pipeline edits when an outer pipeline captures its receiver and stages."

func TestGeneratorPipeReceiverMigrationQuoted(t *testing.T) {
	for _, quote := range []string{generatorReceiverCaptureQuote, nestedPipeFixQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("pipeline migration rule changed: %q", quote)
		}
	}
}

var generatorReceiverStages = map[string]string{
	"span-call":        `Effect.withSpan("named", attributes(name))`,
	"span-plain":       `Effect.withSpan("named", { attributes: { name } })`,
	"span-call-asvoid": `Effect.withSpan("named", attributes(name)), Effect.asVoid`,
	"custom":           `traced`,
	"custom-span":      `traced, Effect.withSpan("named", attributes(name))`,
	"map":              `Effect.map((value) => (value.length > 0 ? value : undefined))`,
	// A custom stage captures the pipe; the library stages after it take the
	// program first in place, so their callbacks keep its types.
	"custom-flatmap": `traced, Effect.flatMap((value) => Effect.succeed(value.length > 0 ? value : undefined))`,
	"custom-catch":   `traced, Effect.catch((error) => Effect.succeed(String(error)))`,
}

func generatorReceiverKeys() []string {
	var keys []string
	for _, stages := range []string{"span-call", "span-plain", "span-call-asvoid", "custom", "custom-span", "map", "custom-flatmap", "custom-catch"} {
		for _, form := range []string{"arrow", "block", "function"} {
			keys = append(keys, stages+":"+form)
		}
	}
	return keys
}

func FuzzGeneratorPipeReceiverMigration(f *testing.F) {
	startShortBudget(f)
	keys := generatorReceiverKeys()
	for _, key := range []string{"span-call:arrow", "span-call-asvoid:block", "custom-span:function", "span-plain:arrow", "map:block", "custom-flatmap:arrow", "custom-catch:function"} {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestGeneratorPipeReceiverMigrationQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		parts := strings.Split(key, ":")
		stages := generatorReceiverStages[parts[0]]
		helpers := ""
		if strings.Contains(stages, "attributes(") {
			helpers += "const attributes = (name: string) => ({ attributes: { name } });\n"
		}
		if strings.Contains(stages, "traced") {
			helpers += "const traced = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => program;\n"
		}
		program := "Effect.gen(function* () {\n    const value = yield* Effect.succeed(name);\n    return value;\n  }).pipe(" + stages + ")"
		var declaration string
		switch parts[1] {
		case "arrow":
			declaration = "export const named = (name: string): Effect.Effect<string | void> =>\n  " + program + ";\n"
		case "block":
			declaration = "export const named = (name: string): Effect.Effect<string | void> => {\n  return " + program + ";\n};\n"
		case "function":
			declaration = "export function named(name: string): Effect.Effect<string | void> {\n  return " + program + ";\n}\n"
		}
		source := fmt.Sprintf("import * as Effect from \"effect/Effect\";\n%s%s", helpers, declaration)
		before := toolsCompile(t, w, "FuzzGeneratorPipeReceiverMigration", map[string]string{"main.vibe": source})
		defer before.Remove()
		var result *vibelang.FixResult
		toolsRun(t, "FuzzGeneratorPipeReceiverMigration", key, Archive(map[string]string{"main.vibe": source}), nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, "FuzzGeneratorPipeReceiverMigration", key+":fix", "%v", result.Err)
			return
		}
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		after := toolsCompile(t, w, "FuzzGeneratorPipeReceiverMigration", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		checked := toolsProgram(w, after.Dir)
		file := checked.GetSourceFile(toolsFileName(after.Dir, "main.vibe"))
		for _, diagnostic := range append(checked.GetSyntacticDiagnostics(t.Context(), file), checked.GetSemanticDiagnostics(t.Context(), file)...) {
			if diagnostic.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzGeneratorPipeReceiverMigration", key+":types", "%s\n%s", diagnostic.String(), fixed)
				return
			}
		}
		if strings.Contains(fixed, "Effect.gen(") {
			Gap(t, "FuzzGeneratorPipeReceiverMigration", key+":generator", "refused=%v\n%s", result.Refused, fixed)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, "FuzzGeneratorPipeReceiverMigration", key+":idempotence", "err=%v changed=%d refused=%v", again.Err, len(again.Files), again.Refused)
		}
	})
}
