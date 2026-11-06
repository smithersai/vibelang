package compiler

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestNativeReferenceIndirectDeclarationExport(t *testing.T) {
	for _, ext := range []string{".ts", ".vibe", ".vibex"} {
		t.Run(ext, func(t *testing.T) {
			files := map[string]any{
				"/app/tsconfig.json":     `{"compilerOptions":{"target":"es2022","strict":true,"module":"preserve","moduleResolution":"bundler","jsx":"preserve","declaration":true,"outDir":"out","types":[]},"files":["main.ts"],"references":[{"path":"../core"}]}`,
				"/app/main.ts":           `import { make } from "core/api"; export const result = make();`,
				"/app/node_modules/core": vfstest.Symlink("/core"),
				"/core/package.json":     fmt.Sprintf(`{"name":"core","exports":{"./*":"./src/*.ts","./Stage":"./src/Stage%s"}}`, ext),
				"/core/tsconfig.json":    `{"compilerOptions":{"target":"es2022","strict":true,"module":"preserve","moduleResolution":"bundler","composite":true,"rootDir":"src","outDir":"lib","jsx":"preserve","types":[]},"include":["src"]}`,
				"/core/src/api.ts":       `import { Stage } from "./Stage.js"; export const make = () => new Stage();`,
				"/core/src/Stage" + ext:  `export class Stage { private marker = 1; }`,
				"/core/lib/api.d.ts":     `import { Stage } from "./Stage.ts"; export declare const make: () => Stage;`,
				"/core/lib/Stage.d.ts":   `export declare class Stage { private marker; }`,
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			cfg, ds := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(ds) != 0 {
				t.Fatal(ds)
			}
			p := NewProgram(ProgramOptions{Config: cfg, Host: NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			if sf := p.GetSourceFile("/core/lib/Stage.d.ts"); sf != nil {
				if got := p.GetSourceOfProjectReferenceIfOutputIncluded(sf); got != tspath.RootedFilePath("/core/src/Stage"+ext) {
					t.Errorf("mapped source %q, want original source", got)
				}
			}
			for _, ref := range p.GetResolvedProjectReferences() {
				t.Log("reference roots", ref.FileNames())
			}
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				t.Error(d.String())
			}
			output := ""
			result := p.Emit(t.Context(), EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *WriteFileData) error {
				if strings.HasSuffix(name.AsString(), "main.d.ts") {
					output = text
				}
				return nil
			}})
			for _, d := range result.Diagnostics {
				t.Error(d.String())
			}
			if !strings.Contains(output, `import("core/Stage").Stage`) {
				t.Errorf("declaration lost public package name: %s", output)
			}
		})
	}
}
