package vibelang

import "testing"

func TestPreludeShorthandKeepsWrittenScopeAliases(t *testing.T) {
	for name, source := range map[string]string{
		"local":         "type Scope = { value: number }; export type Own = Scope",
		"import":        "import type { Scope } from \"effect/Scope\"; export type Own = Scope",
		"nested-import": "import * as Root from \"effect/Scope\"; namespace Nested { import Scope = Root.Scope; export type Inner = Scope }; export type Own = Nested.Inner",
		"nested-local":  "namespace Nested { type Scope = { value: number }; export type Inner = Scope }; export type Own = Nested.Inner",
		"qualified":     "export type Own = Scope.Scope",
	} {
		t.Run(name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			got := preludeShorthandMigrationFixes(t.Context(), program, file, nil)
			if len(got.fixes) != 0 {
				t.Fatalf("written binding is not a legacy shorthand: %+v", got.fixes)
			}
		})
	}
}
