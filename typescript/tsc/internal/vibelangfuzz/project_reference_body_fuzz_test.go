package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const referenceBodyTarget = "FuzzProjectReferenceModuleBodies"

var referenceBodyKeys = []string{"named-body-export", "self-namespace-heritage"}

func TestProjectReferenceModuleBodiesQuoted(t *testing.T) {
	const quote = "Moving the body to a sibling `.ts` file (`.tsx` for a body in `.vibex`), preserving its external-module classification as specified below, and replacing `from name` with that file's string specifier changes no diagnostic, type, emitted statement, declaration or run-time observation."
	if !strings.Contains(SpecText("../vips/0040-module-declarations.md"), quote) {
		t.Fatalf("VIP-40 no longer says %q", quote)
	}
}

// Body and physical-sibling twins have the same ordinary declarations. The
// source project reference must retain that declaration edge in both layouts.
// Always read source: identical handwritten output declarations mask that edge.
func referenceBodyDiagnostics(t *testing.T, key string, variant uint8, twin bool) []int {
	t.Helper()
	return referenceBodyDiagnosticsWithBody(t, key, variant, twin, "export interface Base<T> { readonly transform: (value: T) => string }\n")
}

func referenceBodyDiagnosticsWithBody(t *testing.T, key string, variant uint8, twin bool, body string) []int {
	t.Helper()
	extension, nativeExtension := ".vibe", ".ts"
	if variant&1 != 0 {
		extension, nativeExtension = ".vibex", ".tsx"
	}
	name := []string{"model", "platform", "Text", "Ω"}[int(variant>>1)%4]
	output := []string{"lib", "nested/types", "node_modules/.generated/source"}[int(variant>>3)%3]
	part := strings.TrimSuffix(parser.ModuleDeclarationFileSuffix(name), ".ts")
	stem := "state" + extension + part
	state := "module " + name + " {\n" + body + "}\nexport type { Base } from " + name + ";\nexport * as State from \"./state" + extension + "\";\nexport const pure = 1;\n"
	sourceExtension := extension
	if twin {
		state = "export type { Base } from \"./" + stem + ".js\";\nexport * as State from \"./state" + nativeExtension + "\";\nexport const pure = 1;\n"
		sourceExtension = nativeExtension
	}
	index, main := `export type { Base } from "./state`+sourceExtension+`";`, `import type { Base } from "core"; declare const value: Base<number>; export const text: string = value.transform(1);`
	if key == "self-namespace-heritage" {
		index = `export type { Derived } from "./derived` + sourceExtension + `";`
		main = `import type { Derived } from "core"; declare const value: Derived; export const text: string = value.transform(1);`
	}
	appOptions := map[string]any{"noLib": true, "strict": true, "skipLibCheck": false, "jsx": "preserve", "allowImportingTsExtensions": true, "module": "NodeNext", "moduleResolution": "NodeNext", "types": []string{}, "noEmit": true}
	coreOptions := map[string]any{"noLib": true, "strict": true, "module": "NodeNext", "moduleResolution": "NodeNext", "jsx": "preserve", "types": []string{}, "composite": true, "allowImportingTsExtensions": true, "emitDeclarationOnly": true, "rootDir": "src", "outDir": output}
	appConfig, _ := json.Marshal(map[string]any{"compilerOptions": appOptions, "files": []string{"main.ts"}, "references": []map[string]string{{"path": "../core"}}})
	coreConfig, _ := json.Marshal(map[string]any{"compilerOptions": coreOptions, "vibe": map[string]bool{"effectGlobals": false, "effectModules": false}, "include": []string{"src"}})
	files := map[string]any{
		"/app/package.json":                   `{"type":"module"}`,
		"/app/tsconfig.json":                  string(appConfig),
		"/app/main.ts":                        main,
		"/app/node_modules/core":              vfstest.Symlink("/core"),
		"/core/package.json":                  `{"name":"core","type":"module","exports":{".":"./src/index.ts"}}`,
		"/core/tsconfig.json":                 string(coreConfig),
		"/core/src/index.ts":                  index,
		"/core/src/state" + sourceExtension:   state,
		"/core/src/derived" + sourceExtension: `import { State } from "./state` + sourceExtension + `"; export interface Derived extends State.Base<number> { readonly active: boolean }`,
	}
	if twin {
		files["/core/src/"+stem+nativeExtension] = body
	}

	sensitivity := tspath.CaseSensitive
	if variant&64 != 0 {
		sensitivity = tspath.CaseInsensitive
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, sensitivity))
	config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(diagnostics) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", diagnostics, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil), UseSourceOfProjectReference: true})
	codes := []int{}
	for _, diagnostic := range program.GetProgramDiagnostics() {
		codes = append(codes, int(diagnostic.Code()))
	}
	for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), nil) {
		codes = append(codes, int(diagnostic.Code()))
	}
	sort.Ints(codes)
	return codes
}

func FuzzProjectReferenceModuleBodies(f *testing.F) {
	startShortBudget(f)
	for i, key := range referenceBodyKeys {
		for _, variant := range []uint8{0, 1, 28, 65} {
			f.Add(key, variant+uint8(i*2))
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(referenceBodyKeys, key) {
			key = referenceBodyKeys[int(variant)%len(referenceBodyKeys)]
		}
		const quote = "changes no diagnostic, type, emitted statement, declaration or run-time observation."
		if !strings.Contains(SpecText("../vips/0040-module-declarations.md"), quote) {
			t.Fatalf("VIP-40 no longer says %q", quote)
		}
		want := referenceBodyDiagnostics(t, key, variant, true)
		if len(want) != 0 {
			t.Fatalf("invalid physical TypeScript sibling control: %v", want)
		}
		got := referenceBodyDiagnostics(t, key, variant, false)
		gap := fmt.Sprintf("%s/variant=%d", key, variant)
		if !slices.Equal(got, want) {
			Gap(t, referenceBodyTarget, gap, "VIP-40 project-reference declaration identity: body=%v sibling=%v", got, want)
		}
		ExpectPending(t, referenceBodyTarget, gap)
		ExpectPending(t, referenceBodyTarget, specCorpusKey(t))
	})
}

// An incompatible body must reach the app in every reference variant. The
// declarations-only implementation used to hide this mutation below bit 7.
func TestProjectReferenceModuleBodiesReadsSource(t *testing.T) {
	for _, key := range referenceBodyKeys {
		for _, variant := range []uint8{0, 1, 28, 65, 128, 130} {
			for _, twin := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%d/%t", key, variant, twin), func(t *testing.T) {
					broken := "export interface Base<T> { readonly transform: (value: T) => number }\n"
					got := referenceBodyDiagnosticsWithBody(t, key, variant, twin, broken)
					if !slices.Equal(got, []int{2322}) {
						t.Fatalf("body mutation must reach the consumer as TS2322, got %v", got)
					}
				})
			}
		}
	}
}
