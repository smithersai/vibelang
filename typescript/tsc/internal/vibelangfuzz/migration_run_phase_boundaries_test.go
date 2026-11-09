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

	"github.com/microsoft/TypeScript/tsc/internal/vibelangestree"
)

const migrationRunPhaseTarget = "FuzzMigrationRunPhaseBoundaries"
const migrationTypedFailureQuote = "the Effect fails with `e`, a typed error: `return yield* Effect.fail(e)`"

func TestMigrationRunPhaseBoundariesQuoted(t *testing.T) {
	r4Quoted(t, "001-functions.md", migrationPlainQuote)
	r4Quoted(t, "003-failures.md", migrationTypedFailureQuote)
	r4Quoted(t, "../../../.smithers/flows/migrate/rules.md", migrationHomeQuote)
}

// A static verifier must keep typed failure returns and nested callback
// identities distinct from true losses. The AST is the compiler's actual
// native ESTree, and both source programs are checked independently.
func FuzzMigrationRunPhaseBoundaries(f *testing.F) {
	startShortBudget(f)
	keys := []string{"failure", "failure-tagged", "failure-conditional", "failure-wrapped", "array", "array-const", "array-block", "array-nested", "drop-value", "drop-failure", "plain-map", "generator-value"}
	for _, key := range keys {
		for mode := uint8(0); mode < 2; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationRunPhaseBoundariesQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ns := "Effect"
		if mode&1 != 0 {
			ns = "E"
		}
		head := "import * as " + ns + " from \"effect/Effect\";\n"
		original := head + "export const make=()=>" + ns + ".gen(function*(){return yield* " + ns + ".fail(\"bad\")});"
		native := head + "export const make=effect()=>{throw \"bad\"}"
		switch key {
		case "failure-tagged":
			original = head + "export const make=()=>" + ns + ".gen(function*(){return yield* " + ns + ".fail({_tag:\"Bad\" as const})});"
			native = head + "export const make=effect()=>{throw {_tag:\"Bad\" as const}}"
		case "failure-conditional":
			original = head + "export const make=(valid:boolean)=>" + ns + ".gen(function*(){if(valid)return yield* " + ns + ".fail(\"bad\");return;});"
			native = head + "export const make=effect(valid:boolean)=>{if(valid)throw \"bad\"}"
		case "failure-wrapped":
			original = head + "export const make=()=>" + ns + ".gen(function*(){return yield* (" + ns + ".fail(\"bad\"))});"
		case "drop-value":
			original = head + "export const make=()=>" + ns + ".gen(function*(){return 7});"
			native = head + "export const make=effect()=>{}"
		case "drop-failure":
			native = head + "export const make=effect()=>{}"
		case "generator-value":
			original = head + "export const make=()=>" + ns + ".gen(function*(){return 7});"
			native = head + "export const make=effect()=>{return 7}"
		case "plain-map":
			original = head + "export const make=(impl:Readonly<Record<string,number>>)=>Object.entries(impl).map(([key,value])=>[key,value]);"
			native = original
		}
		if strings.HasPrefix(key, "array") {
			head += "type Calls=Readonly<Record<string,()=>" + ns + ".Effect<number>>>;\n"
			before := ns + ".fn(function*(){return yield* call()})"
			after := "effect()=>{return try call()}"
			if key == "array-nested" {
				before = "{run:" + before + "}"
				after = "{run:" + after + "}"
			}
			beforeTuple, afterTuple := "[key,"+before+"]", "[key,"+after+"]"
			if key == "array-const" {
				beforeTuple += " as const"
				afterTuple += " as const"
			}
			if key == "array-block" {
				beforeTuple = "{return " + beforeTuple + "}"
				afterTuple = "{return " + afterTuple + "}"
			}
			original = head + "export const make=(impl:Calls)=>Object.fromEntries(Object.entries(impl).map(([key,call])=>" + beforeTuple + "));"
			native = head + "export const make=(impl:Calls)=>Object.fromEntries(Object.entries(impl).map(([key,call])=>" + afterTuple + "));"
		}
		if mode&1 == 0 && (key == "failure" || key == "array") {
			name := "alchemy-yieldable-failure-return.json"
			if key == "array" {
				name = "alchemy-effect-factory-array-callback.json"
			}
			raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", name))
			if err != nil {
				t.Fatal(err)
			}
			var corpus struct{ Original, Native string }
			if err := json.Unmarshal(raw, &corpus); err != nil {
				t.Fatal(err)
			}
			original, native = corpus.Original, corpus.Native
		}
		for file, text := range map[string]string{"main.ts": original, "main.vibe": native} {
			r := toolsCompile(t, w, migrationRunPhaseTarget, map[string]string{file: text})
			defer r.Remove()
			if HasError(r.Diagnostics) {
				t.Fatalf("invalid run-phase source %s: %v\n%s", file, SortedKeys(Keys(r.Dir, r.Diagnostics)), text)
			}
		}
		tree, failure := vibelangestree.Parse("main.vibe", native)
		if failure != nil {
			t.Fatal(failure)
		}
		input, err := json.Marshal(map[string]any{"original": original, "native": native, "ast": json.RawMessage(tree), "expectedBlocking": strings.HasPrefix(key, "drop-"), "stock": mode&1 == 0 && (key == "failure" || key == "array")})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_run_phase_boundaries.mjs"))
		cmd.Dir = Root()
		cmd.Stdin = strings.NewReader(string(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("static run-phase oracle: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var record struct {
			OK bool `json:"ok"`
		}
		if err := json.Unmarshal(output, &record); err != nil {
			t.Fatalf("invalid run-phase oracle result: %v\n%s", err, output)
		}
		gapKey := "phase:" + key + "/" + ns
		if !record.OK {
			Gap(t, migrationRunPhaseTarget, gapKey, "Chapter 1: %q; Chapter 3: %q; preserved failures and callback holders must remain comparable\n%s", migrationPlainQuote, migrationTypedFailureQuote, output)
		}
		ExpectPending(t, migrationRunPhaseTarget, gapKey)
		ExpectPending(t, migrationRunPhaseTarget, specCorpusKey(t))
	})
}
