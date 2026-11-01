package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// specifierProjectDir returns the directory of the project computedKeyFiles
// writes, the one computedKeyProgram builds.
func specifierProjectDir(files map[string]string) string {
	for name := range files {
		if strings.HasSuffix(name, "/src/tsconfig.json") {
			return strings.TrimSuffix(name, "tsconfig.json")
		}
	}
	panic("computedKeyFiles writes no src/tsconfig.json")
}

// specifierFiles is a project whose entry main.<extension> imports the
// TypeScript sibling helper.ts and the VibeLang sibling users.vibe.
func specifierFiles(extension, source, options string) (map[string]string, string) {
	files := computedKeyFiles(false)
	dir := specifierProjectDir(files)
	files[dir+"helper.ts"] = "export interface H { n: number }\nexport const helper = 1\nexport const make = () => ({ deep: { n: 1 } as H })\n"
	files[dir+"users.vibe"] = "export interface User { name: string }\nexport const anyone: User = { name: \"a\" }\n"
	files[dir+"main."+extension] = source
	files[dir+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true` + options + `},"files":["main.` + extension + `"]}`
	return files, dir
}

// emitSpecifierProject returns the main.d.ts and main.js that files emit, and
// its error diagnostics.
func emitSpecifierProject(t *testing.T, files map[string]string) (dts, js string, errors []string) {
	t.Helper()
	p := computedKeyProgram(t, files)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d.String())
		}
	}
	result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		switch {
		case strings.HasSuffix(string(name), "/main.d.ts"):
			dts = text
		case strings.HasSuffix(string(name), "/main.js"):
			js = text
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d.String())
		}
	}
	return dts, js, errors
}

// asTypeScript is source as a .ts module writes it: a TypeScript module names
// a VibeLang module by its output, ./users.js (D31).
func asTypeScript(source string) string {
	return strings.ReplaceAll(source, `"./users.vibe"`, `"./users.js"`)
}

// A .vibe module's declaration names a TypeScript sibling as the source
// writes it, ./helper.ts, as stock TypeScript's declaration of the same
// module does; only a VibeLang module's ./users.vibe becomes ./users.js
// (decided detail 263). Before, every relative .ts specifier became .js, so
// each t3code module migrated beside unchanged .ts siblings changed its
// declarations (drive-t3code-server slices 2 and 8, 2026-11-01).
func TestDeclarationKeepsWrittenTypeScriptSpecifier(t *testing.T) {
	t.Parallel()
	const source = `import type { H } from "./helper.ts"
