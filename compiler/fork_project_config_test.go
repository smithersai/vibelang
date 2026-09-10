package compiler

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestPinnedForkProjectDiscovery(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	discoverer := backend.(ProjectDiscoverer)
	for _, tc := range []struct {
		name, config string
		files        map[string]string
		want         []string
		code         string
	}{
		{"implicit language glob", `{"compilerOptions":{` + nativeConfigOptions + `}}`, map[string]string{"main.vibe": "export const answer = 42;"}, []string{"main.vibe"}, ""},
		{"mixed roots", `{"compilerOptions":{` + nativeConfigOptions + `}}`, map[string]string{"main.vibe": "", "plain.ts": ""}, []string{"main.vibe", "plain.ts"}, ""},
		{"include exclude", `{"compilerOptions":{` + nativeConfigOptions + `},"include":["src/**/*"],"exclude":["src/skip/**"]}`, map[string]string{"main.vibe": "", "src/main.vibe": "", "src/skip/broken.vibe": "", "node_modules/pkg/a.vibe": ""}, []string{"src/main.vibe"}, ""},
		{"files bypass include", `{"compilerOptions":{` + nativeConfigOptions + `},"files":["other/main.vibe"],"include":[]}`, map[string]string{"other/main.vibe": "", "skip.vibe": ""}, []string{"other/main.vibe"}, ""},
		{"JSONC extends", "// comment\n{\"extends\":\"./base.json\",\"include\":[\"src/**/*\"],}", map[string]string{"base.json": `{"compilerOptions":{` + nativeConfigOptions + `,"rootDir":"src","outDir":"dist"}}`, "src/main.vibe": ""}, []string{"src/main.vibe"}, ""},
		{"weakening inherited flags", `{"extends":"./base.json","compilerOptions":{"strict":false}}`, map[string]string{"base.json": `{"compilerOptions":{` + nativeConfigOptions + `}}`, "main.vibe": ""}, []string{"main.vibe"}, "VIBE6001"},
		{"forbidden inherited flag", `{"extends":"./base.json"}`, map[string]string{"base.json": `{"compilerOptions":{` + nativeConfigOptions + `,"experimentalDecorators":false}}`, "main.vibe": ""}, []string{"main.vibe"}, "VIBE6002"},
		{"plain TypeScript unchanged", `{"compilerOptions":{"strict":false}}`, map[string]string{"main.ts": ""}, []string{"main.ts"}, ""},
		{"missing flags", `{}`, map[string]string{"main.vibe": ""}, []string{"main.vibe"}, "VIBE6001"},
		{"empty project", `{}`, map[string]string{}, []string{}, "TS18003"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			for name, source := range tc.files {
				file := filepath.Join(root, name)
				if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, []byte(source), 0600); err != nil {
					t.Fatal(err)
				}
			}
			config := filepath.Join(root, "tsconfig.json")
			if err := os.WriteFile(config, []byte(tc.config), 0600); err != nil {
				t.Fatal(err)
			}
			got, err := discoverer.DiscoverProject(ctx, ProjectConfigRequest{Path: config})
			if err != nil {
				t.Fatal(err)
			}
			want := make([]string, len(tc.want))
			for i, name := range tc.want {
				want[i] = filepath.Join(root, name)
			}
			if !reflect.DeepEqual(got.Files, want) {
				t.Fatalf("files: got %v want %v", got.Files, want)
			}
			if tc.code == "" && len(got.Diagnostics) != 0 {
				t.Fatalf("unexpected diagnostics: %+v", got.Diagnostics)
			}
			found := false
			for _, issue := range got.Diagnostics {
				found = found || issue.Code == tc.code
			}
			if tc.code != "" && !found {
				t.Fatalf("missing %s: %+v", tc.code, got.Diagnostics)
			}
			if tc.name == "JSONC extends" && (got.Options.RootDir != filepath.Join(root, "src") || got.Options.OutDir != filepath.Join(root, "dist")) {
				t.Fatalf("inherited layout lost: %+v", got.Options)
			}
		})
	}
	t.Run("request and source budgets", func(t *testing.T) {
		for _, path := range []string{"", "tsconfig.json", "/a/../tsconfig.json", "/bad\x00.json"} {
			if _, err := discoverer.DiscoverProject(ctx, ProjectConfigRequest{Path: path}); err == nil {
				t.Fatalf("accepted %q", path)
			}
		}
		root, _ := filepath.EvalSymlinks(t.TempDir())
		file := filepath.Join(root, "tsconfig.json")
		if err := os.WriteFile(file, []byte(strings.Repeat(" ", 2*1024*1024+1)), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := discoverer.DiscoverProject(ctx, ProjectConfigRequest{Path: file}); err == nil {
			t.Fatal("accepted over-budget config")
		}
	})
}
