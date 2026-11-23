package vibelang

import (
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

func TestNonExportedServiceShapeDeclaredInDts(t *testing.T) {
	source := strings.Join([]string{
		`service Private { static readonly key = "p"; v: number }`,
		`service Other { static readonly key = "o"; w: number }`,
		`service Third { static readonly key = "t"; z: number }`,
		`class P2 { v = 1 }`,
		`namespace P2 { export type Shape = { v: number } }`,
		`export const a: Private.Shape = { v: 1 }`,
		`export const b: P2.Shape = { v: 1 }`,
		`export effect function usesOther() { return (try Other).w }`,
		`export function annotated(x: Third.Shape): Array<Third.Shape> { return [x] }`,
		`export effect function main() { return 1 }`,
		``,
	}, "\n")

	dts := serviceAliasDeclaration(t, source)
	for _, want := range []string{
		"declare class Private ",
		"declare namespace Private",
		"declare class Third ",
		"declare namespace Third",
		"declare class Other ",
		"declare namespace Other",
	} {
		if !strings.Contains(dts, want) {
			t.Errorf("emitted main.d.ts missing %q:\n%s", want, dts)
		}
	}

	// Verify a TypeScript consumer with skipLibCheck: false checks cleanly against main.d.ts.
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "main.d.ts"), []byte(dts), 0600); err != nil {
		t.Fatal(err)
	}
	consumer := strings.Join([]string{
		`import { a, b, annotated } from "./main.js";`,
		`export const av: number = a.v;`,
		`export const bv: number = b.v;`,
		`export const tz: number = annotated({ z: 1 })[0].z;`,
		``,
	}, "\n")
	if err := os.WriteFile(filepath.Join(dir, "consumer.ts"), []byte(consumer), 0600); err != nil {
		t.Fatal(err)
	}
	cfgText := `{"compilerOptions":{"strict":true,"skipLibCheck":false,"target":"ES2022","module":"NodeNext","noEmit":true},"files":["main.d.ts","consumer.ts"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfgText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	cfg, errs := tsoptions.GetParsedCommandLineOfConfigFile(
		tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))),
		&core.CompilerOptions{}, nil, fs, nil,
	)
	if len(errs) != 0 {
		t.Fatalf("config errors: %v", errs)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{
		Config: cfg,
		Host:   compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
	})
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("consumer diagnostic with skipLibCheck:false: %s\n--- main.d.ts ---\n%s", d.String(), dts)
		}
	}
}
