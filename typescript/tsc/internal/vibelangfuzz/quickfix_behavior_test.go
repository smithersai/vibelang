package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

const quickfixBehaviorTarget = "FuzzQuickFixBehavior"
const quickfixBehaviorQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestQuickFixBehaviorQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), quickfixBehaviorQuote) {
		t.Fatalf("Chapter 7 no longer says %q", quickfixBehaviorQuote)
	}
}

// Reuse the conformance census rather than maintaining a second copy of its
// fixtures. The EK code is the stable rule key; mutation bytes choose a case
// within its diagnostic neighborhood.
func quickfixBehaviorSeeds() map[int32][]Seed {
	seeds := map[int32][]Seed{}
	for _, seed := range CaseSeeds() {
		for _, code := range seed.Codes {
			var number int32
			if _, err := fmt.Sscanf(code, "EK%d", &number); err == nil {
				seeds[number] = append(seeds[number], seed)
			}
		}
	}
	byName := map[string]Seed{}
	for _, seed := range CaseSeeds() {
		byName[seed.Name] = seed
	}
	for code, name := range map[int32]string{
		4830: "tsforms-errors", 4831: "tsforms-services", 4832: "tsforms-schemas",
		4833: "tsforms-types", 4834: "tsforms-direct", 4835: "tsforms-catch",
		4836: "tsforms-blocks", 4837: "tsforms-errors", 4839: "tsforms-option-match-api",
		4840: "tsforms-option", 4841: "tsforms-schema-type-spelling", 4843: "tsforms-entry-main",
	} {
		if seed, ok := byName[name]; ok {
			seeds[code] = append(seeds[code], seed)
		}
	}
	for code, source := range map[int32]string{
		1023: "export function main() { return runSync(sync(() => 1)) }\n",
		2112: "error Missing\neffect function f() { try { return 1 } catch (e: Missing) { return 2 } }\n",
		2113: "effect function f() { try { return 1 } catch (e: Cause) { return 2 } }\n",
		2120: "service class Users { readonly value: number }\n",
		2121: "service Users { readonly value: number }\nlayer Live: Users { return { value: 1 } }\n",
		4406: "effect function f() { return trusted(1) }\n",
		4819: "import { Effect } from \"effect\"; export const f = Effect.gen(function* () { yield Effect.succeed(1) })\n",
		4820: "import { Effect } from \"effect\"; export const f = Effect.gen(function* () { yield* Effect.fail(1) })\n",
		4842: "import { Effect } from \"effect\"; export const value = Effect.succeed(1)\n",
		4853: "service Users { readonly value: number }\neffect function f(): number!! { return (try Users).value }\n",
		4854: "export abstract class Users { abstract readonly value: number }\n",
		4855: "service Flags { readonly enabled: boolean; static readonly default = { enabled: true } }\n",
		9100: "export function f() { return 1 }\n",
		9101: "data Box { Item { value: number } }\nexport function f(box: Box) { return box.value }\n",
	} {
		name := fmt.Sprintf("EK%04d", code)
		seeds[code] = append(seeds[code], Seed{Name: name, Files: map[string]string{"main.vibe": "// preserve this comment\n" + source}})
	}
	return seeds
}

func TestQuickFixBehaviorRegistry(t *testing.T) {
	TestQuickFixBehaviorQuoted(t)
	seeds := quickfixBehaviorSeeds()
	codes := ls.CodeFixCodes("EK")
	if len(codes) == 0 {
		t.Fatal("empty quick-fix registry")
	}
	for _, code := range quickfixMissingGenerators(codes, seeds) {
		t.Errorf("EK%04d: registered fix has no keyed generator", code)
	}
	for _, code := range codes {
		t.Logf("EK%04d generators=%d", code, len(seeds[code]))
	}
}

// Removing a real generator and introducing a new registry code must both trip
// the same gate that the complete registry uses.
func TestQuickFixBehaviorMissingGenerator(t *testing.T) {
	seeds := quickfixBehaviorSeeds()
	codes := ls.CodeFixCodes("EK")
	if len(codes) == 0 {
		t.Fatal("empty registry")
	}
	missing := maps.Clone(seeds)
	delete(missing, codes[0])
	if !slices.Contains(quickfixMissingGenerators(codes, missing), codes[0]) {
		t.Fatal("removing an existing generator did not fail coverage")
	}
	if !slices.Contains(quickfixMissingGenerators(append(slices.Clone(codes), 999999), seeds), int32(999999)) {
		t.Fatal("new fix code without a generator did not fail coverage")
	}
}

func quickfixMissingGenerators(codes []int32, seeds map[int32][]Seed) []int32 {
	var missing []int32
	for _, code := range codes {
		if len(seeds[code]) == 0 {
			missing = append(missing, code)
		}
	}
	return missing
}
