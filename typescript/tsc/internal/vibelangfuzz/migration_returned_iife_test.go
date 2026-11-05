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

const returnedIIFETarget = "FuzzMigrationReturnedIIFE"

func TestMigrationReturnedIIFEQuoted(t *testing.T) {
	r4Quoted(t, "001-functions.md", migrationPlainQuote)
	r4Quoted(t, "007-tooling.md", migrationHomeQuote)
}

// This is a static migration-verifier oracle over actual compiler output.
// Both preserved branches and real lost programs are checked; it adds no
// second runtime comparison or language-semantics generator.
func FuzzMigrationReturnedIIFE(f *testing.F) {
	startShortBudget(f)
	keys := []string{"branch", "reversed", "nested", "direct", "drop-success", "drop-failure"}
	for _, key := range keys {
		for mode := uint8(0); mode < 2; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationReturnedIIFEQuoted(t)
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
		head := "import * as " + namespace + " from \"effect/Effect\";\n"
		original := head + "export const make = (valid: boolean) => valid ? " + namespace + ".succeed(1) : " + namespace + ".fail(\"bad\");\n"
		body := "if (valid) { return effect { return 1 } } const error = \"bad\"; return effect { throw error }"
		switch key {
		case "reversed":
			original = head + "export const make = (valid: boolean) => valid ? " + namespace + ".fail(\"bad\") : " + namespace + ".succeed(1);\n"
			body = "if (!valid) { return effect { return 1 } } const error = \"bad\"; return effect { throw error }"
		case "nested":
			body = "if (valid) { return effect { return 1 } } { const error = \"bad\"; return effect { throw error } }"
		case "direct":
			body = "return valid ? " + namespace + ".succeed(1) : " + namespace + ".fail(\"bad\")"
		case "drop-success":
			body = "if (valid) { return 1 } const error = \"bad\"; return effect { throw error }"
		case "drop-failure":
			body = "if (valid) { return effect { return 1 } } const error = \"bad\"; return error"
		}
		native := head + "export const make = (valid: boolean) => { " + body + " }\n"
		if key == "branch" && mode&1 == 0 {
			for name, target := range map[string]*string{"t3code-returned-effect-iife.ts": &original, "t3code-returned-effect-iife.vibe": &native} {
				text, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", name))
				if err != nil {
					t.Fatal(err)
				}
				*target = string(text)
			}
		}
		before := toolsCompile(t, w, returnedIIFETarget, map[string]string{"main.ts": original})
		defer before.Remove()
		after := toolsCompile(t, w, returnedIIFETarget, map[string]string{"main.vibe": native})
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
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_returned_iife.mjs"))
		cmd.Dir = Root()
		cmd.Stdin = strings.NewReader(string(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("static returned-IIFE oracle: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var record struct {
			OK bool `json:"ok"`
		}
		if err := json.Unmarshal(output, &record); err != nil {
			t.Fatalf("invalid returned-IIFE oracle result: %v\n%s", err, output)
		}
		gapKey := "return:" + key + "/" + namespace
		if !record.OK {
			Gap(t, returnedIIFETarget, gapKey, "Chapter 1: %q; compiler-produced IIFEs retain their returned programs; real dropped branches must still reject\n%s", migrationPlainQuote, output)
		}
		ExpectPending(t, returnedIIFETarget, gapKey)
		ExpectPending(t, returnedIIFETarget, specCorpusKey(t))
	})
}
