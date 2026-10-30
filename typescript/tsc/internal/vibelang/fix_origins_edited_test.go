package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"testing"
)

func TestFixGateEditedImporterOrigins(t *testing.T) {
	dir, config := fixFiles(t)
	name := filepath.Join(dir, "more.vibe")
	source, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, append(source, []byte("\nexport type Noise = Effect.Effect<number>\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
	}
	original := build(nil)
	baseline := errorCounts(t.Context(), original)
	var ps []proposal
	overlay := map[tspath.RootedFilePath]string{}
	for _, f := range fixableFiles(original) {
		p := fileFixes(t.Context(), original, f, nil, tsFormFixCodes)
		if len(p.fixes) > 0 {
			ps = append(ps, p)
			overlay[f.FileName()] = p.text()
		}
	}
	reporter := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(name))
	if _, ok := overlay[reporter]; !ok {
		t.Fatal("importer has no unrelated safe edit")
	}
	changed := build(overlay)
	errorCounts(t.Context(), changed)
	gate := fixGate{ctx: t.Context(), baseline: baseline, lastFailed: changed}
	origins := gate.errorSources(ps)
	dependency := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe")))
	if len(origins) != 1 || !origins[dependency] {
		t.Fatalf("origins=%v; want only changed dependency %s", origins, dependency)
	}
}
