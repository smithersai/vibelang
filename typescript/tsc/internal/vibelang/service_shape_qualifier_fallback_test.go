package vibelang

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Service Shape editor lookup leaves ordinary namespaces and unresolved
// qualifiers to native resolution without re-entering the same name hook.
func TestServiceShapeQualifierFallback(t *testing.T) {
	var cases []struct {
		Key, Source string
		Errors      []string
		Files       map[string]string
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/shape-qualifier-fallback.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Key, func(t *testing.T) {
			p := shapeQualifierProgram(t, test.Source, test.Files)
			var got []string
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), nil), p.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				prefix := d.Source()
				if prefix == "" {
					prefix = "TS"
				}
				got = append(got, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
			slices.Sort(got)
			if !slices.Equal(got, test.Errors) {
				t.Fatalf("want native errors %v, got %v", test.Errors, got)
			}
		})
	}
}

// Keep the regression's import fixtures in its own project. The production
// editor setup and language-service helpers remain shared and unchanged.
func shapeQualifierProgram(t *testing.T, source string, files map[string]string) *compiler.Program {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, target := range editorPackages {
		if err = os.Symlink(filepath.Join(root, target), filepath.Join(dir, "node_modules", name)); err != nil {
			t.Fatal(err)
		}
	}
	sources := map[string]string{
		"main.vibe":     source,
		"package.json":  editorPackageJSON,
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"files":["main.vibe"]}`,
	}
	for name, text := range files {
		sources[name] = text
	}
	for name, text := range sources {
		if err = os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	path := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}
