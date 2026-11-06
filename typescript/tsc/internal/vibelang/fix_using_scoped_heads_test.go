package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestUsingScopedFixDefinitionHeads(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"object-method", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ [try Effect.succeed(\"key\" as const)]() {}, [Symbol.dispose]() {} }); return 1 }", true},
		{"object-getter", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ get [try Effect.succeed(\"key\" as const)]() { return 1 }, [Symbol.dispose]() {} }); return 1 }", true},
		{"object-setter", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ set [try Effect.succeed(\"key\" as const)](value: number) {}, [Symbol.dispose]() {} }); return 1 }", true},
		{"class-heritage", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class extends (try Effect.succeed(Base)) {})(); return 1 }", true},
		{"class-method", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { [try Effect.succeed(\"key\" as const)]() {}; [Symbol.dispose]() {} })(); return 1 }", true},
		{"class-static-method", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { static [try Effect.succeed(\"key\" as const)]() {}; [Symbol.dispose]() {} })(); return 1 }", true},
		{"class-getter", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { get [try Effect.succeed(\"key\" as const)]() { return 1 }; [Symbol.dispose]() {} })(); return 1 }", true},
		{"nested-object-method", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ nested: { [try Effect.succeed(\"key\" as const)]() {} }, [Symbol.dispose]() {} }); return 1 }", true},
		{"object-effect-body", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ work: effect (): number!! => { try Effect.succeed(1); return try resource.work() }, [Symbol.dispose]() {} }); return try resource.work() }", true},
		{"class-effect-body", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { effect work(): number!! { try Effect.succeed(1); return try resource.work() }; [Symbol.dispose]() {} })(); return try resource.work() }", true},
		{"object-plain-body", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ work() { return 1 }, [Symbol.dispose]() {} }); return 1 }", true},
		{"class-plain-body", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { work() { return 1 }; [Symbol.dispose]() {} })(); return 1 }", true},
		{"class-effect-field", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { program = effect { return try Effect.succeed(1) }; [Symbol.dispose]() {} })(); return try resource.program }", true},
		{"class-static-effect-field", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class Local { static program = effect { return try Effect.succeed(1) }; get program() { return Local.program }; [Symbol.dispose]() {} })(); return try resource.program }", true},
		{"plain-heritage", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class extends Base {})(); return 1 }", true},
		{"plain-computed-name", "class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ [\"key\"]() {}, [Symbol.dispose]() {} }); return 1 }", true},
		{"shadowed-sync", "const sync = 0;\nexport effect function load(): number!! { using resource = open(); return 1 }", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "const open = (): Disposable => ({ [Symbol.dispose]() { } })\n" + tc.source
			program, file, service, converters := editorProgram(t, source)
			items := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			count := 0
			warnings := 0
			for _, d := range items {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
				}
				if d.Code() != EK0801.Code {
					continue
				}
				warnings++
				actions, err := usingScopedActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: d.Code(), Program: program, LS: service})
				if err != nil {
					t.Fatal(err)
				}
				for _, action := range actions {
					if action.Description != "Acquire with acquireDisposable inside scoped" {
						continue
					}
					count++
					got := applyEditorEdits(t, file, converters, action.Changes)
					if !tc.offer {
						t.Logf("unsafe initializer callback offered:\n%s", got)
					} else {
						checked, edited, _, _ := editorProgram(t, got)
						for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
							if d.Category() == diagnostics.CategoryError {
								t.Errorf("invalid scoped conversion: %s\n%s", d.String(), got)
							}
						}
						if !strings.Contains(got, "try acquireDisposable(") || !strings.Contains(got, "return try scoped(effect {") {
							t.Errorf("missing acquisition: %s", got)
						}
					}
				}
			}
			want := 0
			if tc.offer {
				want = 1
			}
			if warnings != 1 || count != want {
				t.Fatalf("warnings %d; actions %d, want %d", warnings, count, want)
			}
		})
	}
}
