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
	"strings"
	"testing"
)

func TestFixGateRetainsSafeReporterEdits(t *testing.T) {
	dir, _ := fixFiles(t)
	for i := range 10 {
		text := fmt.Sprintf("import {modes} from './main.vibe';\nexport function more%d(){const all=modes();all.push('slow');return all}\nexport type Noise%d=Effect.Effect<number>;\n", i, i)
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("reporter%02d.vibe", i)), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.Join(dir, "tsconfig.json")), &core.CompilerOptions{}, nil, fs, nil)
	if len(errs) > 0 || config == nil {
		t.Fatal(errs)
	}
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
	}
	original := build(nil)
	baseline := baselineOf(t.Context(), original)
	var proposals []proposal
	for _, f := range fixableFiles(original) {
		p := fileFixes(t.Context(), original, f, nil, tsFormFixCodes)
		if len(p.fixes) > 0 {
			proposals = append(proposals, p)
		}
	}
	builds := 0
	gate := fixGate{ctx: t.Context(), done: t.Context(), baseline: baseline, build: func(texts map[tspath.RootedFilePath]string) *compiler.Program { builds++; return build(texts) }}
	refused := 0
	accepted := gate.accept(nil, proposals, func(r FixRefusal, _ string) {
		refused++
		if r.Code != 4834 {
			t.Fatalf("unexpected refusal %+v", r)
		}
	})
	if len(accepted) != 42 || refused != 1 {
		t.Fatalf("accepted%d refused%d", len(accepted), refused)
	}
	after := map[tspath.RootedFilePath]string{}
	for _, p := range accepted {
		after[p.file.FileName()] = p.text()
		if strings.Contains(p.text(), "Noise") && strings.Contains(p.text(), "Effect.Effect") {
			t.Fatal("lost safe reporter edit")
		}
	}
	if errors := addedErrors(t.Context(), build(after), baseline); len(errors) > 0 {
		t.Fatal(errors)
	}
	t.Logf("%d complete candidate checks", builds)
	if builds > 5 {
		t.Fatalf("performed %d checks; want <=5", builds)
	}
}
