package compiler

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"gotest.tools/v3/assert"
)

func TestNativeProjectReferenceDeclarationExports(t *testing.T) {
	t.Parallel()
	for _, extension := range []string{".ts", ".vibe", ".vibex"} {
		for _, sourceRedirect := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/source=%t", extension, sourceRedirect), func(t *testing.T) {
				t.Parallel()
				files := map[string]any{
					"/app/tsconfig.json":         `{"compilerOptions":{"noLib":true,"strict":true,"module":"esnext","moduleResolution":"bundler","jsx":"preserve","types":[],"noEmit":true},"files":["main.ts"],"references":[{"path":"../core"}]}`,
					"/app/main.ts":               `import { value } from "core"; export const actual: number = value;`,
					"/app/node_modules/core":     vfstest.Symlink("/core"),
					"/core/package.json":         `{"name":"core","exports":{".":"./src/index.ts"}}`,
					"/core/tsconfig.json":        `{"compilerOptions":{"noLib":true,"strict":true,"module":"esnext","moduleResolution":"bundler","jsx":"preserve","types":[],"composite":true,"rootDir":"src","outDir":"lib"},"include":["src"]}`,
					"/core/src/index.ts":         `export * from "./data` + extension + `";`,
					"/core/src/data" + extension: `export const value: number = 1;`,
					"/core/lib/index.d.ts":       `export * from "./data.ts";`,
					"/core/lib/data.d.ts":        `export declare const value: number;`,
				}
				fs := vfstest.FromMap(files, tspath.CaseSensitive)
				config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
				assert.Equal(t, len(diagnostics), 0)
				program := NewProgram(ProgramOptions{Config: config, Host: NewCompilerHost(fs, "/", nil, nil, nil), UseSourceOfProjectReference: sourceRedirect})
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), nil) {
					t.Error(diagnostic.String())
				}
				if !sourceRedirect {
					assert.Assert(t, program.GetSourceFile("/core/lib/data.d.ts") != nil, "the referenced declaration retains its exported value")
				}
			})
		}
	}
}
