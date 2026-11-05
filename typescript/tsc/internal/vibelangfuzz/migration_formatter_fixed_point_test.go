package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangestree"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const migrationFormatterTarget = "FuzzMigrationFormatterFixedPoint"
const migrationFormatterQuote = "An unparsable file is reported and left unchanged; formatting is idempotent."
const migrationFormatterMeaningQuote = "Under the same compiler/options, formatting preserves parsed program meaning:"

func TestMigrationFormatterFixedPointQuoted(t *testing.T) {
	r4Quoted(t, "007-tooling.md", migrationFormatterQuote)
	r4Quoted(t, "007-tooling.md", migrationFormatterMeaningQuote)
}

// Exercise the shipped process plugin, including its TypeScript backend and
// convergence limit. The in-process editor formatter has a different backend.
func FuzzMigrationFormatterFixedPoint(f *testing.F) {
	startShortBudget(f)
	keys := []string{"original", "without-pipe", "without-blocks", "wrapped-pipe", "block-arrow", "comment", "crlf", "effect-functions"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Add("original", uint8(1))
	f.Add("original", uint8(4))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationFormatterFixedPointQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "alchemy-formatter-native-layout.vibe"))
		if err != nil {
			t.Fatal(err)
		}
		source := string(raw)
		switch key {
		case "without-pipe":
			source = strings.Replace(source, "yield* create(createRequest)\n              |> Effect.catchTag(%,", "yield* Effect.catchTag(create(createRequest),", 1)
			source = strings.Replace(source, "yield* analytics\n            .listTagsForResource({  })|> Effect.catchTag(%,", "yield* Effect.catchTag(analytics.listTagsForResource({  }),", 1)
		case "without-blocks":
			source = strings.ReplaceAll(source, "effect {", "Effect.gen(function* () {")
			source = strings.ReplaceAll(source, "};", "});")
		case "wrapped-pipe":
			source = strings.Replace(source, "yield* create(createRequest)", "yield* (create(createRequest)", 1)
			source = strings.Replace(source, "              );", "              ));", 1)
			source = strings.Replace(source, "yield* analytics", "yield* (analytics", 1)
			source = strings.Replace(source, "() => Effect.undefined);", "() => Effect.undefined));", 1)
		case "block-arrow":
			source = strings.Replace(source, "export const ApplicationProvider = () =>\n", "export const ApplicationProvider = () => {\n  return ", 1) + "}\n"
		case "comment":
			source = "// provider layout\n" + strings.ReplaceAll(source, "const sync", "/* cold program */ const sync")
		case "crlf":
			source = strings.ReplaceAll(source, "\n", "\r\n")
		case "effect-functions":
			source = strings.ReplaceAll(source, "= effect {", "= effect () => {")
		}
		if _, failure := vibelangestree.Parse("Application.vibe", source); failure != nil {
			t.Fatalf("invalid generated syntax for %s: %v\n%s", key, failure, source)
		}
		width := []int{120, 80, 160}[int(mode&3)%3]
		quote := "alwaysDouble"
		if mode&4 != 0 {
			quote = "alwaysSingle"
		}
		input, err := json.Marshal(map[string]any{"source": source, "style": map[string]any{"quoteStyle": quote, "lineWidth": width}})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_formatter_fixed_point.mjs"))
		cmd.Dir = Root()
		cmd.Stdin = strings.NewReader(string(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("formatter oracle process: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct {
			OK                        bool
			Once, Twice, Stage, Error string
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid formatter result: %v\n%s", err, output)
		}
		gapKey := fmt.Sprintf("layout:%s/%d/%s", key, width, quote)
		if !result.OK {
			Gap(t, migrationFormatterTarget, gapKey, "Chapter 7: %q; stage=%s: %s\n%s", migrationFormatterQuote, result.Stage, result.Error, source)
		}
		for _, formatted := range []string{result.Once, result.Twice} {
			if _, failure := vibelangestree.Parse("Application.vibe", formatted); failure != nil {
				t.Fatalf("formatted syntax: %v", failure)
			}
			if err := vibelangfmt.SameProgram(source, formatted); err != nil {
				Gap(t, migrationFormatterTarget, "meaning:"+gapKey, "Chapter 7: %q; %v", migrationFormatterMeaningQuote, err)
			}
		}
		ExpectPending(t, migrationFormatterTarget, gapKey)
		ExpectPending(t, migrationFormatterTarget, specCorpusKey(t))
	})
}
