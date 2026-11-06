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

const nestedPipeFixQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."
const nestedPipeParseQuote = "Quick fixes and codemods use the formatter to preserve the parse under Appendix A."

func TestAlchemyNestedPipeMigrationQuoted(t *testing.T) {
	for _, quote := range []string{nestedPipeFixQuote, nestedPipeParseQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("pipeline migration rule changed: %q", quote)
		}
	}
}

// The minimized paginated-upload pattern varies nested pipes in a captured
// receiver, in a stage callback and in a held program. This is a static
// rewrite/parse/fixed-point oracle; runtime semantics use FuzzVIPDifferential.
func FuzzAlchemyNestedPipeMigration(f *testing.F) {
	startShortBudget(f)
	keys := []string{"receiver", "stage-callback", "held-program", "paginate"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestAlchemyNestedPipeMigrationQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		expression := ""
		switch key {
		case "receiver":
			expression = "Effect.succeed(1).pipe(Effect.map((n: number) => n + 1)).pipe((p: Effect.Effect<number>) => p, Effect.asVoid)"
		case "stage-callback", "held-program":
			expression = "Effect.succeed(1).pipe((p: Effect.Effect<number>) => p, Effect.flatMap((n: number) => Effect.succeed(n).pipe(Effect.map((x: number) => x + 1))))"
		case "paginate":
			expression = "Stream.paginate(0, (n: number) => Effect.succeed(n).pipe(Effect.map((page: number) => [[page], Option.none<number>()] as const))).pipe(Stream.filter((n: number): n is number => n > 0), Stream.mapEffect((n: number) => Effect.succeed(n).pipe(Effect.asVoid)), Stream.runCount, Effect.provide(Layer.empty))"
		}
		body := "const value = yield* " + expression + ";\nreturn value;"
		if key == "held-program" {
			body = "const program = " + expression + ";\nconst value = yield* program;\nreturn value;"
		}
		source := fmt.Sprintf("import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nimport * as Option from \"effect/Option\";\nimport * as Layer from \"effect/Layer\";\nexport const run = Effect.fn(\"run\")(function* () {\n%s\n});\n", body)
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "\n", "\n  ")
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		before := toolsCompile(t, w, "FuzzAlchemyNestedPipeMigration", map[string]string{"main.vibe": source})
		defer before.Remove()
		var result *vibelang.FixResult
		toolsRun(t, "FuzzAlchemyNestedPipeMigration", key, Archive(map[string]string{"main.vibe": source}), nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, "FuzzAlchemyNestedPipeMigration", key+":fix", "%v", result.Err)
			return
		}
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		after := toolsCompile(t, w, "FuzzAlchemyNestedPipeMigration", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		program := toolsProgram(w, after.Dir)
		file := program.GetSourceFile(toolsFileName(after.Dir, "main.vibe"))
		for _, diagnostic := range program.GetSyntacticDiagnostics(t.Context(), file) {
			if diagnostic.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzAlchemyNestedPipeMigration", key+":parse", "%s\n%s", diagnostic.String(), fixed)
				return
			}
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, "FuzzAlchemyNestedPipeMigration", key+":idempotence", "err=%v changed=%d refused=%v", again.Err, len(again.Files), again.Refused)
		}
	})
}
