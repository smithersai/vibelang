package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#footnote-old-vibelang
//
// EK4857 replaces a written infer slot with the checker's inferred type, and
// removes the whole annotation only on an explicitly effect-marked callable
// whose every slot is infer. An unmarked callable is plain (VIP-1): it keeps
// its annotation, and its slots name the channels of the Effect its body
// returns. Both the quick fix and --fix leave a program without errors.
func TestVIP3AllInferRemovalNeedsEffectMarker(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"export effect function marked(): Effect.Effect<infer A, infer E, infer R> { return 1 }\n", "export effect function marked() { return 1 }\n"},
		{"export function unmarked(): Effect.Effect<infer A, infer E, infer R> { return Effect.succeed(1) }\n", "export function unmarked(): Effect.Effect<number, never, never> { return Effect.succeed(1) }\n"},
		{"export const arrow = (): Effect.Effect<infer A, infer E, infer R> => Effect.succeed(1)\n", "export const arrow = (): Effect.Effect<number, never, never> => Effect.succeed(1)\n"},
		{"export function failing(): Effect.Effect<infer A, infer E> { return Effect.fail(\"no\") }\n", "export function failing(): Effect.Effect<never, string> { return Effect.fail(\"no\") }\n"},
	} {
		got := applyQuickFixOf(t, tc.source, EK4857.Code, diagnostics.CategoryError)
		if got != tc.want {
			t.Errorf("quick fix:\ngot  %s\nwant %s", got, tc.want)
		}
		requireNoErrors(t, "quick fix", got)
		result, name := fixSourceOptions(t, tc.source, FixOptions{})
		fixed := result.Files[name]
		if fixed == nil || strings.Contains(fixed.Text, "infer") {
			t.Fatalf("--fix: got %+v, refused %+v", fixed, result.Refused)
		}
		requireNoErrors(t, "--fix", fixed.Text)
	}
}

// An unmarked callable whose body returns no Effect has no channels to
// write, and a written slot its returned Effect does not fit is refused.
func TestVIP3UnmarkedInferSlotRefusals(t *testing.T) {
	for _, source := range []string{
		"export function plain(): Effect.Effect<infer A> { return 1 as any }\n",
		"export function written(): Effect.Effect<string, infer E> { return Effect.succeed(1) }\n",
	} {
		program, file, service, converters := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() != diagnosticSource || d.Code() != EK4857.Code {
				continue
			}
			found = true
			pushed := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        pushed.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{pushed}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write ") {
						t.Errorf("offered %q for a slot it cannot preserve:\n%s", action.CodeAction.Title, source)
					}
				}
			}
		}
		if !found {
			t.Errorf("missing EK4857 in:\n%s", source)
		}
	}
}

func requireNoErrors(t *testing.T, stage, source string) {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("%s output reports %s:\n%s", stage, d.String(), source)
		}
	}
}

// EK4857 replaces TS1338 for an immediate written infer channel in the
// legacy return-slot set, including an unmarked callable with a body whose
// Effect annotation selected the legacy model; an independent native error
// on the same annotation remains. A parenthesized channel, a function type
// and other native infer keep TS1338; valid conditional inference reports
// nothing.
func TestVIP3InferSlotReplacesTS1338(t *testing.T) {
	for _, tc := range []struct {
		source string
		want   []string
	}{
		{"export function unmarked(): Effect.Effect<number, infer E> { return Effect.succeed(1) }\n", []string{"EK4857"}},
		{"export effect function independent(): number!infer E!Missing { return 1 }\n", []string{"EK4857", "TS2304"}},
		// Valid conditional-type inference and native infer outside the
		// migration keep TypeScript's rules and diagnostics.
		{"export const parenthesized = (): number!(infer E) => Effect.succeed(1)\n", []string{"TS1338"}},
		{"export type F = () => Effect.Effect<number, infer E>\n", []string{"TS1338"}},
		{"export type Native = infer X\n", []string{"TS1338"}},
		{"export type Success<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never\nexport const conditional: Success<number!!> = 1\n", nil},
	} {
		program, file, _, _ := editorProgram(t, tc.source)
		var got []string
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				got = append(got, errorCode(d))
			}
		}
		slices.Sort(got)
		if !slices.Equal(got, tc.want) {
			t.Errorf("got %v, want %v:\n%s", got, tc.want, tc.source)
		}
	}
}
