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

func TestFixGateFollowsUneditedProviderInEditedModule(t *testing.T) {
	dir, config := fixFiles(t)
	middle := "import { modes } from './main.vibe'\nexport const values = modes()\nexport type Noise = Effect.Effect<number>\n"
	reporter := "import { values } from './middle.vibe'\nexport function more() {values.push('slow');return values}\n"
	for name, text := range map[string]string{"middle.vibe": middle, "more.vibe": reporter} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	// middle.vibe was created after config's root names were read; importing it
	// from more.vibe brings it into this same program.
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
	middleName := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "middle.vibe")))
	if _, ok := overlay[middleName]; !ok {
		t.Fatal("middle provider has no unrelated alias edit")
	}
	changed := build(overlay)
	errorCounts(t.Context(), changed)
	gate := fixGate{ctx: t.Context(), baseline: baseline, lastFailed: changed}
	origins := gate.errorSources(ps)
	want := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe")))
	if len(origins) != 1 || !origins[want] {
		t.Fatalf("origins=%v; want actual changed declaration in %s", origins, want)
	}
}
