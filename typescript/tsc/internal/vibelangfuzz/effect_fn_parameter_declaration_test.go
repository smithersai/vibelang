package vibelangfuzz

import (
	"fmt"
	"maps"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const effectFnParameterDeclarationTarget = "FuzzEffectFnParameterDeclaration"

func TestEffectFnParameterDeclarationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
	if !strings.Contains(SpecText("001-functions.md"), migrationDefaultProgramQuote) {
		t.Fatalf("Chapter 1 no longer says %q", migrationDefaultProgramQuote)
	}
}

// The native Effect.fn result infers a parameter tuple. Copying the generator's
// annotation onto an arrow must not replace that public inferred declaration.
// Compare raw bytes with the valid native source, without a type normalizer.
func FuzzEffectFnParameterDeclaration(f *testing.F) {
	startShortBudget(f)
	keys := []string{"readonly", "brand", "structural", "union", "tuple", "generic", "undefined-literal", "callback"}
	for _, key := range keys {
		f.Add(key, uint8(0), false)
		f.Add(key, uint8(1), true)
		if !testing.Short() || toolsFuzzing() {
			for mode := uint8(0); mode < 3; mode++ {
				for _, optional := range []bool{false, true} {
					f.Add(key, mode, optional)
				}
			}
		}
	}
	f.Add("namespace-return", uint8(0), false)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8, optional bool) {
		TestEffectFnParameterDeclarationQuoted(t)
		typ, extra, generic := "", "", ""
		switch key {
		case "readonly":
			typ = "ReadonlyArray<string>"
		case "brand":
			typ = "Path"
			extra = "export const Path = Schema.String.pipe(Schema.brand(\"Path\"))\nexport type Path = typeof Path.Type\n"
		case "structural":
			typ = "Box"
			extra = "export type Box = { readonly value: string }\n"
		case "union":
			typ = "Value"
			extra = "export type Value = string | number\n"
		case "tuple":
			typ = "Pair"
			extra = "export type Pair = readonly [string, number]\n"
		case "undefined-literal":
			typ = "ReadonlyArray<\"undefined\">"
		case "callback":
			typ = "() => number"
		case "namespace-return":
			typ = "string"
			mode, optional = 0, false
		case "generic":
			typ = "ReadonlyArray<T>"
			generic = "<T extends string>"
		default:
			return
		}
		prefix, api := "import { Effect, Schema } from \"effect\"\n", "Effect"
		if key == "namespace-return" {
			prefix = "import * as Fx from \"effect/Effect\"\nimport * as Schema from \"effect/Schema\"\n"
			api = "Fx"
		}
		start := api + ".fn"
		switch mode % 3 {
		case 1:
			start += "(\"cleanup\")"
		case 2:
			start = api + ".fnUntraced"
		}
		mark := ""
		if optional {
			mark = "?"
		}
		source := prefix + extra + "export const cleanup = " + start + "(function* " + generic + "(input" + mark + ": " + typ + ") { return input })\n"
		original := toolsCompile(t, w, effectFnParameterDeclarationTarget, map[string]string{"main.ts": source})
		defer original.Remove()
		if !toolsErrorFree(original) {
			t.Fatalf("native generator must compile: %v\n%s", SortedKeys(Keys(original.Dir, original.Diagnostics)), source)
		}
		migrated := toolsCompile(t, w, effectFnParameterDeclarationTarget, map[string]string{"main.vibe": source})
		defer migrated.Remove()
		config := toolsConfig(w, migrated.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatal("invalid generated project config")
		}
		var result *vibelang.FixResult
		toolsRun(t, effectFnParameterDeclarationTarget, "fix", source, nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		gapKey := fmt.Sprintf("declaration:%s:%d:optional=%t", key, mode%3, optional)
		if result.Err != nil {
			Gap(t, effectFnParameterDeclarationTarget, gapKey, "safe conversion failed: %v\n%s", result.Err, source)
		}
		files := map[string]string{"main.vibe": source}
		for name, file := range result.Files {
			rel := strings.TrimPrefix(name.AsString(), strings.TrimSuffix(migrated.Dir, "/")+"/")
			if rel != "main.vibe" {
				t.Fatalf("fix escaped its source: %s", rel)
			}
			files[rel] = file.Text
		}
		after := toolsCompile(t, w, effectFnParameterDeclarationTarget, files)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, effectFnParameterDeclarationTarget, gapKey, "fixed source must compile: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), files["main.vibe"])
		}
		declarations := func(r *Result) map[string]string {
			out := map[string]string{}
			for name, text := range r.Outputs {
				if strings.HasPrefix(name, "out/") && isDeclaration(name) {
					out[name] = text
				}
			}
			return out
		}
		beforeBytes, afterBytes := declarations(original), declarations(after)
		if len(beforeBytes) == 0 {
			t.Fatal("native fixture emitted no declarations")
		}
		if !maps.Equal(beforeBytes, afterBytes) {
			Gap(t, effectFnParameterDeclarationTarget, gapKey, "Chapter 7: %q; Chapter 1: %q\nnative:\n%s\nfixed:\n%s\nnative declarations:%v\nfixed declarations:%v", migrationDeclarationFixQuote, migrationDefaultProgramQuote, source, files["main.vibe"], beforeBytes, afterBytes)
		}
		ExpectPending(t, effectFnParameterDeclarationTarget, gapKey)
		ExpectPending(t, effectFnParameterDeclarationTarget, specCorpusKey(t))
	})
}
