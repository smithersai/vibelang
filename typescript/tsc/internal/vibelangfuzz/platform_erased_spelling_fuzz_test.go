package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const platformErasedSpellingQuote = "Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is."

func TestPlatformErasedSpellingQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformErasedSpellingQuote)
}

var platformErasedSpellingKeys = []string{
	"process-query", "process-value", "process-valid",
	"document-query", "document-value", "document-valid",
	"Buffer-query", "Buffer-value", "Buffer-valid",
}

func FuzzPlatformErasedSpelling(f *testing.F) {
	startShortBudget(f)
	for _, key := range platformErasedSpellingKeys {
		for _, mode := range []byte{0, 1, 4, 8, 64} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		TestPlatformErasedSpellingQuoted(t)
		index := slices.Index(platformErasedSpellingKeys, key)
		if index < 0 {
			index = int(mode) % len(platformErasedSpellingKeys)
			key = platformErasedSpellingKeys[index]
		}
		name, form, _ := strings.Cut(key, "-")
		typo := map[string]string{"process": "proces", "document": "documnt", "Buffer": "Buffe"}[name]
		member := map[string]string{"process": "pid", "document": "title", "Buffer": "value"}[name]
		ext := []string{".vibe", ".vibex"}[mode&1]
		native := mode&64 != 0
		if native {
			ext = []string{".ts", ".tsx"}[mode&1]
		}
		source := "export type Read = typeof " + typo
		if form == "query" && mode&4 != 0 {
			source += "." + member
		}
		if form == "query" && mode&8 != 0 {
			source = "export type Read = [typeof " + typo + "]"
		}
		if form == "value" {
			source = "export const read = " + typo
		}
		if form == "valid" {
			source = "export type Read = typeof " + name
		}
		if mode&16 != 0 {
			source = "namespace App { " + source + " }"
		}
		if mode&32 != 0 {
			source = "// retain diagnostic offset\r\n" + source
		}
		config := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[]},"files":["main%s","node_modules/@types/node/index.d.ts"]}`, ext)
		fs := bundled.WrapFS(vfstest.FromMap(map[string]string{
			"/project/package.json":                          `{"type":"module"}`,
			"/project/tsconfig.json":                         config,
			"/project/main" + ext:                            source,
			"/project/node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
			"/project/node_modules/@types/node/index.d.ts":   "declare var process: {readonly pid:number}; declare var Buffer: {readonly value:number};",
		}, tspath.CaseSensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		ds := program.GetSemanticDiagnostics(t.Context(), nil)
		if form == "valid" {
			if len(ds) != 0 {
				t.Fatalf("valid erased host read: %v", ds)
			}
			return
		}
		if len(ds) != 1 {
			t.Fatalf("invalid typo fixture: %v", ds)
		}
		d := ds[0]
		allowed := form == "query" || native
		want := int32(2304)
		if allowed {
			want = 2552
		}
		if d.Source() != "" || d.Code() != want || d.Category() != diagnostics.CategoryError || d.File().Text()[d.Pos():d.End()] != typo {
			Gap(t, "FuzzPlatformErasedSpelling", key, "erased references keep native diagnostics; want TS%d on %s, got %s", want, typo, d.String())
		}
		if allowed && !strings.Contains(d.String(), "Did you mean '"+name+"'") {
			Gap(t, "FuzzPlatformErasedSpelling", key, "erased host references keep the native suggestion: %s", d.String())
		}
	})
}
