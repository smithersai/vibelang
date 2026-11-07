package lint

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestCommandBuildPreservesFiles(t *testing.T) {
	variants := []struct {
		name     string
		args     []string
		existing bool
	}{
		{"fresh", nil, false}, {"existing", nil, true}, {"force", []string{"--force"}, true},
		{"clean", []string{"--clean"}, true}, {"clean-dry", []string{"--clean", "--dry"}, true},
	}
	for _, v := range variants {
		t.Run(v.name, func(t *testing.T) {
			dir := t.TempDir()
			files := map[string]string{
				"tsconfig.json": `{"compilerOptions":{"target":"es2022","module":"esnext","strict":true,"noLib":true,"composite":true,"outDir":"dist","tsBuildInfoFile":"cache/project.tsbuildinfo"},"files":["main.ts","globals.d.ts"]}`,
				"main.ts":       "export const answer = 42\n",
				"globals.d.ts":  "interface Array<T>{length:number;[n:number]:T} interface Boolean{} interface CallableFunction{} interface Function{} interface IArguments{} interface NewableFunction{} interface Number{} interface Object{} interface RegExp{} interface String{}\n",
			}
			if v.existing {
				files["dist/main.js"] = "keep JS\n"
				files["dist/main.d.ts"] = "keep declaration\n"
				files["cache/project.tsbuildinfo"] = "keep metadata\n"
			}
			for name, text := range files {
				p := filepath.Join(dir, name)
				if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(p, []byte(text), 0644); err != nil {
					t.Fatal(err)
				}
			}
			snapshot := func() map[string]string {
				result := map[string]string{}
				err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
					if err != nil {
						return err
					}
					if d.IsDir() {
						return nil
					}
					b, err := os.ReadFile(p)
					if err != nil {
						return err
					}
					rel, err := filepath.Rel(dir, p)
					if err != nil {
						return err
					}
					result[rel] = fmt.Sprintf("%x", sha256.Sum256(b))
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				return result
			}
			before := snapshot()
			sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
			args := append([]string{"--build", filepath.Join(dir, "tsconfig.json")}, v.args...)
			status := Command(t.Context(), sys, args)
			after := snapshot()
			output := sys.out.String() + sys.err.String()
			if status != 0 {
				t.Fatalf("lint build status=%d: %s", status, output)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatalf("lint mutated project: before=%v after=%v", before, after)
			}
			if strings.Contains(v.name, "clean") && (!strings.Contains(output, "main.js") || !strings.Contains(output, "project.tsbuildinfo")) {
				t.Fatalf("clean did not report its preserved outputs: %s", output)
			}
		})
	}
}
