package compiler_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestNoEmitOnErrorDiagnosticSeverity(t *testing.T) {
	for _, row := range []struct {
		name, source string
		errorCode    int32
	}{
		{"warning permits emit", "export const answer: number = 42", 0},
		{"semantic error blocks emit", "export const answer: number = 'wrong'", 2322},
		{"warning does not hide declaration error", "export const answer = Math.max(1, 2)", 9010},
	} {
		t.Run(row.name, func(t *testing.T) {
			fs := bundled.WrapFS(vfstest.FromMap(map[string]string{
				"/src/index.vibe":    row.source,
				"/src/tsconfig.json": `{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","noEmitOnError":true,"isolatedDeclarations":true,"declaration":true,"outDir":"out"},"vibelang":{"declarationImportStyle":".js"},"files":["index.vibe"]}`,
			}, tspath.CaseSensitive))
			config, errs := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errs) != 0 {
				t.Fatal(errs)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			if ds := p.GetConfigFileParsingDiagnostics(); len(ds) != 1 || ds[0].Code() != 3011 || ds[0].Category() != diagnostics.CategoryWarning {
				t.Fatalf("expected the EK3011 deprecation warning, got %v", ds)
			}
			ds := append(p.GetSemanticDiagnostics(t.Context(), nil), p.GetDeclarationDiagnostics(t.Context(), nil)...)
			if row.errorCode == 0 && len(ds) != 0 || row.errorCode != 0 && (len(ds) != 1 || ds[0].Code() != row.errorCode || ds[0].Category() != diagnostics.CategoryError) {
				t.Fatalf("expected error code %d, got %v", row.errorCode, ds)
			}
			write := func(name, text string) error { return fs.WriteFile(tspath.RootedFilePathFromNormalized(name), text) }
			normal := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				return write(string(name), text)
			}})
			sidecars := p.EmitDeclarationSidecars(t.Context(), write)
			want := row.errorCode == 0
			if normal.EmitSkipped == want || sidecars.EmitSkipped == want {
				t.Fatalf("ordinary emit skipped=%v, sidecars skipped=%v", normal.EmitSkipped, sidecars.EmitSkipped)
			}
			for _, name := range []tspath.RootedFilePath{"/src/out/index.js", "/src/out/index.d.ts", "/src/index.d.vibe.ts"} {
				if _, ok := fs.ReadFile(name); ok != want {
					t.Errorf("wrote %s = %t, want %t", name, ok, want)
				}
			}
		})
	}
}
