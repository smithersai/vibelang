package vibelang

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

const noUnusedConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true,"noUnusedLocals":true},"files":["main.vibe","lib.vibe"]}`

// Box's alias resolves to a type no name prints, as opencode's schema-derived
// ToolResultPart does, so Effect.fn's fix writes its members in the annotation.
const unusedTypeNameLib = `export const Box = Schema.Struct({ value: Schema.String })
export type Box = Schema.Schema.Type<typeof Box>
export const made: Box = { value: "x" }
export const shape = (input: { readonly value: string }) => input.value
`

const unusedTypeNameSite = "export const f = Effect.fn(\"f\")(function* (box: Box) { return box.value })\n"

// fixUnusedTypeName runs --fix with noUnusedLocals on main, and returns its
// text, having failed the test on a refusal. A fuzz body's t.Context is
// canceled, and --fix stops at once under a canceled context.
func fixUnusedTypeName(t *testing.T, main string) string {
	t.Helper()
	result := fixProjectIn(t, context.Background(), map[string]string{"main.vibe": main, "lib.vibe": unusedTypeNameLib, "tsconfig.json": noUnusedConfig})
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("--fix failed: %v, refused: %+v\nfrom:\n%s", result.Err, result.Refused, main)
	}
	got := fixedText(result, "main.vibe")
	if got == "" {
		t.Fatalf("--fix wrote nothing from:\n%s", main)
	}
	return got
}

// A generator's parameter annotation can be a type name's last read. The fix
// writes the checked type (detail 277), and the name goes with its last read.
// Each case held an opencode module at EK1002 behind TS6133 or TS6196.
func TestEffectFnRemovesTypeNameItLeavesUnused(t *testing.T) {
	const localShape = "import { shape } from \"./lib.vibe\"\nexport const s = shape\n"
	for _, tc := range []struct{ name, source, gone, kept string }{
		{"type specifier, ai protocols", "import { type Box, made } from \"./lib.vibe\"\nexport const g = () => made\n" + unusedTypeNameSite, "Box", "made"},
		{"import type list, ssh controller", "import type { Box } from \"./lib.vibe\"\n" + unusedTypeNameSite, "Box", ""},
		{"one name of an import type", "import type { Box as A, Box } from \"./lib.vibe\"\nexport const h = (a: A) => a\n" + unusedTypeNameSite, ", Box", "A"},
		{"local alias, plugin adapter", localShape + "type Box = Parameters<typeof shape>[0]\n" + unusedTypeNameSite, "type Box", "shape"},
		{"two sites, bedrock converse", "import { type Box } from \"./lib.vibe\"\n" + unusedTypeNameSite + "export const f2 = Effect.fn(\"f2\")(function* (box: Box) { return box.value })\n", "Box", ""},
		{"a surviving value binding adds no bare import", "import { type Box, made } from \"./lib.vibe\"\nexport const g = () => made\n" + unusedTypeNameSite, "import \"./lib.vibe\"", "made"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := fixUnusedTypeName(t, tc.source)
			if strings.Contains(got, "Effect.fn") || !strings.Contains(got, "readonly value: string") {
				t.Fatalf("the fix did not write the checked parameter type:\n%s", got)
			}
			if strings.Contains(got, tc.gone) {
				t.Fatalf("%q stays:\n%s", tc.gone, got)
			}
			if tc.kept != "" && !strings.Contains(got, tc.kept) {
				t.Fatalf("%q went:\n%s", tc.kept, got)
			}
		})
	}
}

// An import's module still initializes where the import alone did so: under
// verbatimModuleSyntax, import { type T } emits import "m".
func TestEffectFnKeepsTheLoadOfARemovedTypeImport(t *testing.T) {
	config := strings.Replace(noUnusedConfig, `"noEmit":true`, `"noEmit":true,"verbatimModuleSyntax":true`, 1)
	source := "import { type Box } from \"./lib.vibe\"\n" + unusedTypeNameSite
	result := fixProjectIn(t, context.Background(), map[string]string{"main.vibe": source, "lib.vibe": unusedTypeNameLib, "tsconfig.json": config})
	got := fixedText(result, "main.vibe")
	if len(result.Refused) != 0 || !strings.HasPrefix(got, "import \"./lib.vibe\"\n") || strings.Contains(got, "Box") {
		t.Fatalf("refused %+v, wrote:\n%s", result.Refused, got)
	}
}

// The name stays where something else reads it, and an unused name the author
// wrote is the author's: the fix neither removes it nor reports it as its own.
func TestEffectFnKeepsTypeNamesItDidNotLeaveUnused(t *testing.T) {
	got := fixUnusedTypeName(t, "import { type Box } from \"./lib.vibe\"\nexport const v = (b: Box) => b\n"+unusedTypeNameSite)
	if !strings.Contains(got, "import { type Box }") {
		t.Fatalf("a name a plain function reads went:\n%s", got)
	}
	got = fixUnusedTypeName(t, "type Mine = string\nimport { type Box } from \"./lib.vibe\"\n"+unusedTypeNameSite)
	if !strings.Contains(got, "type Mine = string") || regexp.MustCompile(`\bBox\b`).MatchString(got) {
		t.Fatalf("the author's unused name went, or the fix's stayed:\n%s", got)
	}
}

// A value is not a type name: a fix that leaves one unread may have dropped a
// use, so the gate still refuses it. typeof in the annotation was this one's read.
func TestEffectFnStillRefusesAValueItLeavesUnused(t *testing.T) {
	const site = "export const f = Effect.fn(\"f\")(function* (box: typeof made) { return box.value })\n"
	for _, source := range []string{
		"import { made } from \"./lib.vibe\"\n" + site,
		"const made = { value: \"x\" } as const\n" + site,
	} {
		result := fixProjectIn(t, context.Background(), map[string]string{"main.vibe": source, "lib.vibe": unusedTypeNameLib, "tsconfig.json": noUnusedConfig})
		refused := false
		for _, r := range result.Refused {
			refused = refused || strings.Contains(r.Error, "TS6133")
		}
		if !refused {
			t.Errorf("--fix did not refuse with TS6133: %+v\nfrom:\n%s\nwrote:\n%s", result.Refused, source, fixedText(result, "main.vibe"))
		}
	}
}

// Whatever declares the name and however many generators read it, the fix is
// not refused, every generator is converted, and the name is there exactly when
// something other than a converted annotation reads it.
func FuzzEffectFnUnusedTypeNames(f *testing.F) {
	declarations := []string{
		"import { type Box } from \"./lib.vibe\"\n",
		"import type { Box } from \"./lib.vibe\"\n",
		"import { type Box, made } from \"./lib.vibe\"\nexport const m = () => made\n",
		"import { shape } from \"./lib.vibe\"\nexport const s = shape\ntype Box = Parameters<typeof shape>[0]\n",
	}
	for form := range len(declarations) {
		for _, read := range []bool{false, true} {
			for sites := uint8(1); sites <= 3; sites++ {
				f.Add(uint8(form), sites, read)
			}
		}
	}
	f.Fuzz(func(t *testing.T, form, sites uint8, read bool) {
		source := declarations[int(form)%len(declarations)]
		count := int(sites)%3 + 1
		if read {
			source += "export const reader = (b: Box) => b\n"
		}
		for i := range count {
			source += fmt.Sprintf("export const f%d = Effect.fn(\"f%d\")(function* (box: Box) { return box.value })\n", i, i)
		}
		got := fixUnusedTypeName(t, source)
		if strings.Contains(got, "Effect.fn") {
			t.Fatalf("a generator stayed:\n%s", got)
		}
		if has := regexp.MustCompile(`\bBox\b`).MatchString(got); has != read {
			t.Fatalf("Box present=%t with another read=%t:\n%s\nfrom:\n%s", has, read, got, source)
		}
	})
}
