package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"slices"
	"strings"
	"testing"
)

const schemaValueKeywordQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestSchemaValueKeywordRepairQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), schemaValueKeywordQuote) {
		t.Fatalf("lost preserving-schema repair oracle: %s", schemaValueKeywordQuote)
	}
	const reference = "that value, emitted as written"
	if !strings.Contains(SpecText("006-data.md"), reference) {
		t.Fatalf("lost schema value reference oracle: %s", reference)
	}
}

// RC48: mutate identifier/type-token collisions and their enclosing schema
// position. A native TypeScript control establishes the source's value role;
// qualified names and neutral names must still offer their preserving repair.
func FuzzSchemaValueKeywordRepair(f *testing.F) {
	startShortBudget(f)
	names := []string{"string", "number", "boolean", "bigint", "symbol", "undefined", "any", "unknown", "never", "object", "intrinsic", "keyof", "readonly", "unique", "infer"}
	homes := []string{"alias", "field", "nested"}
	keys := []string{}
	for _, name := range names {
		for _, home := range homes {
			keys = append(keys, name+":"+home)
		}
	}
	keys = append(keys, "qualified:alias", "qualified:field", "neutral:alias", "neutral:field")
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestSchemaValueKeywordRepairQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		name, home, _ := strings.Cut(key, ":")
		codec := "Schema.String"
		if name == "string" {
			codec = "Schema.Number"
		}
		prefix := "export const " + name + "=" + codec + ";"
		ref := name
		unsafe := true
		if name == "qualified" {
			prefix = "const holder={string:Schema.Number};"
			ref = "holder.string"
			unsafe = false
		}
		if name == "neutral" {
			prefix = "const Named=Schema.Number;"
			ref = "Named"
			unsafe = false
		}
		body := "export const X=" + ref + ";export type X=typeof X.Type;"
		if home == "field" {
			body = "export const X=Schema.Struct({field:" + ref + "});"
		}
		if home == "nested" {
			body = "export const X=Schema.Struct({child:Schema.Struct({field:" + ref + "})});"
		}
		if home != "alias" {
			body += "export type X=typeof X.Type;"
		}
		source := `import * as Schema from "effect/Schema";` + prefix + body
		for _, file := range []string{"main.ts", "main.vibe"} {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			if HasError(r.Diagnostics) {
				t.Fatalf("invalid %s control %s: %v", file, key, SortedKeys(Keys(r.Dir, r.Diagnostics)))
			}
			if file == "main.ts" {
				continue
			}
			rewrites := schemaValueKeywordRewrites(t, w, r, source)
			if !unsafe && len(rewrites) == 0 {
				Gap(t, "FuzzSchemaValueKeywordRepair", key+":missing", "eligible schema reference has no repair; %s", source)
			}
			for _, fixed := range rewrites {
				after, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": fixed}})
				if err != nil {
					t.Fatal(err)
				}
				defer after.Remove()
				if HasError(after.Diagnostics) {
					Gap(t, "FuzzSchemaValueKeywordRepair", key+":compile", "schema repair introduced errors: %v; %s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed)
				}
				beforeDecl, ok := r.Outputs["out/main.d.ts"]
				afterDecl, afterOK := after.Outputs["out/main.d.ts"]
				if !ok || !afterOK {
					t.Fatal("missing declaration output")
				}
				if beforeDecl != afterDecl {
					Gap(t, "FuzzSchemaValueKeywordRepair", key+":declaration", "schema repair changes declared types; before:%s; after:%s; edit:%s", beforeDecl, afterDecl, fixed)
				}
			}
			ExpectPending(t, "FuzzSchemaValueKeywordRepair", key)
			ExpectPending(t, "FuzzSchemaValueKeywordRepair", specCorpusKey(t))
		}
	})
}

// Query the actual editor edit. The quoted contract permits declining a repair
// or emitting a safe qualified reference: compare full declarations before and
// after, rather than inferring a quick fix from the presence of a warning.
// This compares the compiler with itself on two forms the spec says must agree.
func schemaValueKeywordRewrites(t *testing.T, w *Workspace, r *Result, source string) []string {
	t.Helper()
	program := toolsProgram(w, r.Dir)
	if program == nil {
		t.Fatal("missing editor program")
	}
	uri := toolsURI(r.Dir, "main.vibe")
	service, _ := toolsService(w, program, toolsFileName(r.Dir, "main.vibe"))
	diagnostics, err := toolsDiagnostics(t.Context(), service, uri)
	if err != nil {
		t.Fatal(err)
	}
	var fixed []string
	for _, d := range diagnostics {
		code, origin := toolsDiagnosticCode(d)
		if origin != "EK" || code != 4832 && code != 4841 {
			continue
		}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: d.Range,
			Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}},
		})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray == nil {
			continue
		}
		for _, item := range *response.CommandOrCodeActionArray {
			action := item.CodeAction
			if action == nil || action.Edit == nil || !strings.HasPrefix(action.Title, "Write schema ") {
				continue
			}
			edits, ok := toolsWorkspaceEdits(action.Edit)
			if !ok || len(edits) != 1 {
				t.Fatal("unsupported schema workspace edit")
			}
			text, _, err := toolsApply(source, edits[uri])
			if err != nil {
				t.Fatal(err)
			}
			fixed = append(fixed, text)
		}
	}
	return fixed
}
