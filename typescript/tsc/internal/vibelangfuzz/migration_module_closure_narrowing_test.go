package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestMigrationModuleClosureNarrowingQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "changes no diagnostic, type, emitted statement, declaration or run-time observation.")
	chapterSays(t, "007-tooling.md", "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.")
}

func FuzzMigrationModuleClosureNarrowing(f *testing.F) {
	startShortBudget(f)
	keys := []string{"closure", "nested", "async", "multiple", "direct", "shadow"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(15))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationModuleClosureNarrowingQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		t.Logf("module closure key=%s mode=%d", key, mode&15)
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_module_closure_narrowing.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("module-body source model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var model struct {
			File, Source, Ambient, Candidate string
			StockCodes                       []int
		}
		if err := json.Unmarshal(output, &model); err != nil {
			t.Fatalf("invalid module-body model: %v\n%s", err, output)
		}
		if len(model.StockCodes) != 0 {
			t.Fatalf("invalid stock TypeScript control: %s", output)
		}
		config := strings.Replace(DefaultConfig, "\"skipLibCheck\": true", "\"skipLibCheck\": true, \"lib\": [\"es2022\"], \"types\": []", 1)
		compile := func(file, text string) *Result {
			c, err := w.Compile(t.Context(), Project{Files: map[string]string{file: text, "ambient.d.ts": model.Ambient}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(c.Remove)
			return c
		}
		native := compile(model.File, model.Source)
		if HasError(native.Diagnostics) {
			t.Fatalf("native TypeScript control rejected: %v\n%s", SortedKeys(Keys(native.Dir, native.Diagnostics)), model.Source)
		}
		candidate := compile(strings.TrimSuffix(model.File, ".ts")+".vibe", model.Candidate)
		codes := map[int32]bool{}
		for _, d := range candidate.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes[d.Code()] = true
			}
		}
		if len(codes) > 0 {
			if len(codes) != 1 || !codes[18047] {
				t.Fatalf("unexpected module-body diagnostics: %v\n%s", SortedKeys(Keys(candidate.Dir, candidate.Diagnostics)), model.Candidate)
			}
			Gap(t, "FuzzMigrationModuleClosureNarrowing", "narrowing:"+key+":TS18047", "native TypeScript accepts the guarded immutable capture; the module-body split loses its narrowing\n%s", model.Candidate)
		}
		ExpectPending(t, "FuzzMigrationModuleClosureNarrowing", "narrowing:"+key+":TS18047")
		ExpectPending(t, "FuzzMigrationModuleClosureNarrowing", specCorpusKey(t))
	})
}
