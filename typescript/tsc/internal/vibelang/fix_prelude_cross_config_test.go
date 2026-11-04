package vibelang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixPreludeKeepsTypesAcrossConfigs(t *testing.T) {
	const fsBody = "interface Box { readonly fs: TYPE }\nconst Box: Context.Service<Box, Box> = Context.Service<Box, Box>(\"test/Box\")\nconst layer: Layer<Box, never, TYPE> = Layer.effect(Box, effect { const fs = try VALUE; return { fs } })\n"
	fsSource := func(header, typ, value string) string {
		return header + strings.ReplaceAll(strings.ReplaceAll(fsBody, "TYPE", typ), "VALUE", value)
	}
	for _, tc := range []struct{ name, source, ambient string }{
		{"prelude qualified", fsSource("export {}\n", "FileSystem.FileSystem", "FileSystem.FileSystem"), ""},
		{"namespace qualified", fsSource("import * as FileSystem from \"effect/FileSystem\"\n", "FileSystem.FileSystem", "FileSystem.FileSystem"), ""},
		{"namespace bare type", fsSource("import * as FileSystem from \"effect/FileSystem\"\n", "FileSystem", "FileSystem.FileSystem"), ""},
		{"named bare type", fsSource("import { FileSystem } from \"effect/FileSystem\"\n", "FileSystem", "FileSystem"), ""},
		{"barrel bare type", fsSource("import { FileSystem } from \"effect\"\n", "FileSystem", "FileSystem.FileSystem"), ""},
		{"named interface heritage", "import { FileSystem } from \"effect/FileSystem\"\nimport * as NativeFS from \"effect/FileSystem\"\ninterface View extends FileSystem {}\nconst exact: View = undefined as unknown as NativeFS.FileSystem\n", ""},
		{"barrel interface heritage", "import { FileSystem } from \"effect\"\nimport * as NativeFS from \"effect/FileSystem\"\ninterface View extends FileSystem {}\nconst exact: View = undefined as unknown as NativeFS.FileSystem\n", ""},
		{"custom ambient Option", "export const value: Option.Option<number> = Option.some(1)\n", "export {}\ndeclare global { interface Option<A> { readonly hostBrand: A } }\n"},
		{"named custom ambient Option", "import type { Option } from \"effect/Option\"\nimport * as OptionValues from \"effect/Option\"\nconst value: Option<number> = OptionValues.some(1)\n", "export {}\ndeclare global { interface Option<A> { readonly hostBrand: A } }\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			dir := filepath.Dir(file.FileName().AsString())
			fs := bundled.WrapFS(osvfs.FS())
			config := func(name string, consumer bool) *tsoptions.ParsedCommandLine {
				libs := []string{"ES2022"}
				files := []string{"main.vibe"}
				if consumer {
					libs = append(libs, "DOM")
					if tc.ambient != "" {
						if err := os.WriteFile(filepath.Join(dir, "ambient.d.ts"), []byte(tc.ambient), 0600); err != nil {
							t.Fatal(err)
						}
						files = append(files, "ambient.d.ts")
					}
				}
				data, err := json.Marshal(map[string]any{"compilerOptions": map[string]any{"target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "noEmit": true, "types": []string{}, "lib": libs, "exactOptionalPropertyTypes": true}, "files": files})
				if err != nil {
					t.Fatal(err)
				}
				path := filepath.Join(dir, "tsconfig."+name+".json")
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
				parsed, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(path)), &core.CompilerOptions{}, nil, fs, nil)
				if len(errs) != 0 || len(parsed.Errors) != 0 {
					t.Fatalf("config: %v %v", errs, parsed.Errors)
				}
				return parsed
			}
			server, consumer := config("server", false), config("consumer", true)
			check := func(label string, cfg *tsoptions.ParsedCommandLine) {
				p := compiler.NewProgram(compiler.ProgramOptions{Config: cfg, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
				f := p.GetSourceFile(file.FileName())
				ds := append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...)
				for _, d := range ds {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("%s: %s\n%s", label, d.String(), f.Text())
					}
				}
			}
			check("server before", server)
			check("consumer before", consumer)
			result := FixProject(t.Context(), fs, bundled.LibPath(), server)
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %+v", result)
			}
			for name, fixed := range result.Files {
				if name != file.FileName() {
					t.Fatalf("changed unrelated file %s", name)
				}
				if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			check("server after", server)
			check("consumer after", consumer)
			again := FixProject(t.Context(), fs, bundled.LibPath(), server)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
}
