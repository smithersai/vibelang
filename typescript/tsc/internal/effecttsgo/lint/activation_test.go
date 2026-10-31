package lint

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A vibe.severities entry turns the imported Effect lints on only when it
// names one of their EK38xx codes. Setting a VibeLang warning such as EK4842
// leaves a project without the Effect plugin as it was (foldkit-14: one
// "EK4842": "off" added 29 errors and 1036 warnings to existing TypeScript).
func TestOnlyAnImportedLintCodeTurnsTheLintsOn(t *testing.T) {
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../../experiments/node_modules"
	}
	effect, err := filepath.Abs(filepath.Join(modules, "effect"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(effect, "package.json")); err != nil {
		t.Skipf("effect is not installed: %v", err)
	}
	for _, test := range []struct {
		name, vibe string
		want       bool
	}{
		{"no vibe options", ``, false},
		{"a VibeLang warning", `,"vibe":{"severities":{"EK4842":"off"}}`, false},
		{"two VibeLang warnings", `,"vibe":{"severities":{"EK0801":"error","EK4842":"warning"}}`, false},
		{"an imported lint code", `,"vibe":{"severities":{"EK3801":"error"}}`, true},
		{"an imported lint code turned off", `,"vibe":{"severities":{"EK3801":"off"}}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(effect, filepath.Join(dir, "node_modules", "effect")); err != nil {
				t.Fatal(err)
			}
			for name, text := range map[string]string{
				"package.json":  `{"private":true,"type":"module"}`,
				"tsconfig.json": `{"compilerOptions":{"target":"es2022","module":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"files":["main.ts"]` + test.vibe + `}`,
				"main.ts":       "import { Effect } from \"effect\"\nEffect.succeed(1)\n",
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errs) != 0 || len(config.Errors) != 0 {
				t.Fatalf("config: %v %v", errs, config.Errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.ts"))))
			var codes []string
			for _, d := range program.GetSemanticDiagnostics(context.Background(), file) {
				if d.Code() == 3801 {
					codes = append(codes, d.String())
				}
			}
			floating := len(codes) != 0
			if floating != test.want {
				t.Fatalf("EK3801 reported: %v, want %v; lint diagnostics: %q", floating, test.want, codes)
			}
		})
	}
}
