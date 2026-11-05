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

const migrationJSXRouteTarget = "FuzzMigrationJSXRoutes"
const migrationJSXRouteQuote = "Renaming `x.tsx` to `x.vibex` changes nothing in its JSX"

const migrationJSXRouteKindsQuote = "`.vibex` is to `.vibe` what `.tsx` is to `.ts`:"

func TestMigrationJSXRoutesQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0039-vibex.md", migrationJSXRouteQuote)
	r4Quoted(t, "../vips/0039-vibex.md", migrationJSXRouteKindsQuote)
}

// The canonical migration preserves the JSX file kind. A refusal is distinct
// from a wrong suffix, so fixing admission cannot hide a route mismatch.
func FuzzMigrationJSXRoutes(f *testing.F) {
	startShortBudget(f)
	keys := []string{"jsx-basic", "jsx-nested", "jsx-dotted", "jsx-unicode", "plain-basic", "plain-nested"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationJSXRoutesQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		name := "Card"
		if mode&1 != 0 {
			name = "UserCard"
		}
		stem := name
		switch key {
		case "jsx-nested", "plain-nested":
			stem = "src/views/" + name
		case "jsx-dotted":
			stem = "src/" + name + ".story"
		case "jsx-unicode":
			stem = "views/é/" + name
		}
		jsx := strings.HasPrefix(key, "jsx-")
		extension, native := ".ts", ".vibe"
		if jsx {
			extension, native = ".tsx", ".vibex"
		}
		file, expected := stem+extension, stem+native
		if key == "jsx-basic" && mode&1 == 0 {
			raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "opencode-card-tsx-route.json"))
			if err != nil {
				t.Fatal(err)
			}
			var corpus struct{ File, Source, Expected, Quote string }
			if err := json.Unmarshal(raw, &corpus); err != nil {
				t.Fatal(err)
			}
			if corpus.Quote != migrationJSXRouteQuote || corpus.Source == "" || corpus.Expected != expected {
				t.Fatal("invalid keyed TSX corpus")
			}
			file = corpus.File
		}
		input, err := json.Marshal(map[string]string{"file": file})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_jsx_routes.mjs"))
		cmd.Dir = Root()
		cmd.Stdin = strings.NewReader(string(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("route oracle process: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct {
			Rejected     bool
			Value, Error string
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid route oracle: %v\n%s", err, output)
		}
		rejectKey := "reject:" + key
		if result.Rejected {
			Gap(t, migrationJSXRouteTarget, rejectKey, "VIP-39: %q; %s: %s", migrationJSXRouteQuote, file, result.Error)
		}
		if result.Value != expected {
			Gap(t, migrationJSXRouteTarget, "wrong-route:"+key, "VIP-39: %q; %s maps to %s, want %s", migrationJSXRouteQuote, file, result.Value, expected)
		}
		ExpectPending(t, migrationJSXRouteTarget, rejectKey)
		ExpectPending(t, migrationJSXRouteTarget, specCorpusKey(t))
	})
}
