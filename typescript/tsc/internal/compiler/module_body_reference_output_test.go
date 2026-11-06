package compiler_test

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tracing"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestProjectReferenceModuleBodyOutputs(t *testing.T) {
	for _, extension := range []string{".vibe", ".vibex"} {
		for _, output := range []string{"lib", "nested/types", "node_modules/.generated/source"} {
			for _, sourceRedirect := range []bool{false, true} {
				for _, warm := range []bool{false, true} {
					for _, directBody := range []bool{false, true} {
						t.Run(fmt.Sprintf("%s/%s/source=%t/warm=%t/direct=%t", extension, output, sourceRedirect, warm, directBody), func(t *testing.T) {
							files := referenceBodyFiles(extension, output, "model")
							if warm {
								files["/core/src/state"+extension+".model.d.ts"] = "export interface Base<T> { readonly transform: (value: T) => string }"
							}
							if directBody {
								files["/core/"+output+"/derived.d.ts"] = "import type { Base } from \"./state" + extension + ".model.js\"; export interface Derived extends Base<number> { readonly active: boolean }"
							}
							program := referenceBodyProgram(t, files, sourceRedirect)
							for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), nil) {
								t.Error(diagnostic.String())
							}
							if !sourceRedirect && program.GetSourceFile(tspath.RootedFilePathFromNormalized("/core/"+output+"/state"+extension+".model.d.ts")) == nil {
								t.Fatal("the reference consumer did not load the verified body declaration")
							}
						})
					}
				}
			}
		}
	}
}

func TestProjectReferenceModuleBodyOutputGuards(t *testing.T) {
	for _, variant := range []string{"undeclared-body", "wrong-output-directory", "explicit-declaration"} {
		t.Run(variant, func(t *testing.T) {
			files := referenceBodyFiles(".vibe", "lib", "model")
			switch variant {
			case "undeclared-body":
				files["/core/src/state.vibe"] = strings.ReplaceAll(files["/core/src/state.vibe"].(string), "model", "other")
			case "wrong-output-directory":
				delete(files, "/core/lib/state.vibe.model.d.ts")
				files["/core/elsewhere/state.vibe.model.d.ts"] = "export interface Base<T> { readonly transform: (value: T) => string }"
			case "explicit-declaration":
				files["/core/lib/state.d.ts"] = `export type { Base } from "./state.vibe.model.d.ts"; export * as State from "./state.ts";`
				files["/core/src/state.vibe.model.d.ts"] = "export interface Base<T> { readonly authored: T }"
			}
			program := referenceBodyProgram(t, files, false)
			if len(program.GetSemanticDiagnostics(t.Context(), nil)) == 0 {
				t.Fatal("an unverified or explicitly written declaration edge must retain its diagnostic")
			}
		})
	}
}

func TestProjectReferenceModuleBodyOutputTrace(t *testing.T) {
	for _, warm := range []bool{false, true} {
		t.Run(fmt.Sprintf("warm=%t", warm), func(t *testing.T) {
			files := referenceBodyFiles(".vibe", "lib", "model")
			files["/trace"] = &fstest.MapFile{Mode: fs.ModeDir}
			if warm {
				files["/core/src/state.vibe.model.d.ts"] = "export interface Base<T> { readonly transform: (value: T) => string }"
			}
			fsys := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			trace, err := tracing.StartTracing(fsys, "/trace", "/app/tsconfig.json", true)
			if err != nil {
				t.Fatal(err)
			}
			config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fsys, nil)
			if len(diagnostics) != 0 || len(config.Errors) != 0 {
				t.Fatalf("configuration: %v %v", diagnostics, config.Errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fsys, bundled.LibPath(), nil, nil, nil), Tracing: trace})
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), nil) {
				t.Error(diagnostic.String())
			}
			if err := trace.StopTracing(); err != nil {
				t.Fatal(err)
			}
			text, ok := fsys.ReadFile("/trace/trace.json")
			if !ok {
				t.Fatal("trace output missing")
			}
			var events []struct {
				Name  string
				Phase string `json:"ph"`
				Args  map[string]any
			}
			if err := json.Unmarshal([]byte(text), &events); err != nil {
				t.Fatal(err)
			}
			found := 0
			for _, event := range events {
				if event.Name != "vibeProjectReferenceBodyOutput" {
					continue
				}
				found++
				if event.Phase != "I" || len(event.Args) != 2 || event.Args["sourceKind"] != ".vibe" || event.Args["priorDeclaration"] != warm {
					t.Errorf("unexpected reference-body metadata: %+v", event)
				}
			}
			if found == 0 {
				t.Fatal("missing named-body output decision in deterministic trace")
			}
		})
	}
}

func referenceBodyFiles(extension, output, body string) map[string]any {
	return map[string]any{
		"/app/package.json":                 `{"type":"module"}`,
		"/app/tsconfig.json":                `{"compilerOptions":{"noLib":true,"strict":true,"jsx":"preserve","allowImportingTsExtensions":true,"skipLibCheck":false,"module":"nodenext","moduleResolution":"nodenext","types":[],"noEmit":true},"files":["main.ts"],"references":[{"path":"../core"}]}`,
		"/app/main.ts":                      `import type { Derived } from "core"; declare const value: Derived; export const text: string = value.transform(1);`,
		"/app/node_modules/core":            vfstest.Symlink("/core"),
		"/core/package.json":                `{"name":"core","type":"module","exports":{".":"./src/index.ts"}}`,
		"/core/tsconfig.json":               fmt.Sprintf(`{"compilerOptions":{"noLib":true,"strict":true,"module":"nodenext","moduleResolution":"nodenext","jsx":"preserve","allowImportingTsExtensions":true,"emitDeclarationOnly":true,"types":[],"composite":true,"rootDir":"src","outDir":%q},"vibe":{"effectGlobals":false,"effectModules":false},"include":["src"]}`, output),
		"/core/src/index.ts":                `export type { Derived } from "./derived` + extension + `";`,
		"/core/src/state" + extension:       "module " + body + " {\nexport interface Base<T> { readonly transform: (value: T) => string }\n}\nexport type { Base } from " + body + ";\nexport * as State from \"./state" + extension + "\";\nexport const pure = 1;\n",
		"/core/src/derived" + extension:     `import { State } from "./state` + extension + `"; export interface Derived extends State.Base<number> { readonly active: boolean }`,
		"/core/" + output + "/index.d.ts":   `export type { Derived } from "./derived.ts";`,
		"/core/" + output + "/derived.d.ts": `import { State } from "./state.ts"; export interface Derived extends State.Base<number> { readonly active: boolean }`,
		"/core/" + output + "/state.d.ts":   `export type { Base } from "./state` + extension + "." + body + `.js"; export * as State from "./state.ts";`,
		"/core/" + output + "/state" + extension + "." + body + ".d.ts": `export interface Base<T> { readonly transform: (value: T) => string }`,
	}
}

func referenceBodyProgram(t *testing.T, files map[string]any, sourceRedirect bool) *compiler.Program {
	t.Helper()
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(diagnostics) > 0 || len(config.Errors) > 0 {
		t.Fatalf("configuration: %v %v", diagnostics, config.Errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil), UseSourceOfProjectReference: sourceRedirect})
}
