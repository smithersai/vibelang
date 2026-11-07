package lint

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestCommandRejectsOxlintSelectors(t *testing.T) {
	data, err := os.ReadFile("../../vibelangfuzz/testdata/native-lint-selectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Key, Selector string
		Args          []string
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, config := range []string{"absent", "invalid-json", "typescript-config"} {
		for _, test := range cases {
			t.Run(config+"/"+test.Key, func(t *testing.T) {
				dir := t.TempDir()
				files := map[string]string{"tsconfig.json": `{"compilerOptions":{"strict":true,"declaration":true,"incremental":true,"tsBuildInfoFile":"build.tsbuildinfo"},"files":["main.ts"]}`, "main.ts": "export const value = 1\n"}
				if config == "invalid-json" {
					files[".oxlintrc.json"] = "not JSON"
				}
				if config == "typescript-config" {
					files["oxlint.config.ts"] = "throw new Error('not evaluated')"
				}
				for name, text := range files {
					if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
				args := append([]string{"-p", "."}, test.Args...)
				status := Command(t.Context(), sys, args)
				output := sys.out.String() + sys.err.String()
				if status == 0 || !strings.Contains(output, "error TS5023: Unknown compiler option") || !strings.Contains(output, test.Selector) {
					t.Fatalf("native option admission for %s: status=%d output=%s", test.Selector, status, output)
				}
				if strings.Contains(output, "vibelang lint:") {
					t.Fatalf("lint-specific selector entered the adapter: %s", output)
				}
				for _, name := range []string{"main.js", "main.d.ts", "build.tsbuildinfo"} {
					if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
						t.Fatalf("lint emitted %s: %v", name, err)
					}
				}
			})
		}
	}
}
