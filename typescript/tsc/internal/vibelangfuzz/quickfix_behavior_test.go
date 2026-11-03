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
			seeds[code] = append([]Seed{seed}, seeds[code]...)
		}
	}
	for code, source := range map[int32]string{
		1023: "export function main() { return runSync(sync(() => 1)) }\n",
		2112: "error Missing\nexport effect function main() { try { return 1 } catch (e: Missing) { return 2 } }\n",
		2113: "export effect function main() { try { return 1 } catch (e: Cause) { return 2 } }\n",
		2120: "service class Users { readonly value: number }\nexport function main() { return Users.key }\n",
		2121: "service Users { readonly value: number }\nlayer Live: Users { return { value: 1 } }\n",
		4406: "effect function f() { return trusted(1) }\n",
		4819: "import { Effect } from \"effect\"; export const f = Effect.gen(function* () { yield Effect.succeed(1) })\n",
		4820: "import { Effect } from \"effect\"; export const f = Effect.gen(function* () { yield* Effect.fail(1) })\n",
		4842: "import { Effect } from \"effect\"; export const value = Effect.succeed(1)\n",
		4853: "service Users { readonly value: number }\neffect function f(): number!never { return (try Users).value }\n",
		4854: "export abstract class Users { abstract readonly value: number }\nexport function main() { return typeof Users }\n",
		4855: "service Flags { readonly enabled: boolean; static readonly default = { enabled: true } }\nexport function main() { return Flags.key }\n",
		9100: "export function f() { return 1 }\n",
		9101: "data Box { Item { value: number } }\nexport function f(box: Box) { return box.value }\n",
	} {
		name := fmt.Sprintf("EK%04d", code)
		seeds[code] = append(seeds[code], Seed{Name: name, Files: map[string]string{"main.vibe": "// preserve this comment\n" + source}})
	}
	// These focused warning fixtures have public runtime observers; the older
	// census cases intentionally shield the relevant source from the advisory.
	for code, source := range map[int32]string{
		4841: "export const Value = Schema.Literals([\"a\",\"b\"])\nexport type Value = typeof Value.Type\nexport function main() { return Value.make(\"a\") }\n",
		4842: "import * as Array from \"effect/Array\"\nexport function main() { return Array.map([1,2], n => n+1) }\n",
	} {
		seeds[code] = []Seed{{Name: fmt.Sprintf("EK%04d-runtime", code), Files: map[string]string{"main.vibe": source}}}
	}
	for i, seed := range seeds[4839] {
		files := maps.Clone(seed.Files)
		main := toolsMainFile(files)
		if seed.Name == "tsforms-option-match-api" {
			files[main] += "\nexport function main() { return [named(Option.some(7)), aliased(O.none())] }\n"
			seed.Files = files
			seeds[4839][i] = seed
		}
	}
	seeds[509] = []Seed{{Name: "EK0509-handler-reference", Files: map[string]string{"main.vibe": "const handler = (_: unknown) => 7\nexport effect function main() { return Effect.fail(1) catch handler }\n"}}}
	quickfixInstallGoldenPrograms(seeds)
	seeds[4802] = []Seed{
		{Name: "EK4802-runtime", Files: map[string]string{"main.vibe": "export effect function main() { return Effect.succeed(7) }\n"}},
		{Name: "EK4802-trace", Files: map[string]string{
			"main.vibe": "import { held } from \"./host.js\"\nexport {traceOf} from \"./host.js\"\nexport effect function main() { return held() }\n",
			"host.ts":   "import { Effect } from \"effect\"\nconst trace: string[]=[]; export function traceOf() { return trace }\nexport function held() { return Effect.sync(() => { trace.push(\"inner\"); return 7 }) }\n",
		}},
	}
	seeds[9100] = []Seed{{Name: "EK9100-editor", Files: map[string]string{
		"main.vibe": "import { visit } from \"./host.js\"\nexport function main() { return visit(() => 7) }\n",
		"host.ts":   "import { Effect } from \"effect\"\nexport function visit(f: () => number) { return Effect.sync(f) }\n",
	}}}
	seeds[9101] = []Seed{{Name: "EK9101-editor", Files: map[string]string{
		"main.vibe": "import { get } from \"./host.vibe\"\nexport function main() { const value = get(); return value.request.code }\n",
		"host.vibe": "export function get() { return {request: {code: \"ok\"}} }\n",
	}}}
	quickfixAdmittedWarnings(seeds)
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
		name := ""
		if len(seeds[code]) > 0 {
			name = seeds[code][0].Name
		}
		t.Logf("EK%04d generators=%d seed=%s", code, len(seeds[code]), name)
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
