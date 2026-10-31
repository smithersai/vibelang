package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestBangTypes(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"function find(id: string): Effect<string, NotFound, never>", "function find(id: string): string!NotFound!"},
		{"Effect<number, never, never>", "number!!"},
		{"Effect<User, never, Db>", "User!!Db"},
		{"Effect<User>", "User!!"},
		{"Effect<never>", "never!!"},
		{"Effect<never, NotFound, Db>", "never!NotFound!Db"},
		{"Effect<User, NotFound>", "User!NotFound!"},
		{"type Scoped = Effect.Effect<string, NotFound, Scope>", "type Scoped = string!NotFound!Scope"},
		{`import("effect/Effect", { with: { "resolution-mode": "import" } }).Effect<string, A | B, never>`, "string!(A | B)!"},
		{"ReadonlyArray<Effect<number, never, never>>", "ReadonlyArray<number!!>"},
		{"const f: () => Effect<void, never, never>", "const f: () => void!!"},
		{"Effect<() => void, E, R>", "(() => void)!E!R"},
		{"Effect<A, { code: number; }, never>", "A!({ code: number; })!"},
		{"Effect<{ a: number; }, E, never>", "{ a: number; }!E!"},
		{"Effect<Effect<A, E1, R1>, E2, R2>", "(A!E1!R1)!E2!R2"},
		{"Effect<A, E, R> | undefined", "(A!E!R) | undefined"},
		{"Effect<A, E, R>[]", "(A!E!R)[]"},
		{"Map<string, Effect<A, E, never>>", "Map<string, A!E!>"},
		{"MyEffect<A, B, C>", "MyEffect<A, B, C>"},
		{`Effect<"a>b", E, never>`, `"a>b"!E!`},
	} {
		if got := bangTypes(tc.in); got != tc.want {
			t.Errorf("bangTypes(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestBangCompoundChannels(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"Effect<A | B, E, R>", "(A | B)!E!R"},
		{"Effect<A & B, E, R>", "(A & B)!E!R"},
		{"Effect<A, E | F, R>", "A!(E | F)!R"},
		{"Effect<A, E & F, R>", "A!(E & F)!R"},
		{"Effect<A, E, R | S>", "A!E!(R | S)"},
		{"Effect<A, E, R & S>", "A!E!(R & S)"},
		{"Effect<A | B, E & F, R | S>", "(A | B)!(E & F)!(R | S)"},
		{"Effect<never, E | F>", "never!(E | F)!"},
		{"Effect<A | B>", "(A | B)!!"},
		{"Effect<A & B, never, R>", "(A & B)!!R"},
		{"Effect<Box<A | B>, E, R>", "Box<A | B>!E!R"},
		{"Effect<(A | B)[], E, R>", "(A | B)[]!E!R"},
		{`Effect<"a|b", E, R>`, `"a|b"!E!R`},
		{`Effect<"a&b", E, R>`, `"a&b"!E!R`},
		{"Effect<(A | B), E, R>", "(A | B)!E!R"},
	} {
		t.Run(test.input, func(t *testing.T) {
			if actual := bangTypes(test.input); actual != test.want {
				t.Fatalf("printed compound Effect channel changes its grammar: got %q, want %q", actual, test.want)
			}
		})
	}
}

func TestBangCompoundQuickFix(t *testing.T) {
	head := "type Left = { readonly x: number }\n" +
		"type Right = { readonly y: number }\n" +
		"export type Program = "
	source := head + "Effect.Effect<number | string, \"left\" | \"right\", Left & Right>\n"
	want := head + "(number | string)!(\"left\" | \"right\")!(Left & Right)\n"
	program, file, service, _ := editorProgram(t, source)
	hover, err := service.ProvideHover(t.Context(), &lsproto.HoverParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Position:     lsproto.Position{Line: 2, Character: 13},
	})
	if err != nil {
		t.Fatal(err)
	}
	if hover.Hover == nil || hover.Hover.Contents.MarkupContent == nil ||
		!strings.Contains(hover.Hover.Contents.MarkupContent.Value, "type Program = (string | number)!(\"left\" | \"right\")!(Left & Right)") {
		t.Fatalf("compound public hover violates operand grammar: %+v", hover)
	}
	refused := false
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4833.Code {
			refused = strings.Contains(diagnosticChainText(d), "No quick fix")
		}
	}
	if refused {
		// The same original manual spelling must still compile; no omitted
		// input or inferred contract can make a refusal satisfy the writer test.
		manual, manualFile, _, _ := editorProgram(t, want)
		for _, d := range manual.GetSemanticDiagnostics(t.Context(), manualFile) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("manual grouped type: %s", d.String())
			}
		}
		return
	}
	fixed := applyQuickFixOf(t, source, EK4833.Code, diagnostics.CategoryWarning)
	if fixed != want {
		t.Fatalf("compound quick fix violates Effect operand grammar: got %q, want %q", fixed, want)
	}
	program, file, _, _ = editorProgram(t, fixed)
	for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
		if diagnostic.Category() == diagnostics.CategoryError {
			t.Fatalf("fixed type no longer checks: %s", diagnostic.String())
		}
	}
}
