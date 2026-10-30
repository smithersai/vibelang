package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"testing"
)

func TestCanonicalForeignSettingsDiscovery(t *testing.T) {
	for _, tc := range []struct {
		name    string
		configs []string
		want    string
	}{
		{"canonical only", []string{"/producer/vibe.config.json"}, "/producer/vibe.config.json"},
		{"canonical precedence", []string{"/producer/vibe.config.json", "/producer/tsconfig.json", "/producer/jsconfig.json"}, "/producer/vibe.config.json"},
		{"jsconfig only", []string{"/producer/jsconfig.json"}, "/producer/jsconfig.json"},
		{"nearest legacy first", []string{"/vibe.config.json", "/producer/jsconfig.json"}, "/producer/jsconfig.json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := map[string]string{"/producer/src/lib.vibe": "export const x = 1"}
			for _, name := range tc.configs {
				files[name] = "{}"
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			config := tsoptions.ParseCommandLine([]string{"--noLib", "/producer/src/lib.vibe"}, fs, "/")
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			file := program.GetSourceFile("/producer/src/lib.vibe")
			if file == nil {
				t.Fatal("fixture file is missing")
			}
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			got := nearestConfig(c, tspath.ToRootedDirectoryPath("/producer/src", "/"))
			if got.AsString() != tc.want {
				t.Fatalf("nearest config = %q; want %q", got, tc.want)
			}
		})
	}
}
