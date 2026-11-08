package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const effectAliasRepairTarget = "FuzzEffectAliasRepair"
const effectAliasRepairQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

var effectAliasRepairShapes = []struct {
	key, declaration, arguments string
	repair                      bool
}{
	{"reordered", "export type Effect<A, E = never, R = never> = Base.Effect<E, A, R>", "number, string", false},
	{"default-error", "export type Effect<A, E = string> = Base.Effect<A, E>", "number", false},
	{"array-success", "export type Effect<A> = Base.Effect<ReadonlyArray<A>>", "number", false},
	{"required-service", "export type Effect<A> = Base.Effect<A, never, { readonly required: true }>", "number", false},
	{"union", "export type Effect<A> = Base.Effect<A> | Base.Effect<string>", "number", false},
	{"branded-interface", "export interface Effect<A> extends Base.Effect<A> { readonly brand: string }", "number", false},
	{"intersection", "export type Effect<A> = Base.Effect<A> & { readonly brand: string }", "number", false},
	{"different-interface", "export interface Program<A> extends Base.Effect<A> { readonly brand: string }", "number", false},
	{"forwarding", "export type Effect<A, E = never, R = never> = Base.Effect<A, E, R>", "number, string", true},
	{"official", "", "number, string", true},
	// Defaults, chains, and fixed slots test the instantiated contract rather
	// than the alias's name or parameter count.
	{"forwarding-defaults", "export type Effect<A, E = never, R = never> = Base.Effect<A, E, R>", "number", true},
	{"forwarding-chain", "type Forward<A, E, R> = Base.Effect<A, E, R>; export type Effect<A, E = never, R = never> = Forward<A, E, R>", "number, string", true},
	{"fixed-error", "export type Effect<A, E = never> = Base.Effect<A, string>", "number, Error", false},
	{"nested-array", "export type Effect<A> = Base.Effect<ReadonlyArray<ReadonlyArray<A>>>", "number", false},
	{"lookalike-interface", "export interface Effect<A, E = never, R = never> { readonly \"~effect/Effect\": { readonly _A: () => A; readonly _E: () => E; readonly _R: () => R }; readonly extra: true }", "number, string", false},
}

func TestEffectAliasRepairQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), effectAliasRepairQuote) {
		t.Fatalf("Chapter 7 no longer says %q", effectAliasRepairQuote)
	}
}

func effectAliasProject(index int, variant byte) Project {
	shape := effectAliasRepairShapes[index]
	declaration, args := shape.declaration, shape.arguments
	// Mutate independent success/error/service types and nesting. Keep every
	// project well typed, including the required string type in the union.
	value := []string{"number", "boolean", "{ readonly value: number }", "readonly [number, boolean]"}[int(variant)%4]
	failure := []string{"string", "Error", "{ readonly failed: true }"}[int(variant/4)%3]
	args = strings.ReplaceAll(strings.ReplaceAll(args, "number", value), "string", failure)
	declaration = strings.ReplaceAll(declaration, "readonly required: true", fmt.Sprintf("readonly required%d: true", variant%8))
	name := "Effect"
	if shape.key == "different-interface" {
		name = "Program"
	}
	prefix := "import type * as Custom from \"./custom.js\";\n"
	if shape.key == "official" {
		prefix = "import type * as Custom from \"effect/Effect\";\n"
	}
	typ := "Custom." + name + "<" + args + ">"
	switch variant / 16 % 4 {
	case 1:
		typ = "ReadonlyArray<" + typ + ">"
	case 2:
		typ = "{ readonly task: " + typ + " }"
	case 3:
		typ = "[" + typ + ", " + typ + "]"
	}
	return Project{Files: map[string]string{
		"custom.ts": "import type { Effect as Base } from \"effect\";\n" + declaration + ";\n",
		"main.vibe": prefix + "export type Result = " + typ + ";\n",
	}}
}

func effectAliasStock(t testing.TB) string {
	t.Helper()
	path := declarationIdentityAPI(t)
	if packageVersion(path) != "5.9.3" {
		Missing(t, "Effect alias oracle requires stock tsc 5.9.3: install experiments' pinned TypeScript or set EFFECT_NODE_MODULES to an install containing typescript@5.9.3")
	}
	return filepath.Join(path, "bin/tsc")
}

