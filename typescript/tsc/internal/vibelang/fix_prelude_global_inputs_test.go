package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A module that an ambient declaration imports is an input of every file
// using that declaration, even when those files have no explicit import.
func TestFixPreludeRefusalGlobalImports(t *testing.T) {
	for _, kind := range []string{"import", "reexport", "import-type"} {
		for depth := range 5 {
			t.Run(fmt.Sprintf("%s/%d", kind, depth), func(t *testing.T) { testPreludeRefusalGlobalInput(t, kind, depth, false) })
		}
	}
}

func FuzzFixPreludeRefusalGlobalInputs(f *testing.F) {
	for _, key := range []string{"import:0", "reexport:2", "import-type:4"} {
		f.Add([]byte(key))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		kinds := []string{"import", "reexport", "import-type"}
		kind, depth := kinds[0], 0
		if len(data) > 0 {
			kind = kinds[int(data[0])%len(kinds)]
		}
		if len(data) > 1 {
			depth = int(data[1]) % 5
		}
		if parts := strings.Split(string(data), ":"); len(parts) == 2 {
			for _, candidate := range kinds {
				if candidate == parts[0] {
					kind = candidate
				}
			}
			if n, err := strconv.Atoi(parts[1]); err == nil && n >= 0 && n < 5 {
				depth = n
			}
		}
		testPreludeRefusalGlobalInput(t, kind, depth, false)
	})
}

// A new parser error depends only on the proposed source. Changing an
// imported ambient type cannot repair an unclosed brace. This is the
// neighbourhood of the fourteen refused Smithers import rewrites.
func TestFixPreludeRefusalSyntaxGlobalInputs(t *testing.T) {
	for _, kind := range []string{"import", "reexport", "import-type"} {
		for depth := range 5 {
			t.Run(fmt.Sprintf("%s/%d", kind, depth), func(t *testing.T) {
				testPreludeRefusalGlobalInput(t, kind, depth, true)
			})
		}
	}
}

func FuzzFixPreludeRefusalSyntaxInputs(f *testing.F) {
	f.Add(byte(0), byte(0))
	f.Add(byte(1), byte(2))
	f.Add(byte(2), byte(4))
	f.Fuzz(func(t *testing.T, kind, depth byte) {
		kinds := []string{"import", "reexport", "import-type"}
		testPreludeRefusalGlobalInput(t, kinds[int(kind)%len(kinds)], int(depth)%5, true)
	})
}

func testPreludeRefusalGlobalInput(t testing.TB, kind string, depth int, syntax bool) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export const first = 1\n")
	dir := filepath.Dir(file.FileName().AsString())
	name := func(base string) tspath.RootedFilePath {
		return tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, base)))
	}
	declaration := "import type { Choice } from \"./dependency.vibe\"\ndeclare global { type RefusalGlobal = Choice }\n"
	files := map[string]string{
		"dependency.vibe": "export type Choice = string\n",
		"tsconfig.json":   `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`,
	}
	switch kind {
	case "reexport":
		declaration = "import type { Choice } from \"./bridge.js\"\ndeclare global { type RefusalGlobal = Choice }\n"
		files["bridge.ts"] = "export type { Choice } from \"./dependency.vibe\"\n"
	case "import-type":
		declaration = "export {}\ndeclare global { type RefusalGlobal = import(\"./dependency.vibe\").Choice }\n"
	}
	target := "./dependency.vibe"
	for i := range depth {
		edge := fmt.Sprintf("edge%d.ts", i)
		files[edge] = fmt.Sprintf("export type { Choice } from %q\n", target)
		target = fmt.Sprintf("./edge%d.js", i)
	}
	for base, text := range files {
		if base == "bridge.ts" {
			files[base] = strings.ReplaceAll(text, "./dependency.vibe", target)
		}
	}
	declaration = strings.ReplaceAll(declaration, "./dependency.vibe", target)
	files["globals.d.ts"] = declaration
	for base, text := range files {
		if err := os.WriteFile(filepath.Join(dir, base), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(name("tsconfig.json"), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	builds := 0
	parsed := &fixParsedFiles{}
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		builds++
		return fixProgram(fs, bundled.LibPath(), config, parsed, texts)
	}
	program := build(nil)
	baseline := baselineOf(t.Context(), program)
	if len(baseline.errors) != 0 {
		t.Fatalf("invalid control: %v", baseline.errors)
	}
	g := &fixGate{ctx: t.Context(), done: t.Context(), baseline: baseline, build: build}
	offered := func(p *compiler.Program) proposal {
		file := p.GetSourceFile(name("main.vibe"))
		end := len(file.Text())
		text := "const probe: RefusalGlobal = 1\n"
		if syntax {
			text = "const probe = {\n"
		}
		return proposal{file: file, fixes: []fileFix{{edits: []sourceEdit{{end, end, text}}, key: "prelude: main.vibe"}}}
	}
	g.recordPrelude = true
	kept := g.accept(nil, []proposal{offered(program)}, func(FixRefusal, string) {})
	g.recordPrelude = false
	if len(kept) != 0 || g.preludeRefusals[name("main.vibe")] == nil {
		t.Fatalf("want a refused string assignment, kept %d; memo %v", len(kept), g.preludeRefusals)
	}
	stableChecks := builds
	if !g.stillRefused(fs, program, programFilesKey(program), nil, offered(program)) || builds != stableChecks {
		t.Fatal("unchanged global inputs must reuse the refusal with zero checks")
	}
	texts := map[tspath.RootedFilePath]string{name("dependency.vibe"): "export type Choice = number\n"}
	next := build(texts)
	checks := builds
	if got := g.stillRefused(fs, next, programFilesKey(next), texts, offered(next)); got != syntax {
		t.Errorf("reuse after imported global input change = %v, want %v (syntax=%v)", got, syntax, syntax)
	}
	if builds != checks {
		t.Fatal("memo lookup built a program")
	}
	kept = g.accept(texts, []proposal{offered(next)}, func(FixRefusal, string) {})
	wantKept := 1
	if syntax {
		wantKept = 0
	}
	if len(kept) != wantKept || builds == checks {
		t.Fatalf("fresh control: kept %d, want %d; checks %d", len(kept), wantKept, builds-checks)
	}
	t.Logf("syntax=%v: memo lookup 0 checks; fresh control %d checks, kept %d", syntax, builds-checks, len(kept))
}
