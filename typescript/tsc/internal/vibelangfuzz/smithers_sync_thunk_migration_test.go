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

const syncThunkRefusalQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestSyncThunkMigrationQuoted(t *testing.T) {
	for _, quote := range []string{syncThunkRefusalQuote, nestedPipeFixQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("thunk migration rule changed: %q", quote)
		}
	}
}

// `Effect.sync` with a block thunk stays as written: an effect block or
// function of it would be built with Effect.gen or Effect.fnUntraced where the
// source built Effect.sync, which the migration's run-phase check counts
// (Smithers' testing RecordingModel: `Stream.onEnd(Effect.sync(() => { exhausted
// = true }))`). A thunk of one value still becomes an effect block, which is
// built with Effect.sync. Keys are thunk:position; the repaired file
// type-checks and is a fixed point.
var syncThunkBodies = map[string]string{
	"assign": "{ done = n > 0 }",
	"branch": "{\n    if (n > 0) return 1\n    return 2\n  }",
	"locals": "{\n    const twice = n * 2\n    return twice + 1\n  }",
	"value":  "n + 1",
	"object": "({ n })",
}

func FuzzSyncThunkMigration(f *testing.F) {
	startShortBudget(f)
	var keys []string
	for _, body := range []string{"assign", "branch", "locals", "value", "object"} {
		for _, position := range []string{"held", "returned", "run"} {
			keys = append(keys, body+":"+position)
		}
	}
	for _, key := range []string{"assign:held", "assign:returned", "assign:run", "branch:returned", "locals:run", "value:returned", "object:held"} {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestSyncThunkMigrationQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		parts := strings.Split(key, ":")
		thunk := "Effect.sync(() => " + syncThunkBodies[parts[0]] + ")"
		var declaration string
		switch parts[1] {
		case "held":
			declaration = "const n = 3\nexport const held = " + thunk + ";\n"
		case "returned":
			declaration = "export const returned = (n: number) => " + thunk + ";\n"
		case "run":
			declaration = "export const run = (n: number) => Effect.gen(function* () {\n  const result = yield* " + thunk + ";\n  return result;\n});\n"
		}
		source := fmt.Sprintf("import * as Effect from \"effect/Effect\";\nlet done = false;\nexport const read = () => done;\n%s", declaration)
		before := toolsCompile(t, w, "FuzzSyncThunkMigration", map[string]string{"main.vibe": source})
		defer before.Remove()
		var result *vibelang.FixResult
		toolsRun(t, "FuzzSyncThunkMigration", key, Archive(map[string]string{"main.vibe": source}), nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, "FuzzSyncThunkMigration", key+":fix", "%v", result.Err)
			return
		}
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		after := toolsCompile(t, w, "FuzzSyncThunkMigration", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		checked := toolsProgram(w, after.Dir)
		file := checked.GetSourceFile(toolsFileName(after.Dir, "main.vibe"))
		for _, diagnostic := range append(checked.GetSyntacticDiagnostics(t.Context(), file), checked.GetSemanticDiagnostics(t.Context(), file)...) {
			if diagnostic.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzSyncThunkMigration", key+":types", "%s\n%s", diagnostic.String(), fixed)
				return
			}
		}
		block := strings.HasPrefix(syncThunkBodies[parts[0]], "{")
		if kept := strings.Contains(fixed, "Effect.sync(() => {"); kept != block {
			Gap(t, "FuzzSyncThunkMigration", key+":sync", "block thunk %t, Effect.sync kept %t\n%s", block, kept, fixed)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, "FuzzSyncThunkMigration", key+":idempotence", "err=%v changed=%d refused=%v", again.Err, len(again.Files), again.Refused)
		}
	})
}
