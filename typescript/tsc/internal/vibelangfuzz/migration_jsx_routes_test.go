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

const migrationJSXCandidateQuote = "`.tsx` becomes `.vibex`."

const migrationJSXRouteKindsQuote = "`.vibex` is to `.vibe` what `.tsx` is to `.ts`:"

func TestMigrationJSXRoutesQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0039-vibex.md", migrationJSXRouteQuote)
	r4Quoted(t, "../vips/0039-vibex.md", migrationJSXRouteKindsQuote)
	readme, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(readme), migrationJSXCandidateQuote) {
		t.Fatal("the documented migration candidate boundary changed; update the oracle")
	}
}

// VIP-39 defines the native JSX file kind. The flow separately documents
// which foreign modules it accepts: unsupported candidates stay unchanged.
func FuzzMigrationJSXRoutes(f *testing.F) {
	startShortBudget(f)
	keys := []string{"jsx-basic", "jsx-nested", "jsx-dotted", "jsx-unicode", "plain-basic", "plain-nested", "esm-basic", "declaration-ts", "declaration-mts"}
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
		declaration := strings.HasPrefix(key, "declaration-")
		if key == "esm-basic" {
			extension = ".mts"
		}
		if declaration {
			extension = ".d.ts"
			if key == "declaration-mts" {
				extension = ".d.mts"
			}
		}
		file, expected := stem+extension, stem+native
		source := "export const value = 1\n"
		if jsx {
			source = "export const Card = () => <div />\n"
		}
		if declaration {
			source = "export declare const value: number\n"
		}
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
			file, source = corpus.File, corpus.Source
		}
		input, err := json.Marshal(map[string]string{"file": file, "source": source})
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
			Rejected, Admitted, Unchanged bool
			Value                         string
			Deferred                      []struct{ File, Reason string }
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid route oracle: %v\n%s", err, output)
		}
		wantAdmitted := !declaration
		if result.Admitted != wantAdmitted || result.Rejected != !wantAdmitted || !result.Unchanged {
			Gap(t, migrationJSXRouteTarget, "candidate:"+key, "%q; admitted=%t want=%t unchanged=%t\n%s", migrationJSXCandidateQuote, result.Admitted, wantAdmitted, result.Unchanged, output)
		}
		if wantAdmitted {
			if result.Value != expected || len(result.Deferred) != 0 {
				Gap(t, migrationJSXRouteTarget, "route:"+key, "supported %s maps to %q, want %q; %s", file, result.Value, expected, output)
			}
		} else if len(result.Deferred) != 1 || result.Deferred[0].File != file || result.Deferred[0].Reason == "" || result.Value != "" {
			Gap(t, migrationJSXRouteTarget, "deferred:"+key, "unsupported source needs a located, explained deferral and no native route: %s", output)
		}
	})
}
