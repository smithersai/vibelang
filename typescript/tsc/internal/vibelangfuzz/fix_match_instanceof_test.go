package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const matchInstanceOfRule = "Use \x60match\x60, or a function returning \x60match\x60 for \x60Match.type\x60, only for patterns and handlers whose tests and results are preserved."

func TestMatchInstanceOfQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), matchInstanceOfRule) {
		t.Fatalf("007-tooling.md no longer says %q", matchInstanceOfRule)
	}
}

// Match.instanceOf is a native instanceof predicate. This generator extends
// FuzzFix's existing before/after Exit oracle, rather than adding an oracle
// derived from today's matcher. The tooling chapter requires preserved tests
// and results (matchInstanceOfRule); 004-match's class patterns deliberately
// broaden Array and the primitive constructors. Both primitive and boxed
// subjects are present for every constructor, with fuzzed literal values.
var matchInstanceOfKeys = []string{"number", "string", "boolean", "array", "class", "alias", "custom", "external", "escape", "subclass"}

func matchInstanceOfProject(input string) map[string]string {
	parts := strings.SplitN(strings.TrimPrefix(input, "match-instanceof:"), ":", 2)
	key := parts[0]
	payload := ""
	if len(parts) > 1 {
		payload = parts[1]
	}
	n := len(payload) % 101
	text := strconv.Quote(strings.ToValidUTF8(payload, "?"))
	if len(text) > 256 {
		text = strconv.Quote("bounded")
	}
	ctor, declaration := "C", "class C { readonly value = 7 }\n"
	switch key {
	case "number":
		ctor = "Number"
	case "string":
		ctor = "String"
	case "boolean":
		ctor = "Boolean"
	case "array":
		ctor = "Array"
	case "class":
	case "alias":
		declaration = "const C = Number\n"
	case "custom":
		declaration = "const matcher: unique symbol = Symbol.for('Symbol.customMatcher')\nclass C { static [matcher](_: unknown): boolean { return true } }\n"
	case "external":
		declaration = "class C {}\nObject.defineProperty(C, Symbol.for('Symbol.customMatcher'), { value: () => true })\n"
	case "escape":
		declaration = "class C {}\nconst alias = C\nObject.defineProperty(alias, Symbol.for('Symbol.customMatcher'), { value: () => true })\n"
	case "subclass":
		declaration = "class Base {}\nclass C extends Base {}\n"
	default:
		return matchInstanceOfProject("match-instanceof:" + matchInstanceOfKeys[len(key)%len(matchInstanceOfKeys)] + ":" + payload)
	}
	return map[string]string{"main.vibe": fmt.Sprintf(
		"import { Effect, Match } from 'effect'\n%s"+
			"function choose(value: unknown): string { return Match.value(value).pipe(Match.when(Match.instanceOf(%s), (): string => 'hit'), Match.orElse((): string => 'miss')) }\n"+
			"export function main() { return Effect.succeed([%d, new Number(%d), %s, new String(%s), true, false, new Boolean(true), new Boolean(false), [], [1], {}, null, undefined, new C()].map(choose)) }\n",
		declaration, ctor, n, n, text, text)}
}

// Exercise the real editor service on the same five acceptance fixtures,
// including the absence of unsafe actions. Compare native, original and
// editor-edited runs, and assert an ordinary class still has its action.
func TestMatchInstanceOfEditorResults(t *testing.T) {
	w := NewWorkspace(t)
	session, err := newToolsSession(w)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	for _, key := range matchInstanceOfKeys[:5] {
		t.Run(key, func(t *testing.T) {
			path := filepath.Join(Root(), "typescript/vibelang/cases/match-instanceof-repair-"+key, "main.vibe")
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			source := string(data)
			files := map[string]string{"main.vibe": source}
			r := toolsCompile(t, w, "FuzzEditor", files)
			defer r.Remove()
			native := toolsCompile(t, w, "FuzzEditor", map[string]string{"main.ts": source})
			defer native.Remove()
			if !toolsErrorFree(r) || !toolsErrorFree(native) {
				t.Fatalf("invalid fixture: %v / %v", r.Diagnostics, native.Diagnostics)
			}
			was := node.Run(r, "out/main.js", "main")
			nativeResult := node.Run(native, "out/main.js", "main")
			if was.Kind != "success" || !toolsSameOutcome(was, nativeResult) {
				t.Fatalf("original/native: %+v / %+v", was, nativeResult)
			}
			uri := toolsURI(r.Dir, "main.vibe")
			session.DidOpenFile(t.Context(), uri, 1, source, toolsLanguage)
			defer session.DidCloseFile(t.Context(), uri)
			service, err := session.GetLanguageService(t.Context(), uri)
			if err != nil {
				t.Fatal(err)
			}
			ds, err := toolsDiagnostics(t.Context(), service, uri)
			if err != nil {
				t.Fatal(err)
			}
			found, offered := false, false
			fixed := source
			for _, d := range ds {
				code, origin := toolsDiagnosticCode(d)
				if code != 4839 || origin != "EK" {
					continue
				}
				found = true
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
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction == nil || !strings.HasPrefix(action.CodeAction.Title, "Write a match") {
						continue
					}
					offered = true
					changes, ok := toolsWorkspaceEdits(action.CodeAction.Edit)
					if !ok {
						t.Fatal("missing editor edit")
					}
					fixed, _, err = toolsApply(source, changes[uri])
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			after := toolsCompile(t, w, "FuzzEditor", map[string]string{"main.vibe": fixed})
			defer after.Remove()
			if !toolsErrorFree(after) {
				t.Fatalf("invalid editor repair: %v", after.Diagnostics)
			}
			is := node.Run(after, "out/main.js", "main")
			if !toolsSameOutcome(was, is) {
				t.Fatalf("editor changed result: %+v -> %+v", was, is)
			}
			if !found || offered != (key == "class") {
				t.Fatalf("advisory=%v action=%v", found, offered)
			}
		})
	}
}

// Separate constructor families retain the complete converter oracle while
// keeping the general migration corpus and each short target within budget.
func FuzzMatchInstanceOfBuiltins(f *testing.F) {
	startShortBudget(f)
	fuzzFixProjects(f, "FuzzMatchInstanceOfBuiltins")
}
func FuzzMatchInstanceOfClasses(f *testing.F) {
	startShortBudget(f)
	fuzzFixProjects(f, "FuzzMatchInstanceOfClasses")
}
