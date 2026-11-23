package vibelang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A match in effect code runs inside a native try whose catch and finally
// release the match cache. No source stands for that cleanup, so each of its
// statements starts with a segment that has no source position: V8 coverage
// then counts only the arms the author wrote, and a match whose arms all ran
// reports no uncovered statement at its match keyword.
func TestMatchCacheCleanupHasNoSourcePosition(t *testing.T) {
	dir := t.TempDir()
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("package.json", `{"name":"match-cache-cleanup","type":"module"}`)
	write("tsconfig.json", `{"compilerOptions":{"target":"es2022","lib":["esnext"],"module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"outDir":"out"},"include":["*.vibe"]}`)
	write("main.vibe", strings.Join([]string{
		`export effect function relabel(program: string!{ readonly _tag: string }): string!{ readonly _tag: string } {`,
		`  return program catch effect (error) =>`,
		`    match (error) {`,
		`      when { _tag: "A" }: throw { _tag: "Relabelled" };`,
		`      default: throw error;`,
		`    }`,
		`}`,
		``,
	}, "\n"))
	fileSystem := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{SourceMap: core.TSTrue}, nil, fileSystem, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fileSystem, bundled.LibPath(), nil, nil, nil)})
	outputs := map[string]string{}
	var mutex sync.Mutex // the files of a program emit in parallel
	result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		mutex.Lock()
		defer mutex.Unlock()
		outputs[filepath.Base(string(name))] = text
		return nil
	}})
	if result.EmitSkipped {
		t.Fatalf("emit skipped: %v", result.Diagnostics)
	}
	var sourceMap struct {
		Mappings string `json:"mappings"`
	}
	if err := json.Unmarshal([]byte(outputs["main.js.map"]), &sourceMap); err != nil {
		t.Fatalf("main.js.map: %v", err)
	}
	type position struct{ line, character int }
	mappings := map[position]*sourcemap.Mapping{}
	for mapping := range sourcemap.DecodeMappings(sourceMap.Mappings).Values() {
		mappings[position{mapping.GeneratedLine, int(mapping.GeneratedCharacter)}] = mapping
	}
	lines := strings.Split(outputs["main.js"], "\n")
	// Each needle starts one statement of the cleanup, alone on its line.
	for _, needle := range []string{"try {", "catch (matchError_1) {", ".threw(matchError_1);", "throw matchError_1;", ".finish();"} {
		found := false
		for line, text := range lines {
			if !strings.Contains(text, needle) {
				continue
			}
			found = true
			start := len(text) - len(strings.TrimLeft(text, " "))
			mapping := mappings[position{line, start}]
			if mapping == nil {
				t.Errorf("%q at main.js %d:%d has no segment, so it takes the position before it:\n%s", needle, line+1, start, outputs["main.js"])
			} else if mapping.IsSourceMapping() {
				t.Errorf("%q at main.js %d:%d maps to main.vibe %d:%d, want no source position", needle, line+1, start, mapping.SourceLine+1, mapping.SourceCharacter)
			}
		}
		if !found {
			t.Fatalf("main.js has no %q:\n%s", needle, outputs["main.js"])
		}
	}
	// The protected source keeps its positions: each arm maps to its line.
	for needle, want := range map[string]int{`Effect_1.fail({ _tag: "Relabelled" })`: 3, `Effect_1.fail(error)`: 4} {
		mapped := false
		for line, text := range lines {
			if !strings.Contains(text, needle) {
				continue
			}
			for at, mapping := range mappings {
				if at.line == line && mapping.IsSourceMapping() && mapping.SourceLine == want {
					mapped = true
				}
			}
		}
		if !mapped {
			t.Errorf("%q does not map to main.vibe line %d", needle, want+1)
		}
	}
}
