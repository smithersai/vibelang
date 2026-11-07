package vibelangfuzz

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestLintBuildCleanQuoted(t *testing.T) { lintNoEmitQuoted(t) }

func lintBuildCleanSnapshot(t testing.TB, dir string) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		files[relative] = fmt.Sprintf("%x:%o", sha256.Sum256(data), info.Mode().Perm())
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func FuzzLintBuildClean(f *testing.F) {
	startShortBudget(f)
	keys := []string{"typescript", "vibelang", "references", "source-map", "declaration-map", "missing-output", "dry"}
	for _, key := range keys {
		f.Add(key, byte(0))
		f.Add(key, byte(31))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		TestLintBuildCleanQuoted(t)
		index := slices.Index(keys, key)
		if index < 0 {
			index = len(key) % len(keys)
			key = keys[index]
		}
		out, meta := "dist", "cache/project.tsbuildinfo"
		if mode&1 != 0 {
			out = "output ü"
			meta = "build data/project.tsbuildinfo"
		}
		input := "main.ts"
		if key == "vibelang" {
			input = "main.vibe"
		}
		globals := "interface Array<T>{length:number;[n:number]:T} interface Boolean{} interface CallableFunction{} interface Function{} interface IArguments{} interface NewableFunction{} interface Number{} interface Object{} interface RegExp{} interface String{}\n"
		config := func(name string, references bool) string {
			options := map[string]any{"target": "es2022", "module": "esnext", "strict": true, "noLib": true, "composite": true, "outDir": out, "tsBuildInfoFile": meta, "sourceMap": key == "source-map", "declarationMap": key == "declaration-map", "noEmit": mode&16 != 0}
			value := map[string]any{"compilerOptions": options, "files": []string{name, "globals.d.ts"}}
			if references {
				value["references"] = []map[string]string{{"path": "./dep"}}
			}
			data, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			return string(data)
		}
		source := "export const answer = 42\n"
		if mode&2 != 0 {
			source = "// retained ü😀\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{input: source, "globals.d.ts": globals}
		outputs := func(prefix string) {
			for name, text := range map[string]string{out + "/main.js": "keep JavaScript\n", out + "/main.d.ts": "keep declaration\n", meta: "keep build metadata\n"} {
				files[prefix+name] = text
			}
			if key == "source-map" {
				files[prefix+out+"/main.js.map"] = "keep source map\n"
			}
			if key == "declaration-map" {
				files[prefix+out+"/main.d.ts.map"] = "keep declaration map\n"
			}
		}
		if key != "missing-output" {
			outputs("")
		}
		if key == "references" {
			files["dep/tsconfig.json"] = config("main.ts", false)
			files["dep/main.ts"] = source
			files["dep/globals.d.ts"] = globals
			outputs("dep/")
		}
		dir, err := w.writeProject(Project{Files: files, Config: config(input, key == "references")})
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		before := lintBuildCleanSnapshot(t, dir)
		flag := "--build"
		if mode&4 != 0 {
			flag = "-b"
		}
		args := []string{flag, filepath.Join(dir, "tsconfig.json"), "--clean"}
		if key == "dry" {
			args = append(args, "--dry")
		}
		sys := &sidecarParitySystem{fs: w.fs, cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
		status := lint.Command(t.Context(), sys, args)
		after := lintBuildCleanSnapshot(t, dir)
		if status != 0 || !reflect.DeepEqual(before, after) {
			Gap(t, "FuzzLintBuildClean", key, "chapter 007 %q: lint clean must preserve existing project bytes and modes; status=%d mode=%d before=%v after=%v\n%s", lintNoEmitQuote, status, mode, before, after, sys.output.String())
		}
		ExpectPending(t, "FuzzLintBuildClean", key)
	})
}
