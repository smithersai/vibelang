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

const streamRunnerPipeCaptureQuote = "Generator repairs preserve nested pipeline edits when an outer pipeline captures its receiver and stages."
const streamRunnerPipeRefusalQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestStreamRunnerPipeMigrationQuoted(t *testing.T) {
	for _, quote := range []string{streamRunnerPipeCaptureQuote, streamRunnerPipeRefusalQuote, nestedPipeFixQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("pipeline migration rule changed: %q", quote)
		}
	}
}

// Smithers' stores fork a stream's consumer from a generator:
// `yield* rows.pipe(Stream.runForEach((row) => ...), Effect.forkIn(scope))`.
// A stage named run… that builds an Effect needs no capture, so the generator
// converts and the callback keeps the stream's element type; captured alone it
// lost that type and the repair was refused. Keys are runner:before:after.
// The oracle is static: the repaired file parses, type-checks, holds no
// generator and is a fixed point.
var streamRunnerPipeRunners = map[string]string{
	"foreach": "Stream.runForEach((n) => Effect.log(n + 1))",
	"drain":   "Stream.runDrain",
	"head":    "Stream.runHead",
	"collect": "Stream.runCollect",
	"count":   "Stream.runCount",
}

var streamRunnerPipeBefore = map[string]string{
	"none":   "",
	"filter": "Stream.filter((n) => n > 1)",
	"map":    "Stream.map((n) => n * 2)",
	"take":   "Stream.take(2)",
}

var streamRunnerPipeAfter = map[string]string{
	"fork":   "Effect.forkIn(scope, { startImmediately: true })",
	"asvoid": "Effect.asVoid",
	"map":    "Effect.map((value) => value)",
}

func streamRunnerPipeKeys() []string {
	var keys []string
	for _, runner := range []string{"foreach", "drain", "head", "collect", "count"} {
		for _, before := range []string{"none", "filter", "map", "take"} {
			for _, after := range []string{"fork", "asvoid", "map"} {
				keys = append(keys, runner+":"+before+":"+after)
			}
		}
	}
	return keys
}

func FuzzStreamRunnerPipeMigration(f *testing.F) {
	startShortBudget(f)
	keys := streamRunnerPipeKeys()
	for _, key := range []string{"foreach:none:fork", "foreach:filter:fork", "drain:take:fork", "head:filter:fork", "collect:map:asvoid", "count:none:map"} {
		f.Add(key, uint8(0))
	}
	f.Add("foreach:map:fork", uint8(1))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestStreamRunnerPipeMigrationQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		parts := strings.Split(key, ":")
		stages := []string{}
		if before := streamRunnerPipeBefore[parts[1]]; before != "" {
			stages = append(stages, before)
		}
		stages = append(stages, streamRunnerPipeRunners[parts[0]], streamRunnerPipeAfter[parts[2]])
		receiver := "Stream.make(1, 2, 3)"
		if mode&1 != 0 {
			receiver = "numbers"
		}
		source := fmt.Sprintf("import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nconst numbers = Stream.make(1, 2, 3);\nexport const run = Effect.gen(function* () {\n  const scope = yield* Effect.scope;\n  yield* %s.pipe(\n    %s,\n  );\n  return numbers;\n});\n", receiver, strings.Join(stages, ",\n    "))
		before := toolsCompile(t, w, "FuzzStreamRunnerPipeMigration", map[string]string{"main.vibe": source})
		defer before.Remove()
		var result *vibelang.FixResult
		toolsRun(t, "FuzzStreamRunnerPipeMigration", key, Archive(map[string]string{"main.vibe": source}), nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, "FuzzStreamRunnerPipeMigration", key+":fix", "%v", result.Err)
			return
		}
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		after := toolsCompile(t, w, "FuzzStreamRunnerPipeMigration", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		program := toolsProgram(w, after.Dir)
		file := program.GetSourceFile(toolsFileName(after.Dir, "main.vibe"))
		for _, diagnostic := range program.GetSyntacticDiagnostics(t.Context(), file) {
			if diagnostic.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzStreamRunnerPipeMigration", key+":parse", "%s\n%s", diagnostic.String(), fixed)
				return
			}
		}
		for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
			if diagnostic.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzStreamRunnerPipeMigration", key+":types", "%s\n%s", diagnostic.String(), fixed)
				return
			}
		}
		if strings.Contains(fixed, "Effect.gen(") {
			Gap(t, "FuzzStreamRunnerPipeMigration", key+":generator", "refused=%v\n%s", result.Refused, fixed)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, "FuzzStreamRunnerPipeMigration", key+":idempotence", "err=%v changed=%d refused=%v", again.Err, len(again.Files), again.Refused)
		}
	})
}
