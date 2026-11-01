package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const portableReaderQuote = "plain `tsc` reads the compatibility declaration"

func TestSidecarPortabilityQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), portableReaderQuote) {
		t.Fatalf("missing sidecar reader rule: %s", portableReaderQuote)
	}
}

// portableCase is one module whose inferred type lives in a package only a
// dependency reaches: foldkit-33's Tabs.create names DispatchSync that way.
type portableCase struct {
	layout     string // private: the exports map hides the file; bare: no exports map; deep: one more package between
	resolution string
	shape      string
	kind       string
}

var (
	portableLayouts     = []string{"private", "bare", "deep"}
	portableResolutions = []string{"nodenext", "bundler"}
	portableShapes      = []string{"const", "object", "array", "arrow", "class"}
	portableKinds       = []string{"interface", "alias", "class", "generic"}
)

func parsePortableCase(data []byte) portableCase {
	pick := func(i int, keys []string, word string) string {
		if slices.Contains(keys, word) {
			return word
		}
		if i < len(data) {
			return keys[int(data[i])%len(keys)]
		}
		return keys[0]
	}
	words := append(strings.Split(string(data), ":"), "", "", "", "")
	return portableCase{pick(0, portableLayouts, words[0]), pick(1, portableResolutions, words[1]), pick(2, portableShapes, words[2]), pick(3, portableKinds, words[3])}
}

func (c portableCase) source() string {
	switch c.shape {
	case "object":
		return "export const value = { dispatch: work() }"
	case "array":
		return "export const value = [work()]"
	case "arrow":
		return "export const value = (): infer _ => work()"
	case "class":
		return "export class Value { readonly held = work() }\nexport const value = new Value()"
	}
	return "export const value = work()"
}

func (c portableCase) files(options string) map[string]any {
	declared := map[string]string{
		"interface": "export interface Value { readonly value: string }",
		"alias":     "export type Value = { readonly value: string }",
		"class":     "export declare class Value { readonly value: string }",
		"generic":   "export interface Boxed<T> { readonly value: T }\nexport type Value = Boxed<string>",
	}[c.kind]
	module := "esnext"
	if c.resolution == "nodenext" {
		module = "nodenext"
	}
	files := map[string]any{
		"/app/package.json":           `{"type":"module"}`,
		"/app/tsconfig.json":          fmt.Sprintf(`{"compilerOptions":{"strict":true,"skipLibCheck":true,"allowArbitraryExtensions":true,"types":[],"module":%q,"moduleResolution":%q%s},"files":["main.vibe"]}`, module, c.resolution, options),
		"/app/main.vibe":              "import { work } from \"ui\"\n" + c.source() + "\n",
		"/app/node_modules/ui":        vfstest.Symlink("/store/ui"),
		"/store/ui/package.json":      `{"type":"module","types":"index.d.ts","exports":{".":{"types":"./index.d.ts"}}}`,
		"/store/ui/node_modules/core": vfstest.Symlink("/store/core"),
		"/store/core/dist/value.d.ts": declared,
		"/store/core/package.json":    `{"type":"module"}`,
	}
	switch c.layout {
	case "private":
		files["/app/node_modules/core"] = vfstest.Symlink("/store/core")
		files["/store/core/package.json"] = `{"type":"module","exports":{"./public":{"types":"./index.d.ts"}}}`
		files["/store/core/index.d.ts"] = `import type { Value } from "./dist/value.js"; export declare function work(): Value;`
		files["/store/ui/index.d.ts"] = `export { work } from "core/public";`
	case "deep":
		files["/store/ui/index.d.ts"] = `export { work } from "mid";`
		files["/store/ui/node_modules/mid"] = vfstest.Symlink("/store/mid")
		files["/store/mid/package.json"] = `{"type":"module","types":"index.d.ts","exports":{".":{"types":"./index.d.ts"}}}`
		files["/store/mid/index.d.ts"] = `import type { Value } from "core/dist/value.js"; export declare function work(): Value;`
		files["/store/mid/node_modules/core"] = vfstest.Symlink("/store/core")
	default:
		files["/store/ui/index.d.ts"] = `import type { Value } from "core/dist/value.js"; export declare function work(): Value;`
	}
	return files
}

func portableProgram(t testing.TB, files map[string]any) *compiler.Program {
	t.Helper()
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}

