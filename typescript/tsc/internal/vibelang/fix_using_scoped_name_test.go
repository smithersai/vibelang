package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestUsingScopedFixInitializerNames(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"anonymous-class", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", false},
		{"parenthesized", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} }); return 1 }", false},
		{"double-parenthesized", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = ((class { static observed = this.name; static [Symbol.dispose]() {} })); return 1 }", false},
		{"satisfies", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} } satisfies Disposable); return 1 }", false},
		{"asserted", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} } as Disposable); return 1 }", false},
		{"nonnull", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} })!; return 1 }", false},
		{"generic", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class<T> { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", false},
		{"extends", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class extends Base { static observed = this.name }; return 1 }", false},
		{"named-class", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class Kept { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", true},
		{"named-parenthesized", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class Kept { static observed = this.name; static [Symbol.dispose]() {} }); return 1 }", true},
		{"named-extends", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class Kept extends Base { static observed = this.name }; return 1 }", true},
		{"identifier", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = Known; return 1 }", true},
		{"factory", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = make(); return 1 }", true},
		{"constructed", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = new (class { [Symbol.dispose]() {} })(); return 1 }", true},
		{"conditional", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = choose() ? class { static observed = this.name; static [Symbol.dispose]() {} } : class { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", true},
		{"object-property", "class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = { Nested: class { static observed = this.name; static [Symbol.dispose]() {} }, [Symbol.dispose]() {} }; return 1 }", true},
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
