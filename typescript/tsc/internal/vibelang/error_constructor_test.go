package vibelang

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func errorCodesOf(t *testing.T, source string) []string {
	program, file, _, _ := editorProgram(t, source)
	var codes []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError || d.Category() == diagnostics.CategoryWarning {
			codes = append(codes, d.Source()+strconv.Itoa(int(d.Code())))
		}
	}
	return codes
}

// A constructor in either error form is EK1301 alone: no TypeScript error for
// its body and, for a schema error, no EK4814 warning.
func TestErrorConstructor(t *testing.T) {
	for _, source := range []string{
		"error E { id: string; constructor() { super({ id: \"x\" }) } }",
		"error E { constructor(id: string) { super() } }",
		"schema error E { id: string; constructor() { super({ id: \"x\" }) } }",
		"schema error E { constructor(public n: number) { super({}) } }",
		"export error E {\n  id: string\n  constructor(id: string) {\n    super({ id })\n  }\n  get label() { return this.id }\n}",
	} {
		t.Run(source, func(t *testing.T) {
			if codes := errorCodesOf(t, source); len(codes) != 1 || codes[0] != "EK1301" {
				t.Fatalf("got %v, want one EK1301", codes)
			}
		})
	}
}

// The payload field named constructor, native classes and Schema classes keep their behavior.
func TestErrorConstructorExclusions(t *testing.T) {
	for _, source := range []string{
		"error E { constructor: string }",
		"schema error E { constructor?: string }",
		"class E { constructor(readonly id: string) {} }",
	} {
		for _, code := range errorCodesOf(t, source) {
			if code == "EK1301" {
				t.Errorf("unexpected EK1301: %s", source)
			}
		}
	}
	codes := errorCodesOf(t, "import { Schema } from \"effect\"\nclass P extends Schema.Class<P>(\"P\")({ n: Schema.Number }) { constructor() { super({ n: 1 }) } }")
	if len(codes) != 1 || codes[0] != "EK4814" {
		t.Errorf("a native Schema class constructor keeps EK4814, got %v", codes)
	}
}

// The quick fix keeps the constructor by rewriting the declaration as a class.
func TestErrorConstructorMigration(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		source := "export " + form + " E { id: string; constructor(id: string) { super({ id: id.trim() }) } }\n"
		fixed := applyQuickFixOf(t, source, 1301, diagnostics.CategoryError)
		program, file, _, _ := editorProgram(t, fixed+"\nconst id: string = new E(\" x \").id;\n")
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Error(d.String())
			}
		}
	}
}

// The class the quick fix writes keeps each field's doc comment on its field
// only: a _tag field's type, which the tag argument copies, does not carry
// the next field's comment into TaggedError's arguments (Smithers
// SmithersError.vibe, drive-smithers 2026-11-03T03:41Z).
func TestErrorConstructorMigrationKeepsFieldComments(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		source := "export " + form + " E {\n  /** The tag. */\n  _tag: string\n  /** The summary. */\n  message: string\n  /** The code. */\n  code: string\n\n  /** Builds it. */\n  constructor(code: string) {\n    super({ message: code, code })\n  }\n}\n"
		fixed := applyQuickFixOf(t, source, 1301, diagnostics.CategoryError)
		head := fixed[:strings.Index(fixed, "{")]
		if strings.Contains(head, "/*") {
			t.Errorf("%s: a comment moved into the class head:\n%s", form, fixed)
		}
		for _, comment := range []string{"/** The tag. */", "/** The summary. */", "/** The code. */", "/** Builds it. */"} {
			// A schema error's class has no _tag field (its tag is its
			// name), so that field leaves with its comment.
			n := strings.Count(fixed, comment)
			if n > 1 || n == 0 && (form == "error" || comment != "/** The tag. */") {
				t.Errorf("%s: %s appears %d times:\n%s", form, comment, n, fixed)
			}
		}
	}
}
