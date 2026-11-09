package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
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

func TestPlatformWrapperSpellingQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", "A wrapper changes how a failure is represented, not whether the platform may be called.")
	chapterSays(t, "005-services.md", "Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is.")
	chapterSays(t, "005-services.md", "A local binding, an import or an Effect module in scope (`Option`, `FileSystem`, `Headers`, `Worker`) shadows the global first, and a project's own `declare var fetch` is not a host declaration.")
}

var wrapperSpellingForms = []struct{ key, template string }{
	{"try", "Effect.try(() => %s)"},
	{"try-options", "Effect.try({try: () => %s, catch: (error: unknown) => error})"},
	{"promise", "Effect.tryPromise(() => Promise.resolve(%s))"},
	{"promise-options", "Effect.tryPromise({try: () => Promise.resolve(%s), catch: (error: unknown) => error})"},
	{"global-promise", "tryPromise(() => Promise.resolve(%s))"},
	{"sync", "sync(() => %s)"},
}
var wrapperSpellingNames = []struct{ key, name, typo string }{
	{"timer", "setTimeout", "setTimeuot"},
	{"status", "status", "statuz"},
	{"observer", "MutationObserver", "MutatonObserver"},
}

func FuzzPlatformWrapperSpelling(f *testing.F) {
	startShortBudget(f)
	var keys []string
	for _, form := range wrapperSpellingForms {
		for _, name := range wrapperSpellingNames {
			key := form.key + "/" + name.key
			keys = append(keys, key)
			f.Add(key, byte(16))
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		TestPlatformWrapperSpellingQuoted(t)
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		formKey, nameKey, _ := strings.Cut(key, "/")
		form := wrapperSpellingForms[slices.IndexFunc(wrapperSpellingForms, func(row struct{ key, template string }) bool { return row.key == formKey })]
		name := wrapperSpellingNames[slices.IndexFunc(wrapperSpellingNames, func(row struct{ key, name, typo string }) bool { return row.key == nameKey })]
		ext := []string{".vibe", ".vibex"}[mode&1]
		native := mode&64 != 0
		if native {
			ext = []string{".ts", ".tsx"}[mode&1]
		}
		allowed := native || mode&(4|8|16) != 0
		if mode&4 != 0 {
			name.name, name.typo = "TextEncoder", "TextEnocder"
		}
		expression := name.typo
		if mode&16 != 0 {
			expression = "(() => { type Held = typeof " + name.typo + "; return 1; })()"
		}
		source := "import * as Effect from \"effect/Effect\"; "
		if native {
			source += "import {sync, tryPromise} from \"effect/Effect\"; "
		}
		body := ""
		if mode&8 != 0 {
			body = "const " + name.name + " = 1; "
		}
		body += "export const value = " + fmt.Sprintf(form.template, expression)
		if mode&2 != 0 {
			body = "namespace App { " + body + " }"
		}
		source += body
		if mode&32 != 0 {
			source = "// source offsets: λ\r\n" + source
		}
		declarations := "export interface Effect<A, E = never, R = never> { readonly \"~effect/Effect\": { readonly _A: (_: never) => A; readonly _E: (_: never) => E; readonly _R: (_: never) => R } }\n" +
			"declare function attempt<A>(body: (() => A) | {try: () => A; catch: (error: unknown) => unknown}): Effect<A>;\n" +
			"export {attempt as try};\n" +
			"export declare function tryPromise<A>(body: (() => PromiseLike<A>) | {try: () => PromiseLike<A>; catch: (error: unknown) => unknown}): Effect<A>;\n" +
			"export declare function sync<A>(body: () => A): Effect<A>;"
		config := fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"target\":\"ESNext\",\"module\":\"NodeNext\",\"types\":[],\"lib\":[\"ESNext\",\"DOM\"]},\"files\":[\"main%s\"]}", ext)
		fs := bundled.WrapFS(vfstest.FromMap(map[string]string{
			"/project/package.json": "{\"type\":\"module\"}", "/project/tsconfig.json": config, "/project/main" + ext: source,
			"/project/node_modules/effect/package.json":     "{\"name\":\"effect\",\"type\":\"module\",\"exports\":{\".\":{\"types\":\"./index.d.ts\"},\"./Effect\":{\"types\":\"./Effect.d.ts\"},\"./Inspectable\":{\"types\":\"./Inspectable.d.ts\"}}}",
			"/project/node_modules/effect/index.d.ts":       "export * as Effect from \"./Effect.js\"; export * as Inspectable from \"./Inspectable.js\";",
			"/project/node_modules/effect/Inspectable.d.ts": "export declare const NodeInspectSymbol: unique symbol;",
			"/project/node_modules/effect/Effect.d.ts":      declarations,
		}, tspath.CaseSensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		ds := program.GetSemanticDiagnostics(t.Context(), nil)
		want := int32(2304)
		if allowed {
			want = 2552
		}
		if len(ds) != 1 || ds[0].Source() != "" || ds[0].Code() != want || ds[0].Category() != diagnostics.CategoryError {
			Gap(t, "FuzzPlatformWrapperSpelling", key, "wrapper callbacks retain the platform boundary; want native TS%d, got %v; source=%s", want, ds, source)
			return
		}
		d := ds[0]
		if d.File().Text()[d.Pos():d.End()] != name.typo {
			t.Fatalf("typo span changed: %s", d.String())
		}
		if allowed && !strings.Contains(d.String(), "Did you mean '"+name.name+"'") {
			Gap(t, "FuzzPlatformWrapperSpelling", key, "native control lost its suggestion: %s", d.String())
		}
	})
}

func TestPlatformWrapperSpellingCorpus(t *testing.T) {
	for _, form := range wrapperSpellingForms {
		for _, name := range wrapperSpellingNames {
			key := form.key + "/" + name.key
			file := filepath.Join("testdata/fuzz/FuzzPlatformWrapperSpelling", form.key+"-"+name.key)
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(data), fmt.Sprintf("string(%q)", key)) {
				t.Fatalf("corpus does not retain key %s", key)
			}
		}
	}
}