func emitPortableSidecar(t testing.TB, files map[string]any) (string, []*ast.Diagnostic) {
	t.Helper()
	text := ""
	found := portableProgram(t, files).EmitDeclarationSidecars(t.Context(), func(fileName, sidecar string) error {
		if fileName == "/app/main.d.vibe.ts" {
			text = sidecar
		}
		return nil
	})
	if found == nil {
		return text, nil
	}
	return text, found.Diagnostics
}

// checkPortableReader reads the sidecar's text as a stock checker does, with the
// source gone, and misuses the export: an `any` would let the assignment
// through. The text sits beside the module as main.d.ts, which every checker
// resolves for ./main.js the same way (stock tsc also reads main.d.vibe.ts for
// ./main.vibe; VibeLang's own compiler wants the source there).
func checkPortableReader(t testing.TB, c portableCase, files map[string]any, sidecar string) []string {
	t.Helper()
	files["/app/main.d.ts"] = sidecar
	delete(files, "/app/main.vibe")
	files["/app/user.ts"] = "import { value } from \"./main.js\"\nexport const misuse: number = value\n"
	files["/app/tsconfig.json"] = strings.Replace(files["/app/tsconfig.json"].(string), `"main.vibe"`, `"user.ts"`, 1)
	program := portableProgram(t, files)
	var codes []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), program.GetSourceFile("/app/user.ts")) {
		codes = append(codes, fmt.Sprintf("TS%d", d.Code()))
	}
	return codes
}

func TestSidecarPortabilityRegression(t *testing.T) {
	t.Parallel()
	for _, layout := range portableLayouts {
		for _, options := range []string{"", `,"noEmit":true`, `,"declaration":false`} {
			c := portableCase{layout, "bundler", "object", "interface"}
			text, found := emitPortableSidecar(t, c.files(options))
			if len(found) != 0 {
				t.Errorf("%s %q: a project that emits no declarations reports %v", layout, options, found[0].String())
			}
			if strings.Contains(text, ": any") {
				t.Errorf("%s %q: weakened sidecar:\n%s", layout, options, text)
			}
			if codes := checkPortableReader(t, c, c.files(options), text); !slices.Contains(codes, "TS2322") {
				t.Errorf("%s %q: a reader of the sidecar lost the type (%v):\n%s", layout, options, codes, text)
			}
		}
		// A declaration project publishes this text, so TypeScript's rule stands.
		for _, options := range []string{`,"declaration":true`, `,"composite":true`} {
			c := portableCase{layout, "bundler", "object", "interface"}
			_, found := emitPortableSidecar(t, c.files(options))
			if !slices.ContainsFunc(found, func(d *ast.Diagnostic) bool { return d.Code() == 2883 }) {
				t.Errorf("%s %q: TS2883 is gone from a project that publishes declarations: %v", layout, options, found)
			}
		}
	}
}

// Chapter 7: "plain `tsc` reads the compatibility declaration". In a project that emits no
// declarations nothing is published, so a sidecar has one job: to give that
// reader the module's types. It names a type wherever it lives, and a misuse
// of the export stays an error (foldkit-33: Tabs.create in 11 modules).
func FuzzSidecarNamesItsType(f *testing.F) {
	startShortBudget(f)
	for _, seed := range []string{"private:bundler:const:interface", "private:bundler:object:interface", "bare:nodenext:array:alias", "deep:bundler:arrow:generic", "bare:bundler:class:class"} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestSidecarPortabilityQuoted(t)
		const target = "FuzzSidecarNamesItsType"
		defer recoverCompilerPanic(t, target)
		c := parsePortableCase(data)
		key := fmt.Sprintf("%s:%s:%s:%s", c.layout, c.resolution, c.shape, c.kind)
		text, found := emitPortableSidecar(t, c.files(""))
		if len(found) != 0 {
			Gap(t, target, "sidecar-reports:"+key, "Chapter 7: %s\nno declarations are emitted, yet: %s\n%s", portableReaderQuote, found[0].String(), c.source())
		}
		if strings.Contains(text, ": any") {
			Gap(t, target, "sidecar-any:"+key, "Chapter 7: %s\nweakened sidecar:\n%s", portableReaderQuote, text)
		}
		if codes := checkPortableReader(t, c, c.files(""), text); !slices.Contains(codes, "TS2322") {
			Gap(t, target, "sidecar-reader:"+key, "Chapter 7: %s\nmisusing the export reports %v:\n%s", portableReaderQuote, codes, text)
		}
	})
}