import { make } from "./helper.ts"
import type { User } from "./users.vibe"
export { helper } from "./helper.ts"
export * as Helper from "./helper.ts"
export type { H as Shape } from "./helper.ts"
export { anyone } from "./users.vibe"
export type HelperModule = typeof import("./helper.ts")
export const value: H = { n: 1 }
export const made = make()
export const user: User = { name: "b" }
`
	const options = `,"allowImportingTsExtensions":true,"rewriteRelativeImportExtensions":true`
	files, _ := specifierFiles("ts", asTypeScript(source), options)
	stock, _, errors := emitSpecifierProject(t, files)
	if len(errors) != 0 || stock == "" {
		t.Fatalf("control: the .ts module emits %q with errors %v", stock, errors)
	}
	files, _ = specifierFiles("vibe", source, options)
	dts, js, errors := emitSpecifierProject(t, files)
	if len(errors) != 0 {
		t.Fatalf("the .vibe module reports %v", errors)
	}
	if dts != stock {
		t.Fatalf("the .vibe module's declaration differs from TypeScript's\n--- .ts\n%s\n--- .vibe\n%s", stock, dts)
	}
	for _, want := range []string{`from "./helper.ts"`, `import("./helper.ts")`, `from "./users.js"`} {
		if !strings.Contains(dts, want) {
			t.Errorf("the declaration lacks %s:\n%s", want, dts)
		}
	}
	// The JavaScript still imports the outputs (D31).
	if strings.Contains(js, `"./helper.ts"`) || !strings.Contains(js, `"./helper.js"`) {
		t.Errorf("the JavaScript does not import ./helper.js:\n%s", js)
	}
	// Without allowImportingTsExtensions, which a .vibe file does not need
	// to name ./helper.ts, the declaration keeps the written specifier too:
	// stock TypeScript accepts a .ts specifier in a declaration file.
	files, _ = specifierFiles("vibe", source, "")
	plain, _, errors := emitSpecifierProject(t, files)
	if len(errors) != 0 || plain != stock {
		t.Fatalf("without allowImportingTsExtensions: errors %v, declaration\n%s", errors, plain)
	}
}

// specifierForms and specifierTargets span the import and export forms whose
// specifier a declaration keeps, and the specifiers a .vibe module may write
// for a TypeScript sibling, a VibeLang sibling and a package.
var (
	specifierTargets = []struct{ specifier, value, typeName string }{
		{`"./helper.ts"`, "helper", "H"},
		{`"./helper.js"`, "helper", "H"},
		{`"./users.vibe"`, "anyone", "User"},
		{`"./users.js"`, "anyone", "User"},
		{`"effect/Effect"`, "", "Effect"},
	}
	specifierForms = []func(i int, specifier, value, typeName string) string{
		func(i int, s, v, ty string) string {
			if v == "" {
				return ""
			}
			return fmt.Sprintf("export { %s as v%d } from %s\n", v, i, s)
		},
		func(i int, s, _, ty string) string {
			return fmt.Sprintf("export type { %s as T%d } from %s\n", ty, i, s)
		},
		func(i int, s, _, _ string) string { return fmt.Sprintf("export * as N%d from %s\n", i, s) },
		func(i int, s, _, ty string) string {
			return fmt.Sprintf("import type { %s as I%d } from %s\nexport type U%d = I%d%s\n", ty, i, s, i, i, map[bool]string{true: "<number>", false: ""}[ty == "Effect"])
		},
		func(i int, s, v, _ string) string {
			if v == "" {
				return ""
			}
			return fmt.Sprintf("import { %s as w%d } from %s\nexport const x%d = w%d\n", v, i, s, i, i)
		},
		func(i int, s, _, _ string) string { return fmt.Sprintf("export type M%d = typeof import(%s)\n", i, s) },
	}
)

// specifierSource builds a module from data: each pair of bytes picks a form
// and a target.
func specifierSource(data []byte) string {
	var b strings.Builder
	for i := 0; i+1 < len(data) && i < 24; i += 2 {
		target := specifierTargets[int(data[i+1])%len(specifierTargets)]
		b.WriteString(specifierForms[int(data[i])%len(specifierForms)](i, target.specifier, target.value, target.typeName))
	}
	if b.Len() == 0 {
		b.WriteString("export const empty = 0\n")
	}
	return b.String()
}

// FuzzDeclarationWrittenSpecifiers checks raw declaration identity, byte for
// byte, for every import and export form over every specifier a .vibe module
// may write: the module's declaration is the declaration stock TypeScript
// emits for the same module as .ts, where a VibeLang sibling is named by its
// output (decided detail 263). The migration gate's canonical comparison
// treats ./x.ts and ./x.js alike, so FuzzDeclarationIdentity cannot see this.
func FuzzDeclarationWrittenSpecifiers(f *testing.F) {
	for _, seed := range [][]byte{
		{0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0},
		{0, 2, 1, 2, 2, 2, 3, 2, 4, 2, 5, 2},
		{0, 1, 1, 3, 2, 4, 3, 1, 4, 3, 5, 4},
		{5, 0, 3, 2, 1, 0, 0, 3},
		{2, 4, 3, 4, 5, 4},
	} {
		f.Add(seed)
	}
	// Every form over every target, one statement each.
	for form := range specifierForms {
		for target := range specifierTargets {
			f.Add([]byte{byte(form), byte(target)})
		}
	}
	const options = `,"allowImportingTsExtensions":true,"rewriteRelativeImportExtensions":true`
	f.Fuzz(func(t *testing.T, data []byte) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		source := specifierSource(data)
		files, _ := specifierFiles("ts", asTypeScript(source), options)
		stock, _, errors := emitSpecifierProject(t, files)
		if len(errors) != 0 {
			t.Skipf("not a valid TypeScript module: %v", errors)
		}
		files, _ = specifierFiles("vibe", source, options)
		dts, _, errors := emitSpecifierProject(t, files)
		if len(errors) != 0 {
			t.Fatalf("stock TypeScript accepts the module, and the .vibe module reports %v\n%s", errors, source)
		}
		if dts != stock {
			t.Fatalf("declarations differ for\n%s\n--- .ts\n%s\n--- .vibe\n%s", source, stock, dts)
		}
	})
}

// Chapter 1 Declaration output / D263: "A relative import of a VibeLang
// module, ./user.vibe, is declared through its .js output, ./user.js, by
// default". Alchemy-57 keeps index.ts barrels while migrating their leaves;
// a .vibe string in lib/index.d.ts cannot resolve the emitted leaf.d.ts.
func TestTypeScriptDeclarationRewritesNativeBarrels(t *testing.T) {
	t.Parallel()
	for _, style := range []struct{ name, ending string }{{".js", ".js"}, {"extensionless", ""}, {".ts", ".ts"}} {
		for _, quote := range []string{`"`, `'`} {
			for _, form := range []string{
				"export * as People from %s\n",
				"export * from %s\n",
				"import type { User } from %s\nexport type Chosen = User | undefined\n",
				"export type Chosen = import(%s).User\n",
			} {
				t.Run(fmt.Sprintf("%s/%q/%s", style.name, quote, strings.Split(form, "\n")[0]), func(t *testing.T) {
					specifier := quote + "./users.vibe" + quote
					source := fmt.Sprintf(form, specifier) + "export { helper } from " + quote + "./helper.ts" + quote + "\n"
					options := `,"allowImportingTsExtensions":true,"allowArbitraryExtensions":true,"rewriteRelativeImportExtensions":true,"vibelang":{"declarationImportStyle":` + fmt.Sprintf("%q", style.name) + `}`
					files, _ := specifierFiles("ts", source, options)
					dts, _, errors := emitSpecifierProject(t, files)
					if len(errors) != 0 {
						t.Fatalf("unexpected diagnostics: %v", errors)
					}
					if strings.Contains(dts, "./users.vibe") || !strings.Contains(dts, "./users"+style.ending) {
						t.Fatalf("TypeScript barrel must name emitted native declaration under %s:\n%s", style.name, dts)
					}
					if !strings.Contains(dts, "./helper.ts") {
						t.Fatalf("unrelated TypeScript specifier changed:\n%s", dts)
					}
				})
			}
		}
	}
}
