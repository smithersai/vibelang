package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkDefaultLibrariesIncludeDisposal(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const source = `export type TagName = HTMLElement["tagName"];
export function main(): string[] {
  const seen: string[] = [];
  class Resource { [Symbol.dispose](): void {seen.push("disposed")} }
  { using resource = new Resource(); seen.push("body") }
  return seen;
}`
	for _, options := range []Options{nil, {"target": "ES2022"}, {"target": "ESNext"}} {
		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
			Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}, Options: options,
		})
		if err != nil {
			t.Fatal(err)
		}
		requireClean(t, result)
		// ESNext intentionally retains native using syntax, which the Node 22
		// execution fixture does not parse. Execute both downlevel/default paths.
		if options["target"] != "ESNext" {
			if got := runEmittedMain(t, result); got != "body\ndisposed" {
				t.Fatalf("default disposal computed %q", got)
			}
		}
	}
	// Adding a language-required default does not override an explicit lib set.
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
		Files:   []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}},
		Options: Options{"lib": []string{"es2022", "dom"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, result, "TS2550", "dispose")
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatal("an explicitly missing disposal library emitted artifacts")
	}
}

func TestPinnedForkExplicitBundledLibraries(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const source = `export type TagName = HTMLElement["tagName"]; export function main(): string { return "ok"; }`
	for _, libraries := range [][]string{
		{"es2022", "dom"}, {"ES2022", "DOM"},
		{"lib.es2022.d.ts", "lib.dom.d.ts"}, {"es2022", "dom", "dom"},
	} {
		t.Run(strings.Join(libraries, ","), func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files:   []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}},
				Options: Options{"lib": libraries},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			if got := runComptimeProgram(t, result); got != "ok" {
				t.Fatalf("computed %q", got)
			}
		})
	}
	for _, probe := range []struct {
		name          string
		libraries     []string
		code, message string
	}{
		{"no DOM defaults", []string{"es2022"}, "TS2304", "HTMLElement"},
		{"empty means no libraries", []string{}, "TS2318", "Array"},
		{"old library is not a corrupt prelude", []string{"es5"}, "TS2585", "Promise"},
	} {
		t.Run(probe.name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files:   []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}},
				Options: Options{"lib": probe.libraries},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, probe.code, probe.message)
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("missing library emitted artifacts")
			}
		})
	}
	// ConfigFile is the source-preserving legality gate, not option loading.
	// Relative paths must be accepted without crashing the stock JSON parser.
	t.Run("configuration text", func(t *testing.T) {
		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
			Files:      []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}},
			Options:    Options{"lib": []string{"ES2022", "DOM"}},
			ConfigFile: &ConfigFile{Path: "tsconfig.json", Text: `{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true,"isolatedModules":true,"verbatimModuleSyntax":true,"useDefineForClassFields":true,"lib":["ES2022","DOM"]}}`},
		})
		if err != nil {
			t.Fatal(err)
		}
		requireClean(t, result)
	})
}

func TestPinnedForkConfigDiagnosticsPreservePathSpelling(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const config = `{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true,"isolatedModules":true,"verbatimModuleSyntax":true,"useDefineForClassFields":true,"experimentalDecorators":true}}`
	for _, name := range []string{"tsconfig.json", "configs/../tsconfig.json", "configs\\..\\tsconfig.json", "/project/configs/../tsconfig.json"} {
		t.Run(name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files:      []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export function main() { return "ok"; }`}},
				ConfigFile: &ConfigFile{Path: name, Text: config},
			})
			if err != nil {
				t.Fatal(err)
			}
			issue := requireCode(t, result, "VIBE6002", "experimentalDecorators")
			if issue.File != name || issue.Span == nil {
				t.Fatalf("diagnostic lost path/span: %#v", issue)
			}
			if got := config[issue.Span.Start : issue.Span.Start+issue.Span.Length]; got != `"experimentalDecorators"` {
				t.Fatalf("span covers %q", got)
			}
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("refused config emitted artifacts")
			}
		})
	}
}

func TestPinnedForkRejectsInvalidBundledLibraries(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name  string
		value any
	}{
		{"scalar", "es2022"}, {"null", nil}, {"object", map[string]string{"name": "dom"}},
		{"non-string entry", []any{"es2022", 7}}, {"unknown name", []string{"not-a-library"}},
		{"relative path", []string{"../lib.dom.d.ts"}}, {"absolute path", []string{"/tmp/lib.dom.d.ts"}},
	} {
		t.Run(probe.name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files:   []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export function main() { return "ok"; }`}},
				Options: Options{"lib": probe.value},
			})
			if err == nil || !strings.Contains(err.Error(), "lib") {
				t.Fatalf("lib error = %v", err)
			}
			if len(result.Artifacts) != 0 {
				t.Fatal("invalid library emitted artifacts")
			}
		})
	}
}
