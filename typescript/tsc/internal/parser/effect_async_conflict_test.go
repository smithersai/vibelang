package parser

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestEffectAsyncConflict(t *testing.T) {
	for _, prefix := range []string{"effect async", "async effect", "effect /* keep 😀 */ async", "async /* keep */ effect"} {
		for _, form := range []string{
			"%s function f() {}", "export %s function f() {}", "export default %s function() {}",
			"const f = %s function() {}", "const f = %s function*() {}", "%s function* f() {}",
			"const f = %s () => 1", "const f = %s (x: number) => x", "const f = %s x => x", "const f = %s <T>(x: T) => x",
			"%s (x: number) => x", "%s x => x", "%s <T>(x: T) => x",
			"const f = %s { return 1 }", "class C { %s m() {} }", "class C { static %s *m() {} }",
			"const f = { %s m() {} }", "const f = { %s *m() {} }",
		} {
			source := fmt.Sprintf(form, prefix)
			t.Run(source, func(t *testing.T) {
				file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
				if ds := file.Diagnostics(); len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 105 {
					t.Fatalf("want only EK0105, got %v", ds)
				}
				d := file.Diagnostics()[0]
				if got := source[d.Pos():d.End()]; got != prefix {
					t.Fatalf("diagnostic must cover exactly the written modifiers: got %q want %q", got, prefix)
				}
			})
		}
	}
}

func TestEffectAsyncConflictContextualControls(t *testing.T) {
	for _, source := range []string{
		"effect async() {}", "effect async<T>() {}",
		"const f = effect async => async", "const f = async effect => effect",
		"const f = { effect async() {}, async effect() {} }",
		"class C { effect async() {} async effect() {} }",
		"const effect = 1; effect\nasync function f() {}",
		"const async = 1; async\neffect function f() {}",
		"const effect = (x: number) => x; effect(1)",
	} {
		file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Errorf("ordinary contextual syntax changed: %s: %v", source, ds)
		}
	}
}

func TestEffectAsyncConflictTypeScriptControls(t *testing.T) {
	for _, source := range []string{
		"async function f() {}", "const f = async effect => effect",
		"const f = { async effect() {} }; class C { async effect() {} }",
		"const effect = (x: number) => x; effect(1)",
	} {
		file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.ts"), PathKey: tspath.PathKey("/main.ts")}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Errorf("TypeScript syntax changed: %s: %v", source, ds)
		}
	}
}

func TestEffectAsyncConflictAccessors(t *testing.T) {
	for _, prefix := range []string{"effect async", "async effect", "effect /* keep */ async"} {
		for _, container := range []string{"class C { %s }", "const c = { %s }", "error E { %s }", "schema error E { %s }"} {
			for _, form := range []string{"%s get value() { return 1 }", "%s set value(v: number) {}"} {
				source := fmt.Sprintf(container, fmt.Sprintf(form, prefix))
				t.Run(source, func(t *testing.T) {
					file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
					codes := map[int32]int{}
					for _, d := range file.Diagnostics() {
						if d.Source() != "EK" {
							t.Fatalf("generic recovery diagnostic: %v", d)
						}
						codes[d.Code()]++
					}
					if len(file.Diagnostics()) != 2 || codes[104] != 1 || codes[105] != 1 {
						t.Fatalf("want EK0104 and EK0105: %v", file.Diagnostics())
					}
				})
			}
		}
	}
}
