package vibelang

import (
	"os"
	"path/filepath"
	"sort"
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

func durableWorkflowProgram(t *testing.T, extraFiles map[string]string, mainSrc string) (*compiler.Program, string) {
	t.Helper()
	_, file, _, _ := editorProgram(t, mainSrc)
	dir := filepath.Dir(file.FileName().AsString())
	names := []string{"main.vibe"}
	for name, content := range extraFiles {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	sort.Strings(names)
	var quoted []string
	for _, n := range names {
		quoted = append(quoted, `"`+n+`"`)
	}
	cfgText := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true},"vibe":{"experimental":["builtins"]},"files":[` + strings.Join(quoted, ",") + `]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfgText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	cfg, errs := tsoptions.GetParsedCommandLineOfConfigFile(
		tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))),
		&core.CompilerOptions{}, nil, fs, nil,
	)
	if len(errs) != 0 {
		t.Fatalf("config: %v", errs)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{
		Config: cfg,
		Host:   compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
	})
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("unexpected diagnostic: %s", d.String())
		}
	}
	var dts string
	p.Emit(t.Context(), compiler.EmitOptions{
		EmitOnly:  compiler.EmitOnlyDts,
		ForceEmit: true,
		WriteFile: func(name tspath.RootedFilePath, data string, _ *compiler.WriteFileData) error {
			if strings.HasSuffix(name.AsString(), "main.d.ts") {
				dts = data
			}
			return nil
		},
	})
	return p, dts
}

func TestWorkflowLayerIncludesLaterTask(t *testing.T) {
	source := strings.Join([]string{
		`service Db { static readonly key = "app/Db"; get(n: number): number!! }`,
		`workflow Sum { effect call(n: number): number!never { return try Double(n) } }`,
		`task Double { effect call(n: number): number!never { const db = try Db; return try db.get(n) } }`,
		`export const L = Sum.layer`,
		``,
	}, "\n")
	_, dts := durableWorkflowProgram(t, nil, source)
	if !strings.Contains(dts, "Db") {
		t.Fatalf("expected Sum.layer to require Db when task Double is declared below workflow Sum:\n%s", dts)
	}
}

func TestWorkflowLayerIncludesImportedTask(t *testing.T) {
	tasksSrc := strings.Join([]string{
		`export service Db { static readonly key = "app/Db"; get(n: number): number!! }`,
		`export task Double { effect call(n: number): number!never { const db = try Db; return try db.get(n) } }`,
		``,
	}, "\n")
	mainSrc := strings.Join([]string{
		`import { Double } from "./tasks.js"`,
		`workflow Sum { effect call(n: number): number!never { return try Double(n) } }`,
		`export const L = Sum.layer`,
		``,
	}, "\n")
	_, dts := durableWorkflowProgram(t, map[string]string{"tasks.vibe": tasksSrc}, mainSrc)
	if !strings.Contains(dts, "Db") {
		t.Fatalf("expected Sum.layer to require Db from imported task Double:\n%s", dts)
	}
}

func TestWorkflowLayerKeepsTaskWhenShadowedInNestedScope(t *testing.T) {
	source := strings.Join([]string{
		`service Db { static readonly key = "app/Db"; get(n: number): number!! }`,
		`task Double { effect call(n: number): number!never { const db = try Db; return try db.get(n) } }`,
		`workflow Sum {`,
		`  effect call(n: number): number!never {`,
		`    const ys = [1].map((Double) => Double + 1)`,
		`    return ys.length + try Double(n)`,
		`  }`,
		`}`,
		`export const L = Sum.layer`,
		``,
	}, "\n")
	_, dts := durableWorkflowProgram(t, nil, source)
	if !strings.Contains(dts, "Db") {
		t.Fatalf("expected Sum.layer to require Db even when nested callback parameter is named Double:\n%s", dts)
	}
}

func TestWorkflowBodyNamedFunctionAndClassExpressionsCompile(t *testing.T) {
	source := strings.Join([]string{
		`task Double { effect call(n: number): number!never { return n * 2 } }`,
		`export workflow Sum {`,
		`  effect call(n: number): number!never {`,
		`    const fact = function go(k: number): number { return k <= 1 ? 1 : k * go(k - 1) }`,
		`    const Box = class Inner { static make(v: number) { return new Inner(v) } constructor(public readonly v: number) {} }`,
		`    return fact(n) + Box.make(n).v + try Double(n)`,
		`  }`,
		`}`,
		``,
	}, "\n")
	durableWorkflowProgram(t, nil, source)
}

func TestMutuallyRecursiveWorkflowHandoffsHaveNoCycleError(t *testing.T) {
	source := strings.Join([]string{
		`task Step { effect call(n: number): number!never { return n + 1 } }`,
		`export workflow Even {`,
		`  effect call(n: number): number!never {`,
		`    if (n <= 0) return try Step(0)`,
		`    return Odd.to(n - 1)`,
		`  }`,
		`}`,
		`export workflow Odd {`,
		`  effect call(n: number): number!never {`,
		`    if (n <= 0) return try Step(1)`,
		`    return Even.to(n - 1)`,
		`  }`,
		`}`,
		``,
	}, "\n")
	durableWorkflowProgram(t, nil, source)
}
