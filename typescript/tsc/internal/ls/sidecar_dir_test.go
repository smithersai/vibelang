package ls_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Decided detail 268: with vibe.sidecarDir and rootDirs, as beside the
// source, the language server reads a .ts file's ./x.vibe import from the
// source, never from a sidecar in either place, so a stale sidecar changes
// neither its diagnostics nor where go-to-definition lands.
func TestLanguageServiceResolvesVibeSourceInBothSidecarModes(t *testing.T) {
	t.Parallel()
	const options = `"target":"esnext","module":"nodenext","moduleResolution":"nodenext","strict":true,"skipLibCheck":true,"noEmit":true,"allowArbitraryExtensions":true,"rewriteRelativeImportExtensions":true`
	const stale = "export declare function greet(name: number): number;\n"
	for _, mode := range []struct {
		name, config, sidecar string
	}{
		{"beside", `{"compilerOptions":{` + options + `},"include":["src"]}`, "/project/src/greet.d.vibe.ts"},
		{"directory", `{"compilerOptions":{` + options + `,"rootDirs":[".",".vibe/declarations"]},"vibe":{"sidecarDir":".vibe/declarations"},"include":["src"]}`, "/project/.vibe/declarations/src/greet.d.vibe.ts"},
	} {
		t.Run(mode.name, func(t *testing.T) {
			t.Parallel()
			main := "import { greet } from \"./greet.vibe\"\nexport const n: string = greet(\"Ada\")\n"
			files := map[string]string{
				"/project/tsconfig.json":  mode.config,
				"/project/src/greet.vibe": "export function greet(name: string): string {\n  return name\n}\n",
				"/project/src/main.ts":    main,
				mode.sidecar:              stale,
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			for _, name := range parsed.FileNames() {
				if strings.HasSuffix(name.AsString(), ".d.vibe.ts") {
					t.Fatalf("the project includes the sidecar %s", name)
				}
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			file := p.GetSourceFile("/project/src/main.ts")
			if diagnostics := p.GetSemanticDiagnostics(t.Context(), file); len(diagnostics) != 0 {
				t.Fatalf("main.ts read the stale sidecar: %v", diagnostics[0].String())
			}
			if p.GetSourceFile(tspath.RootedFilePath(mode.sidecar)) != nil {
				t.Fatalf("the program loaded %s", mode.sidecar)
			}
			converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
				return lsconv.ComputeLSPLineStarts(files[string(name)])
			})
			service := ls.NewLanguageService(nil, p, retiredModulesHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, "/project/src/main.ts")
			position, _ := converters.ToLSPPosition(file, core.TextPos(strings.LastIndex(main, "greet")))
			definition, err := service.ProvideDefinition(t.Context(), lsconv.FileNameToDocumentURI(file.FileName()), position)
			if err != nil {
				t.Fatal(err)
			}
			var targets []string
			if definition.Location != nil {
				targets = append(targets, string(definition.Location.Uri))
			}
			if definition.Locations != nil {
				for _, location := range *definition.Locations {
					targets = append(targets, string(location.Uri))
				}
			}
			if definition.DefinitionLinks != nil {
				for _, link := range *definition.DefinitionLinks {
					targets = append(targets, string(link.TargetUri))
				}
			}
			if len(targets) == 0 || !strings.HasSuffix(targets[0], "/project/src/greet.vibe") || len(targets) != 1 {
				t.Fatalf("go-to-definition lands at %v, want the source greet.vibe", targets)
			}
		})
	}
}
