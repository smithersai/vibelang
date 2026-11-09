package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const doTemporaryTarget = "FuzzMigrationDoTemporaryReturns"

func TestMigrationDoTemporaryReturnsQuoted(t *testing.T) {
	r4Quoted(t, "001-functions.md", migrationPlainQuote)
	r4Quoted(t, "../../../.smithers/flows/migrate/rules.md", migrationHomeQuote)
}

// This is a static migration-verifier oracle over actual compiler output.
// Preserved local returns and genuinely dropped programs stay distinct.
func FuzzMigrationDoTemporaryReturns(f *testing.F) {
	startShortBudget(f)
	keys := []string{"do-temporary", "do-alias", "do-parenthesized", "do-conditional", "local", "direct", "drop-direct", "drop-local"}
	for _, key := range keys {
		for mode := uint8(0); mode < 2; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationDoTemporaryReturnsQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		namespace := "Effect"
		if mode&1 != 0 {
			namespace = "E"
		}
		head := "import * as " + namespace + " from \"effect/Effect\";\nlet built = 0, ran = 0;\n"
		tail := "\nexport const state = () => [built, ran];\n"
		program := namespace + ".sync(() => { ran++; return stamp; })"
		original := head + "export function build() { const stamp = ++built; return " + program + "; }\n" + tail
		start := "const stamp = ++built; "
		body := "return do { " + start + "const program = " + program + "; effect { return try program; } };"
		switch key {
		case "do-alias":
			body = "return do { " + start + "const first = " + program + "; const program = first; effect { return try program; } };"
		case "do-parenthesized":
			body = "return (do { " + start + "const program = " + program + "; effect { return try program; } });"
		case "do-conditional":
			body = "return do { " + start + "const program = stamp > 0 ? " + program + " : " + program + "; effect { return try program; } };"
		case "local":
			body = start + "const program = " + program + "; return program;"
		case "direct":
			body = start + "return " + program + ";"
		case "drop-direct":
			body = start + "return stamp;"
		case "drop-local":
			body = start + "const program = " + program + "; return stamp;"
		}
		native := head + "export function build() { " + body + " }\n" + tail
		if key == "do-temporary" && mode&1 == 0 {
			for name, target := range map[string]*string{"t3code-do-temporary-return.ts": &original, "t3code-do-temporary-return.vibe": &native} {
				text, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", name))
				if err != nil {
					t.Fatal(err)
				}
				*target = string(text)
			}
		}
		if mode&2 != 0 {
			original = strings.ReplaceAll(original, "\n", "\r\n")
			native = strings.ReplaceAll(native, "\n", "\r\n")
		}
		before := toolsCompile(t, w, doTemporaryTarget, map[string]string{"main.ts": original})
		defer before.Remove()
		after := toolsCompile(t, w, doTemporaryTarget, map[string]string{"main.vibe": native})
		defer after.Remove()
		for _, r := range []*Result{before, after} {
			if HasError(r.Diagnostics) {
				t.Fatalf("invalid migration input: %v\n%s", SortedKeys(Keys(r.Dir, r.Diagnostics)), Archive(r.Sources))
			}
		}
		emitted, ok := after.Outputs["out/main.js"]
		if !ok {
			t.Fatal("native JavaScript output is missing")
		}
		expectedFlag := strings.HasPrefix(key, "drop-")
		input, err := json.Marshal(map[string]any{"original": original, "emitted": emitted, "expectedFlag": expectedFlag})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_do_temporary_returns.mjs"))
		cmd.Dir = Root()
		cmd.Stdin = strings.NewReader(string(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("static returned-program oracle: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var record struct {
			OK bool `json:"ok"`
		}
		if err := json.Unmarshal(output, &record); err != nil {
			t.Fatalf("invalid returned-program oracle result: %v\n%s", err, output)
		}
		gapKey := "return:" + key + "/" + namespace
		if !record.OK {
			Gap(t, doTemporaryTarget, gapKey, "Chapter 1: %q; returned programs remain programs through locals and do temporaries; genuinely dropped programs must still reject\n%s", migrationPlainQuote, output)
		}
		ExpectPending(t, doTemporaryTarget, gapKey)
		ExpectPending(t, doTemporaryTarget, specCorpusKey(t))
	})
}
