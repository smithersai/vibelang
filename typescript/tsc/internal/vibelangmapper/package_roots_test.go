package vibelangmapper

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestPackageWalkRoots(t *testing.T) {
	for _, root := range []string{"/", "c:/", "^/", "//server/"} {
		t.Run(root, func(t *testing.T) {
			for _, present := range []bool{false, true} {
				var reads []string
				read := func(name string) ([]byte, error) {
					reads = append(reads, name)
					if present && name == root+"package.json" {
						return []byte(`{"name":"root-package"}`), nil
					}
					if present && name == root+"node_modules/effect/package.json" {
						return []byte(`{"version":"4.1.0"}`), nil
					}
					return nil, errNotFound
				}
				file := root + "project/src/main.vibe"
				want := "main"
				if present {
					want = "root-package/project/src/main"
				}
				if got := moduleKey(file, read); got != want {
					t.Errorf("present=%t: module key %q, want %q", present, got, want)
				}
				versions := installedVersions(root+"project/src", []string{"effect"}, read)
				if (versions["effect"] == "4.1.0") != present {
					t.Errorf("present=%t: installed versions %v", present, versions)
				}
				for _, name := range reads {
					if !tspath.PathIsAbsolute(name) || !strings.HasPrefix(name, root) {
						t.Errorf("lookup escaped root %q: %q", root, name)
					}
				}
			}
			files, _ := projectPackageFiles(root + "project/tsconfig.json")
			want := []string{root + "project/package.json", root + "package.json"}
			slices.Sort(want)
			if !slices.Equal(files, want) {
				t.Errorf("watched manifests %q, want %q", files, want)
			}
		})
	}
}

func TestEmitSourceMapRootFiles(t *testing.T) {
	for _, root := range []string{"/", "c:/", "^/", "//server/"} {
		t.Run(root, func(t *testing.T) {
			const source = "export const value = 1"
			js, sourceMap, diagnostics := Emit(source, FileContext{FileName: root + "main.vibe"})
			if js == "" || sourceMap == "" || len(diagnostics) != 0 {
				t.Fatalf("emit failed: js=%q map=%q diagnostics=%v", js, sourceMap, diagnostics)
			}
		})
	}
}
