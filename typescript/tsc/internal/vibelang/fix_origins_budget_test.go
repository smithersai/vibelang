package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFixGateIgnoresUnrelatedDeclarationChains(t *testing.T) {
	dir, config := fixFiles(t)
	var noise strings.Builder
	noise.WriteString("const n0=0;\n")
	for i := 1; i <= 400; i++ {
		fmt.Fprintf(&noise, "const n%d=n%d+1;\n", i, i-1)
	}
	noise.WriteString("export const noise=n400;\n")
	files := map[string]string{
		"noise.ts":    noise.String(),
		"reporter.ts": "import {Effect} from 'effect';\nimport {modes} from './main.vibe';\nimport {noise} from './noise.js';\nfunction accept<const A extends readonly unknown[]>(value:A & (string extends A[1] ? unknown : {missing:string})):void {}\naccept([noise,Effect.runSync(modes())[0]] as const);\n",
		"more.vibe":   "import './reporter.js';\nexport {};\n",
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
	}
	original := build(nil)
	baseline := errorCounts(t.Context(), original)
	for key := range baseline {
		if strings.Contains(key, "TS2345") {
			t.Fatalf("invalid original fixture: %s", key)
		}
	}
	var ps []proposal
	overlay := map[tspath.RootedFilePath]string{}
	for _, f := range fixableFiles(original) {
		p := fileFixes(t.Context(), original, f, nil, tsFormFixCodes)
		if len(p.fixes) > 0 {
			ps = append(ps, p)
			overlay[f.FileName()] = p.text()
		}
	}
	changed := build(overlay)
	if len(addedErrors(t.Context(), changed, baseline)) == 0 {
		t.Fatal("fixture adds no error")
	}
	gate := fixGate{ctx: t.Context(), baseline: baseline, lastFailed: changed}
	origins := gate.errorSources(ps)
	want := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe")))
	if len(origins) != 1 || !origins[want] {
		t.Fatalf("origins=%v; want changed declaration in %s", origins, want)
	}
}
