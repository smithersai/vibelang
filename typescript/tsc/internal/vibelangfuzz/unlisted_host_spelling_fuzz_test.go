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

const unlistedHostSpellingBindingQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."
const unlistedHostSpellingErasedQuote = "Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is."

func TestUnlistedHostSpellingQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", unlistedHostSpellingBindingQuote)
	chapterSays(t, "005-services.md", unlistedHostSpellingErasedQuote)
}

var unlistedHostSpellingRules = []struct {
	key, name, typo, binding string
	banned                   bool
}{
	{"mutation", "MutationObserver", "MutatonObserver", "host", true},
	{"wasm", "WebAssembly", "WebAssemby", "host", true},
	{"screen", "screen", "screeen", "host", true},
	{"status", "status", "statuz", "host", true},
	{"allow-url", "URLSearchParams", "URLSearchParmas", "host", false},
	{"allow-encoder", "TextEncoder", "TextEnocder", "host", false},
	{"ecma", "ArrayBuffer", "ArrayBufferr", "host", false},
	{"local-status", "status", "statuz", "local", false},
	{"declared-status", "status", "statuz", "declared", false},
}

func FuzzUnlistedHostSpelling(f *testing.F) {
	startShortBudget(f)
	for _, row := range unlistedHostSpellingRules {
		for _, mode := range []byte{0, 4, 8, 64} {
			f.Add(row.key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		TestUnlistedHostSpellingQuoted(t)
		index := slices.IndexFunc(unlistedHostSpellingRules, func(row struct {
			key, name, typo, binding string
			banned                   bool
		}) bool {
			return row.key == key
		})
		if index < 0 {
			index = int(mode) % len(unlistedHostSpellingRules)
		}
		row := unlistedHostSpellingRules[index]
		key = row.key
		ext := []string{".vibe", ".vibex"}[mode&1]
		native := mode&64 != 0
		if native {
			ext = []string{".ts", ".tsx"}[mode&1]
		}
		query := mode&8 != 0
		qualified := !query && mode&4 != 0 && row.name == "WebAssembly"
		typeReference := !query && mode&4 != 0 && slices.Contains([]string{"MutationObserver", "URLSearchParams", "TextEncoder", "ArrayBuffer"}, row.name)
		ref := row.typo
		if !query && mode&128 != 0 {
			ref = "(" + ref + ")"
		}
		source := "export const value = " + ref
		if row.name == "WebAssembly" && mode&2 != 0 {
			source += ".Module"
		}
		if qualified {
			source = "export type Value = " + row.typo + ".Module"
		}
		if typeReference {
			source = "export type Value = " + row.typo
		}
		if query {
			source = "export type Value = typeof " + row.typo
		}
		if row.binding == "local" {
			source = "const status = 'ready'; " + source
		}
		if mode&16 != 0 {
			source = "namespace App { " + source + " }"
		}
		if mode&32 != 0 {
			source = "// preserve diagnostic offsets: λ\r\n" + source
		}
		libs := `["ESNext","DOM"]`
		extra := ""
		files := map[string]string{"/project/package.json": `{"type":"module"}`, "/project/main" + ext: source}
		if row.binding == "declared" {
			libs = `["ESNext"]`
			extra = `,"own.d.ts"`
			files["/project/own.d.ts"] = "declare var status: string;"
		}
		files["/project/tsconfig.json"] = fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[],"lib":%s},"files":["main%s"%s]}`, libs, ext, extra)
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		ds := program.GetSemanticDiagnostics(t.Context(), nil)
		if len(ds) != 1 {
			t.Fatalf("invalid typo fixture: %v", ds)
		}
		d := ds[0]
		allowed := !row.banned || native || query || typeReference || qualified
		want := int32(2304)
		if allowed {
			want = 2552
		}
		if qualified {
			want = 2833
		}
		if d.Source() != "" || d.Code() != want || d.Category() != diagnostics.CategoryError || d.File().Text()[d.Pos():d.End()] != row.typo {
			Gap(t, "FuzzUnlistedHostSpelling", key, "spelling suggestions follow the resolved host binding; want TS%d on %s, got %s", want, row.typo, d.String())
		}
		if allowed && !strings.Contains(d.String(), "Did you mean '"+row.name+"'") {
			Gap(t, "FuzzUnlistedHostSpelling", key, "native spelling suggestion missing: %s", d.String())
		}
	})
}
