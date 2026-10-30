package vibelang

import "testing"

// An import that error recovery leaves with a nameless binding, as in
// `import { Control, handle, resumeWithion nee "vibelang-runtime"`, gives the
// TypeScript-form rewrite an empty name to look for. containsWord reports that
// no text holds the empty word, rather than walking past the text's end (a
// compiler panic when the text ends in an identifier character).
func TestContainsWordOfTheEmptyWord(t *testing.T) {
	for _, text := range []string{"Busy", "Effect.fail(e)"} {
		if containsWord(text, "") {
			t.Errorf("containsWord(%q, \"\") = true; the empty word is no identifier", text)
		}
	}
	program, file, _, _ := editorProgram(t, "import { Data } from \"effect\"\nimport { Control, handle, resumeWithion nee \"vibelang-runtime\"\nclass Busy extends Data.TaggedError(\"Busy\")<{}> {}\n")
	program.GetSemanticDiagnostics(t.Context(), file)
}
