package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const nativeConsumerExtensionPolicyQuote = "Written `./x.vibe` and `./x.vibex` imports follow the `.ts`/`.tsx` twin's source-extension checks, including `TS5097` for a value import without `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`."
const nativeConsumerRewritePolicyQuote = "JavaScript source-extension rewriting requires `rewriteRelativeImportExtensions`."

func TestNativeConsumerExtensionPolicyQuoted(t *testing.T) {
	for _, quote := range []string{nativeConsumerExtensionPolicyQuote, nativeConsumerRewritePolicyQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("chapter 7 lost native consumer policy: %s", quote)
		}
	}
}

// Intrinsic Vibe inputs and their native twins must agree on admission and
// JavaScript spelling. The CLI cases independently compare against tsc 5.9.3.
// Mutate extension, importer, rewrite/check profile, import/export/type form,
// arbitrary-extension flag, nesting and nonrelative paths (TS2877).
func FuzzNativeConsumerExtensionPolicy(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"vibe", "vibex"} {
		for _, variant := range []uint8{0, 1, 2, 3, 4, 8, 16, 32} {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		const target = "FuzzNativeConsumerExtensionPolicy"
		defer recoverCompilerPanic(t, target)
		TestNativeConsumerExtensionPolicyQuoted(t)
		if key != "vibe" && key != "vibex" {
			if len(key) == 0 {
				return
			}
			key = []string{"vibe", "vibex"}[int(key[0])%2]
		}
		twin := "ts"
		if key == "vibex" {
			twin = "tsx"
		}
		compile := func(extension string) ([]int, string) {
			t.Helper()
			importer := "ts"
			if variant&16 != 0 {
				importer = "tsx"
			}
			stem := "producer"
			if variant&32 != 0 {
				stem = "nested/" + stem
			}
			specifier := "./" + stem + "." + extension
			if variant&64 != 0 {
				specifier = "pkg/" + stem + "." + extension
			}
			source := fmt.Sprintf("import { value } from %q; export const answer: 42 = value;", specifier)
			switch (variant / 4) % 4 {
			case 1:
				source = fmt.Sprintf("export { value } from %q;", specifier)
			case 2:
				source = fmt.Sprintf("import type { Value } from %q; export const answer: Value = 42;", specifier)
			case 3:
				source = fmt.Sprintf("export type { Value } from %q;", specifier)
			}
			options := map[string]any{
				"noLib": true, "target": "ES2022", "module": "NodeNext", "jsx": "preserve",
				"outDir": "out", "allowArbitraryExtensions": variant&128 != 0,
				"paths": map[string][]string{"pkg/*": {"./*"}},
			}
			switch variant % 4 {
			case 1:
				options["rewriteRelativeImportExtensions"] = true
			case 2:
				options["rewriteRelativeImportExtensions"] = false
			case 3:
				options["noEmit"], options["allowImportingTsExtensions"] = true, true
			}
			entry := "consumer." + importer
			config, err := json.Marshal(map[string]any{
				"compilerOptions": options, "files": []string{entry},
				"vibe": map[string]any{"effectGlobals": false, "effectModules": false},
			})
			if err != nil {
				t.Fatal(err)
			}
			files := map[string]any{
				"/app/package.json":              "{\"type\":\"module\"}",
				"/app/tsconfig.json":             string(config),
				"/app/" + entry:                  source,
				"/app/" + stem + "." + extension: "export const value = 42 as const; export type Value = 42;",
			}
			if extension == "vibe" || extension == "vibex" {
				files["/app/"+stem+".d."+extension+".ts"] = "export declare const value: 0; export type Value = 0;"
			}
			fs := vfstest.FromMap(files, tspath.CaseSensitive)
			parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(ds) != 0 || parsed == nil {
				t.Fatalf("invalid generated config: %v", ds)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, "/", nil, nil, nil)})
			codes := []int{}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
				codes = append(codes, int(d.Code()))
			}
			slices.Sort(codes)
			output := ""
			program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				if strings.HasSuffix(string(name), "/consumer.js") || strings.HasSuffix(string(name), "/consumer.jsx") {
					output = text
				}
				return nil
			}})
			return codes, output
		}
		expected, nativeOutput := compile(twin)
		actual, output := compile(key)
		gap := fmt.Sprintf("%s/%d", key, variant)
		if !slices.Equal(actual, expected) {
			Gap(t, target, "admission:"+gap, "%s: native %v, Vibe %v", nativeConsumerExtensionPolicyQuote, expected, actual)
		}
		want := strings.ReplaceAll(nativeOutput, "producer."+twin, "producer."+key)
		if output != want {
			Gap(t, target, "output:"+gap, "%s: native output %q, Vibe output %q", nativeConsumerRewritePolicyQuote, want, output)
		}
	})
}
