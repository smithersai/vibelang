package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Chapter 007: a quick fix preserves types, comments and declaration output.
// Compare bytes with the same compiler before and after the public editor edit.
func TestEK4833GroupedQuickFix(t *testing.T) {
	for _, shape := range []string{
		"Effect.Effect<number> | null",
		"Effect.Effect<number, Error | RangeError>",
		"Effect.Effect<number, Error, A | B>",
		"Effect.Effect<number | string, Error>",
		"Effect.Effect<() => number>",
		"Effect.Effect<number>[]",
		"Effect.Effect<number>[keyof Effect.Effect<number>]",
		"Effect.Effect<number, { readonly tag: 1 }>",
		"Effect.Effect<number /* keep the success comment */ | string, Error>",
		"Effect.Effect<number /* > and ! are comment text */ | string, Error>",
		"Effect.Effect<number | string, never, never>",
		"Effect.Effect<number, Error | RangeError, never>",
		// t3code shapes: apps/web/src/connection/storage.ts and apps/desktop/src/app/DesktopStartupRecovery.ts.
		"Effect.Effect<string | null, Error>",
		"Effect.Effect<\n  void,\n  never,\n  | A\n  | B\n>",
	} {
		t.Run(shape, func(t *testing.T) {
			source := "interface A { a: 1 }; interface B { b: 1 };\nexport type Program = " + shape + "\n"
			fixed := applyQuickFix(t, source, 4833)
			if fixed == source {
				t.Fatal("grouped type was not fixed")
			}
			emit := func(text string) string {
				files := computedKeyFiles(false)
				files[projectDir(files)+"main.vibe"] = text
				return emitDeclarations(t, files)
			}
			if want, got := emit(source), emit(fixed); want != got {
				t.Fatalf("declarations changed\nbefore: %s\nafter: %s\nsource: %s", want, got, fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				t.Fatal(d.String())
			}
		})
	}
}

func FuzzEK4833GroupedQuickFix(f *testing.F) {
	for i := uint8(0); i < 20; i++ {
		for slot := uint8(0); slot < 3; slot++ {
			f.Add(i, slot)
		}
	}
	f.Fuzz(func(t *testing.T, shape, slot uint8) {
		// The leading-bar, multi-line union is the requirements shape of t3code apps/desktop/src/app/DesktopStartupRecovery.ts.
		channels := []string{"number | string", "A & B", "() => number", "{ readonly value: number }", "\n  | A\n  | B"}
		args := []string{"number", "Error", "A"}
		if shape&8 != 0 {
			args[1], args[2] = "never", "never"
		}
		channel := channels[int(shape)%len(channels)]
		// An object type needs grouping only after a !. In the success slot it is
		// an ungrouped rewrite, which drops written never slots in this
		// declaration-free editor program, so it is outside this property.
		if strings.HasPrefix(channel, "{") && slot%3 == 0 {
			slot = 1
		}
		args[int(slot)%3] = channel
		written := "Effect.Effect<" + strings.Join(args, ", ") + ">"
		if shape&4 != 0 {
			written += " | undefined"
		}
		source := "interface A { a: 1 }; interface B { b: 1 };\nexport type Program = " + written + "\n"
		fixed := applyQuickFix(t, source, 4833)
		if strings.Contains(fixed, "Effect.Effect<") {
			t.Fatalf("refused %s", source)
		}
		emit := func(text string) string {
			files := computedKeyFiles(false)
			files[projectDir(files)+"main.vibe"] = text
			return emitDeclarations(t, files)
		}
		if a, b := emit(source), emit(fixed); a != b {
			t.Fatalf("declarations differ\n%s\n%s", a, b)
		}
	})
}

// Refusals identify the exact declaration/comment loss, and never offer an edit.
func FuzzEK4833GroupedRefusal(f *testing.F) {
	for i := uint8(0); i < 4; i++ {
		f.Add(i)
	}
	f.Fuzz(func(t *testing.T, shape uint8) {
		types := []string{"(Effect.Effect<number>)", "Effect.Effect<(number | string)>", "Effect.Effect<number, (Error | RangeError)>", "Effect.Effect</* success */number, Error | RangeError>"}
		source := "export type Program = " + types[int(shape)%len(types)] + "\n"
		program, file, service, converters := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() != diagnosticSource || d.Code() != 4833 {
				continue
			}
			var note strings.Builder
			for _, n := range d.MessageChain() {
				note.WriteString(n.String())
			}
			text := note.String()
			want := "source-written parentheses"
			if shape%4 == 3 {
				want = "comments between its type arguments"
			}
			if !strings.Contains(text, "No quick fix:") || !strings.Contains(text, want) {
				t.Fatalf("unexplained refusal: %s", text)
			}
			ld := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        ld.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{ld}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if response.CommandOrCodeActionArray != nil {
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil && strings.HasPrefix(a.CodeAction.Title, "Write ") {
						t.Fatalf("refused diagnostic has an edit: %s", a.CodeAction.Title)
					}
				}
			}
			found = true
		}
		if !found {
			t.Fatalf("missing refusal: %s", source)
		}
	})
}

func TestEK4833GroupedBodyReturnKeepsNeverRequirements(t *testing.T) {
	const source = "export effect function read(): Effect.Effect<number, Error | RangeError> { return 1 }"
	fixed := applyQuickFix(t, source, 4833)
	if !strings.Contains(fixed, "number!(Error | RangeError)! {") {
		t.Fatalf("the fix enabled requirements inference: %s", fixed)
	}
}

func TestEK4833GroupedNamespaceRefusal(t *testing.T) {
	const source = "import type * as FX from \"effect/Effect\"; export type Program = FX.Effect<number | string>"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 4833 {
			for _, n := range d.MessageChain() {
				if strings.Contains(n.String(), "replace FX.Effect with Effect.Effect in declaration output") {
					return
				}
			}
			t.Fatalf("missing namespace refusal: %s", d.String())
		}
	}
	t.Fatal("missing EK4833")
}
