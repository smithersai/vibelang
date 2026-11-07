package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsNamedErrorDeclarations(t *testing.T) {
	const config = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true},"files":["main.vibe"]}`
	for _, tc := range []struct{ name, source string }{
		{"decl-factory-class", "export function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-factory-field", "export function create() { return class Loader { load = /*cursor*/async (input: Promise<number>) => await input } }"},
		{"decl-factory-object", "export function create() { return { load: /*cursor*/async (input: Promise<number>) => await input } }"},
		{"decl-factory-arrow", "export function create() { return /*cursor*/async (input: Promise<number>) => await input }"},
		{"decl-factory-declaration", "export function create() { /*cursor*/async function load(input: Promise<number>) { return await input }; return load }"},
		{"decl-static-factory", "export class Factory { static create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } } }"},
		{"decl-getter-factory", "export class Factory { get loader() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } } }"},
		{"decl-generic-factory", "export function create<K extends number | symbol>(key: K) { return class Loader { /*cursor*/async [key](input: Promise<number>) { return await input } } }"},
		{"decl-symbol-inherited", "class Base { [key: number]: (input: Promise<number>) => Promise<number> }; export function create<K extends symbol>(key: K) { return class Loader extends Base { /*cursor*/async [key](input: Promise<number>) { return await input } } }"},
		{"decl-collision", "const PromiseFailed = 0; export function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-documented", "/** Factory docs. */\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-directive", "\"use strict\";\n/** Factory docs. */\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-hashbang", "#!vibelang\n\"use strict\";\n/** Factory docs. */\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-multiple-await", "export function create() { return class Loader { /*cursor*/async load(input: Promise<number>, other: Promise<number>) { const value = await input; return value + await other } } }"},
		{"decl-private-control", "export {}; function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-annotated-control", "export function create(): { new(): { load(input: Promise<number>): unknown } } { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-nocheck-control", "// @ts-nocheck\nconst wrong: number = \"text\"; export function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-triple-reference", "/// <reference lib=\"esnext.disposable\" />\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-pinned-header", "/*! Factory license */\n/** Factory docs. */\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-directive-tail", "\"use strict\"; // keep directive comment\n/** Factory docs. */\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-hoisted-factory", "export const Loader = create();\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-pragma-documentation", "/** Factory docs.\n * @jsx factory\n */\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-documentation-gap", "/** Factory docs. */\n\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-documentation-crlf", "/** Factory docs. */\r\n\r\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-pinned-documentation-gap", "/*! Factory license */\n/** Factory docs. */\n\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-check-documentation-gap", "// @ts-nocheck\n/** Factory docs. */\n\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-documentation-pragma-gap", "/** Factory docs.\n * @jsx factory\n */\n\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-documentation-before-pragma", "/** Factory docs. */\n\n// @ts-nocheck\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-directive-documentation-gap", "\"use strict\";\n/** Factory docs. */\n\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
		{"decl-hashbang-documentation-gap", "#!vibelang\n/** Factory docs. */\n\nexport function create() { return class Loader { /*cursor*/async load(input: Promise<number>) { return await input } } }"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pos := strings.Index(tc.source, "/*cursor*/")
			source := strings.ReplaceAll(tc.source, "/*cursor*/", "")
			program, file, service, converters := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
			original := slices.Concat(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file), program.GetDeclarationDiagnostics(t.Context(), file))
			for _, d := range original {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
				}
			}
			count := 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if !strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					continue
				}
				count++
				got := applyEditorEdits(t, file, converters, action.Changes)
				checked, edited, _, _ := editorProgramConfig(t, got, editorPackageJSON, editorPackages, config)
				after := slices.Concat(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited), checked.GetDeclarationDiagnostics(t.Context(), edited))
				for _, d := range after {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("offered conversion does not declare: %s\n%s", d.String(), got)
					}
				}
				if factoryStart := strings.Index(source, "export function create"); factoryStart >= 0 {
					if docStart := strings.LastIndex(source[:factoryStart], "/** Factory docs."); docStart >= 0 && !strings.Contains(got, source[docStart:factoryStart]+"export function create") {
						t.Error("factory documentation moved to another declaration")
					}
				}
				if strings.HasPrefix(source, "\"use strict\";") && !strings.HasPrefix(got, "\"use strict\";") {
					t.Error("directive prologue changed")
				}
				if tc.name == "decl-hoisted-factory" && strings.Contains(action.Description, "with an error per await") && strings.Index(got, "error PromiseFailed") > strings.Index(got, "export const Loader") {
					t.Error("generated errors initialize after module code")
				}
				for _, header := range []string{"// @ts-nocheck\n", "/// <reference lib=\"esnext.disposable\" />\n", "/*! Factory license */\n", "\"use strict\"; // keep directive comment\n"} {
					if strings.HasPrefix(source, header) && !strings.HasPrefix(got, header) {
						t.Error("file header changed")
					}
				}
				if strings.HasPrefix(source, "#!vibelang\n") && !strings.HasPrefix(got, "#!vibelang\n") {
					t.Error("hashbang moved")
				}
			}
			want := 2
			if slices.Contains([]string{"decl-pragma-documentation", "decl-documentation-pragma-gap", "decl-documentation-before-pragma"}, tc.name) {
				want = 1
			}
			if count != want {
				t.Fatalf("safe conversions: got %d, want %d", count, want)
			}
		})
	}
}
