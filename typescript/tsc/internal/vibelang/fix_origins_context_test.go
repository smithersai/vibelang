package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"testing"
)

func TestFixGatePrefersStableContextInEditedImporter(t *testing.T) {
	dir, _ := fixFiles(t)
	original := map[string]string{
		"source.ts":      "export const value: number=1;\n",
		"alternative.ts": "export const value: number=1;\n",
		"stable.ts":      "import {value} from './source.js';\nexport const stable: number=value;\nexport type Noise=Array<number>;\n",
	}
	changed := map[string]string{
		"source.ts":      "export const value: string='bad';\n",
		"alternative.ts": "export const value: string='bad';\n",
		"stable.ts":      "import {value} from './source.js';\nexport const stable: number=value;\nexport type Noise=ReadonlyArray<number>;\n",
	}
	for i := range 10 {
		name := fmt.Sprintf("changing%02d.ts", i)
		original[name] = "import {value} from './alternative.js';\nexport function f(): number {return value}\n"
		changed[name] = "import {value} from './alternative.js';\nexport function f(): number {/* unrelated body edit */ return value}\n"
	}
	for name, text := range original {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.Join(dir, "tsconfig.json")), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) > 0 || config == nil {
		t.Fatal(errors)
	}
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
	}
	base := build(nil)
	baseline := baselineOf(t.Context(), base)
	var ps []proposal
	overlay := map[tspath.RootedFilePath]string{}
	for name, text := range changed {
		path := tspath.RootedFilePathFromAbsolute(filepath.Join(dir, name))
		f := base.GetSourceFile(path)
		if f == nil {
			t.Fatal(name)
		}
		ps = append(ps, proposal{file: f, fixes: []fileFix{{code: 4830, key: name, edits: []sourceEdit{{0, len(f.Text()), text}}}}})
		overlay[path] = text
	}
	trial := build(overlay)
	errorCounts(t.Context(), trial)
	gate := fixGate{ctx: t.Context(), baseline: baseline, lastFailed: trial}
	origins := gate.errorSources(ps)
	want := tspath.RootedFilePathFromAbsolute(filepath.Join(dir, "source.ts"))
	if len(origins) != 1 || !origins[want] {
		t.Fatalf("origins=%v; want stable importer origin %s", origins, want)
	}
}