func effectAliasCompile(t *testing.T, w *Workspace, p Project) *Result {
	t.Helper()
	r, err := w.Compile(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Remove)
	if !toolsErrorFree(r) {
		t.Fatalf("well-typed alias project failed: %v\n%s", SortedKeys(Keys(r.Dir, r.Diagnostics)), Archive(p.Files))
	}
	return r
}

// Ask the actual language service, and apply the edit it returned. A range
// covering the type also checks the no-diagnostic/no-action controls.
func effectAliasEditor(t *testing.T, w *Workspace, r *Result) (string, int) {
	t.Helper()
	service, _ := toolsService(w, toolsProgram(w, r.Dir), toolsFileName(r.Dir, "main.vibe"))
	uri := toolsURI(r.Dir, "main.vibe")
	ds, err := toolsDiagnostics(t.Context(), service, uri)
	if err != nil {
		t.Fatal(err)
	}
	var selected []*lsproto.Diagnostic
	for _, d := range ds {
		if code, source := toolsDiagnosticCode(d); code == 4833 && source == "EK" {
			selected = append(selected, d)
		}
	}
	source := r.Sources["main.vibe"]
	span := lsproto.Range{Start: lsproto.Position{Line: 1}, End: lsproto.Position{Line: 2}}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: span,
		Context: &lsproto.CodeActionContext{Diagnostics: selected},
	})
	if err != nil {
		t.Fatal(err)
	}
	var edits []*lsproto.TextEdit
	count := 0
	if response.CommandOrCodeActionArray != nil {
		for _, item := range *response.CommandOrCodeActionArray {
			a := item.CodeAction
			if a == nil || !strings.HasPrefix(a.Title, "Write ") || a.Edit == nil || a.Edit.Changes == nil {
				continue
			}
			changes := *a.Edit.Changes
			if len(changes) != 1 || changes[uri] == nil {
				t.Fatalf("repair edits another file: %v", changes)
			}
			// Nested type occurrences have independent actions. Select one action,
			// as the editor does; the oracle still compares the whole declaration.
			if count == 0 {
				edits = changes[uri]
			}
			count++
		}
	}
	fixed, _, err := toolsApply(source, edits)
	if err != nil {
		t.Fatal(err)
	}
	if count == 0 && len(selected) != 0 {
		t.Fatalf("unrepairable alias still has EK4833: %v", selected)
	}
	return fixed, count
}

// Stock tsc, rather than VibeLang's checker or declaration canonicalizer,
// checks both directions of the emitted public contract. Also check generic
// equality: it detects the loss of an alias's separate union branches.
func effectAliasContract(t *testing.T, w *Workspace, stock string, before, after *Result, key string) {
	t.Helper()
	dir, err := os.MkdirTemp(w.Dir, "alias-consumer-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	for side, r := range map[string]*Result{"before": before, "after": after} {
		found := false
		for name, text := range r.Outputs {
			if !strings.HasPrefix(name, "out/") || !isDeclaration(name) {
				continue
			}
			rel := strings.TrimPrefix(name, "out/")
			if rel == "main.d.ts" {
				found = true
			}
			if err := writeInside(dir, side+"/"+rel, text); err != nil {
				t.Fatal(err)
			}
		}
		if !found {
			t.Fatal("missing emitted main.d.ts")
		}
	}
	consumer := "import type { Result as Before } from \"./before/main.js\";\n" +
		"import type { Result as After } from \"./after/main.js\";\n" +
		"declare const before: Before; declare const after: After;\n" +
		"const forward: After = before; const backward: Before = after;\n" +
		"type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;\n" +
		"const equal: Equal<Before, After> = true;\n"
	if err := writeInside(dir, "consumer.ts", consumer); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", stock, "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "consumer.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		Gap(t, effectAliasRepairTarget, key, "Chapter 7: %s\nstock tsc 5.9.3: %v\n%s\nbefore:\n%s\nafter:\n%s", effectAliasRepairQuote, err, out, before.Sources["main.vibe"], after.Sources["main.vibe"])
	}
}
