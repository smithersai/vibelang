package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// inferredArgumentActions lists, for each EK4802 in source, the reported
// argument's text and the titles of the quick fixes offered for it.
func inferredArgumentActions(t *testing.T, source string) []string {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	var out []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() != EK4802.Code {
			continue
		}
		pushed := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        pushed.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{pushed}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		var titles []string
		if response.CommandOrCodeActionArray != nil {
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction != nil {
					titles = append(titles, action.CodeAction.Title)
				}
			}
		}
		slices.Sort(titles)
		out = append(out, fmt.Sprintf("%s: %s", source[d.Pos():d.End()], strings.Join(titles, " | ")))
	}
	return out
}

const (
	runWithTry   = "Run it with try"
	keepWithArgs = "Keep the Effect value with explicit type arguments"
)

// rule-evidence: docs/design/src/002-running.md#inferred-effect-arguments | The editor offers `try` for a direct Effect-valued argument when the enclosing written failure and requirement contract accepts it; this action checks those channels, not the edited call's overloads, other arguments or expected result type.
func TestInferredArgumentTryActionChecksOnlyTheWrittenChannels(t *testing.T) {
	both := "job: " + keepWithArgs + " | " + runWithTry
	for _, test := range []struct {
		name, source string
		want         []string
	}{
		{"failure accepted", "error Gone\nfunction take<T>(x: T): number { return 1 }\nexport effect function probe(job: number!Gone): number!Gone { return take(job) }", []string{both}},
		{"failure rejected", "error Gone\nfunction take<T>(x: T): number { return 1 }\nexport effect function probe(job: number!Gone): number!! { return take(job) }", []string{"job: " + keepWithArgs}},
		{"requirement accepted", "service Svc { n: number }\nfunction take<T>(x: T): number { return 1 }\nexport effect function probe(job: number!!Svc): number!!Svc { return take(job) }", []string{both}},
		{"requirement rejected", "service Svc { n: number }\nfunction take<T>(x: T): number { return 1 }\nexport effect function probe(job: number!!Svc): number!! { return take(job) }", []string{"job: " + keepWithArgs}},
		{"inferred contract", "error Gone\nfunction take<T>(x: T): number { return 1 }\nexport effect function probe(job: number!Gone) { return take(job) }", []string{both}},
		// try changes the selected overload from the generic one to choose(x: number): string.
		{"overloads unchecked", "function choose(x: number): string\nfunction choose<T>(x: T): T\nfunction choose(x: unknown): unknown { return x }\nexport effect function probe(job: number!!) { return choose(job) }", []string{both}},
		// try on one argument leaves the other inferring T as an Effect.
		{"other arguments unchecked", "function same<T>(a: T, b: T): number { return 1 }\nexport effect function probe(job: number!!) { return same(job, job) }", []string{both, both}},
		// try makes take's result a number, which the written Effect type rejects.
		{"expected result type unchecked", "error Gone\nfunction take<T>(x: T): T { return x }\nexport effect function probe(job: number!Gone): number!Gone { const r: Effect.Effect<number, Gone> = take(job); return 1 }", []string{both}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := inferredArgumentActions(t, test.source); !slices.Equal(got, test.want) {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

// rule-evidence: docs/design/src/002-running.md#inferred-effect-arguments | A container or callback needs its Effect run where constructed, or the editor action to write explicit type arguments; a non-Effect callback never receives `try`.
func TestInferredContainerAndCallbackArgumentsGetOnlyExplicitTypeArguments(t *testing.T) {
	for _, test := range []struct {
		name, source, want, constructed string
	}{
		{"array", "function take<T>(x: T[]): number { return 1 }\nexport effect function probe(job: number!!) { return take([job]) }", "[job]: " + keepWithArgs, "take([try job])"},
		{"object property", "function take<T>(o: { v: T }): number { return 1 }\nexport effect function probe(job: number!!) { return take({ v: job }) }", "{ v: job }: " + keepWithArgs, "take({ v: try job })"},
		{"promise", "function take<T>(x: Promise<T>): number { return 1 }\nexport effect function probe(p: Promise<number!!>) { return take(p) }", "p: " + keepWithArgs, ""},
		{"callback result", "function take<T>(f: () => T): number { return 1 }\nexport effect function probe(job: number!!) { return take(() => job) }", "() => job: " + keepWithArgs, ""},
		{"callback parameter", "function take<T>(f: (x: T) => number): number { return 1 }\nexport effect function probe(job: number!!) { return take((e: Effect.Effect<number>) => 1) }", "(e: Effect.Effect<number>) => 1: " + keepWithArgs, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := inferredArgumentActions(t, test.source); !slices.Equal(got, []string{test.want}) {
				t.Fatalf("got %q, want %q", got, test.want)
			}
			if test.constructed == "" {
				return
			}
			// Running the Effect where the container is built silences the warning.
			start := strings.Index(test.source, "take(")
			end := strings.LastIndex(test.source, ") }")
			fixed := test.source[:strings.LastIndex(test.source[:end], "take(")] + test.constructed + " }"
			if start < 0 || fixed == test.source {
				t.Fatal("no constructed site to run")
			}
			if again := inferredArgumentActions(t, fixed); len(again) != 0 {
				t.Fatalf("run where constructed still reports %q:\n%s", again, fixed)
			}
		})
	}
}
