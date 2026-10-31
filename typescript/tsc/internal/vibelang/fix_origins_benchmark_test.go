package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// The fixture has one unsafe return-type narrowing among independent rewrites.
// Its only new error belongs to an unchanged importer.
func BenchmarkFixImporterErrorSearch(b *testing.B) {
	dir := b.TempDir()
	path := func(name string) tspath.RootedFilePath {
		return tspath.RootedFilePathFromAbsolute(filepath.Join(dir, name))
	}
	write := func(name, text string) {
		if err := os.WriteFile(path(name).AsString(), []byte(text), 0600); err != nil {
			b.Fatal(err)
		}
	}
	before, after := map[tspath.RootedFilePath]string{}, map[tspath.RootedFilePath]string{}
	before[path("main.ts")] = "export function modes(): string[] {return ['fast']}\n"
	after[path("main.ts")] = "export function modes(): 'fast'[] {return ['fast']}\n"
	for i := range 31 {
		name := path(fmt.Sprintf("f%02d.ts", i))
		before[name] = "export type T = Array<number>\n"
		after[name] = "export type T = ReadonlyArray<number>\n"
	}
	for name, text := range before {
		write(filepath.Base(name.AsString()), text)
	}
	write("more.ts", "import {modes} from './main.js'; const all=modes(); all.push('slow');\n")
	write("tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"include":["*.ts"]}`)
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(path("tsconfig.json"), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) > 0 || config == nil {
		b.Fatal(errors)
	}
	build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
	}
	program := build(nil)
	baseline := baselineOf(b.Context(), program)
	var proposals []proposal
	for _, file := range program.SourceFiles() {
		name := file.FileName()
		if text, ok := after[name]; ok {
			proposals = append(proposals, proposal{file: file, fixes: []fileFix{{code: 4834, key: name.AsString(), edits: []sourceEdit{{0, len(before[name]), text}}}}})
		}
	}
	if len(proposals) != 32 {
		b.Fatalf("got %d proposals", len(proposals))
	}
	builds := 0
	b.ReportAllocs()
	for b.Loop() {
		gate := fixGate{ctx: b.Context(), done: b.Context(), baseline: baseline, build: func(texts map[tspath.RootedFilePath]string) *compiler.Program { builds++; return build(texts) }}
		refused := 0
		accepted := gate.accept(nil, proposals, func(FixRefusal, string) { refused++ })
		if len(accepted) != 31 || refused != 1 {
			b.Fatalf("accepted %d, refused %d", len(accepted), refused)
		}
	}
	b.ReportMetric(float64(builds)/float64(b.N), "programs/op")
}
