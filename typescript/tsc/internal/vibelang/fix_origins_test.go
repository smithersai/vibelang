package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// An error in an unchanged importer should lead the search back to the edited
// declaration, without checking every binary partition of unrelated aliases.
func TestFixGateFollowsImporterErrorSources(t *testing.T) {
	testFixGateImporterOrigins(t, false)
}

func TestFixGateFindsSourceSharedByImporterErrors(t *testing.T) {
	testFixGateImporterOrigins(t, true)
}

func testFixGateImporterOrigins(t *testing.T, many bool) {
	t.Helper()
	dir, config := fixFiles(t)
	if many {
		for i := range 10 {
			source := fmt.Sprintf("import { modes } from './main.vibe'\nimport type { T%d } from './f%02d.vibe'\nexport function more%d() {const all=modes();all.push('slow' as ('slow' | (T%d & never)));return all}\n", i, i, i, i)
			if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("more%d.vibe", i)), []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
		}
		var errors []*ast.Diagnostic
		config, errors = tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.Join(dir, "tsconfig.json")), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
		if len(errors) > 0 || config == nil {
			t.Fatal(errors)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
	}
	program := build(nil)
	baseline := errorCounts(t.Context(), program)
	var proposals []proposal
	for _, file := range fixableFiles(program) {
		p := fileFixes(t.Context(), program, file, nil, tsFormFixCodes)
		if len(p.fixes) > 0 {
			proposals = append(proposals, p)
		}
	}
	if len(proposals) != 32 {
		t.Fatalf("got %d proposals, want 32", len(proposals))
	}
	builds := 0
	gate := fixGate{ctx: t.Context(), done: t.Context(), baseline: baseline, build: func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		builds++
		return build(texts)
	}}
	var refusals []FixRefusal
	accepted := gate.accept(nil, proposals, func(r FixRefusal, _ string) { refusals = append(refusals, r) })
	if len(accepted) != 32 || len(refusals) != 1 || refusals[0].Code != 4834 || !strings.Contains(refusals[0].Error, "more") {
		t.Fatalf("accepted %d files, refused %+v", len(accepted), refusals)
	}
	texts := map[tspath.RootedFilePath]string{}
	for _, p := range accepted {
		texts[p.file.FileName()] = p.text()
	}
	if added := addedErrors(t.Context(), build(texts), baseline); len(added) != 0 {
		t.Fatalf("accepted edits add errors: %v", added)
	}
	t.Logf("%d complete candidate checks", builds)
	if builds > 5 {
		t.Fatalf("built %d programs; want at most 5", builds)
	}
}

// Errors in edited files already have their own partition. They must not
// outvote the shared dependency named by an unchanged importer's errors.
func TestFixGatePrioritizesImporterOrigins(t *testing.T) {
	dir, config := fixFiles(t)
	fs := bundled.WrapFS(osvfs.FS())
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
	}
	original := build(nil)
	baseline := errorCounts(t.Context(), original)
	var proposals []proposal
	main := tspath.RootedFilePathFromAbsolute(filepath.Join(dir, "main.vibe"))
	direct := tspath.RootedFilePathFromAbsolute(filepath.Join(dir, "f00.vibe"))
	var rewritten string
	for _, file := range fixableFiles(original) {
		p := fileFixes(t.Context(), original, file, nil, tsFormFixCodes)
		if len(p.fixes) > 0 {
			proposals = append(proposals, p)
		}
		if file.FileName() == main {
			rewritten = p.text()
		}
	}
	bad := original.GetSourceFile(direct).Text() + "\nexport const broken1: number = 'bad'\nexport const broken2: number = 'bad'\n"
	for _, importer := range []bool{true, false} {
		texts := map[tspath.RootedFilePath]string{direct: bad}
		want := direct
		if importer {
			texts[main] = rewritten
			want = main
		}
		program := build(texts)
		errorCounts(t.Context(), program)
		gate := fixGate{ctx: t.Context(), baseline: baseline, lastFailed: program}
		origins := gate.errorSources(proposals)
		if len(origins) != 1 || !origins[want] {
			t.Fatalf("importer=%v: origins=%v; want only %s", importer, origins, want)
		}
	}
}
