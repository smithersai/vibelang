package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzDeclarationFileDocs checks the comments at the top of a module against
// its TypeScript twin. Chapter 1, API identity: declaration output carries
// the same doc comment on each export as tsc writes for the twin, and no
// other JSDoc difference is allowed beyond the generated @throws {never}.
// TypeScript attaches a file-top comment to the first statement, so it
// reaches the declaration when that statement does.
//
// Each cell writes the same text as main.vibe and twin.ts in one program and
// counts each comment marker in main.d.ts and twin.d.ts. The key is
// <header>/<gap>/<imports>/<first>: the comments before the first statement,
// whether a blank line follows them, the import declarations, and the first
// statement.

const declarationFileDocsTarget = "FuzzDeclarationFileDocs"

var declarationFileDocsQuotes = []string{
	"and the same doc comment on each export",
	"No other JSDoc difference is allowed, and an authored `@throws` must remain unchanged.",
}

var declarationFileDocsHeaders = []struct{ name, text string }{
	{"none", ""},
	{"jsdoc", "/**\n * FILEDOC1 file doc.\n */\n"},
	{"two-jsdoc", "/** FILEDOC1 first. */\n/** FILEDOC2 second. */\n"},
	{"license", "/*! LICENSE1 license */\n"},
	{"line", "// LINE1 line comment\n"},
	{"jsdoc-line", "/** FILEDOC1 doc. */\n// LINE1 after\n"},
}

var declarationFileDocsImports = []struct{ name, text string }{
	{"none", ""},
	{"type", "import type { Dep } from \"./dep.js\"\nexport type Used = Dep\n"},
	{"value", "import { dep } from \"./dep.js\"\nexport const fromDep = dep\n"},
	{"side-effect", "import \"./dep.js\"\n"},
}

var declarationFileDocsFirsts = []struct{ name, text string }{
	{"const-doc", "/** DECL1 f doc. */\nexport const f = (n: number): number => n\n"},
	{"const", "export const f = (n: number): number => n\n"},
	{"function", "export function f(n: number): number {\n  return n\n}\n"},
	{"interface", "export interface I {\n  n: number\n}\n"},
	{"type", "export type T = { n: number }\n"},
	{"class", "export class C {\n  n = 1\n}\n"},
	{"local-first", "const local = 1\nexport const f = local\n"},
}

var declarationFileDocsComment = regexp.MustCompile(`(?s)/\*.*?\*/|//[^\n]*`)

// declarationFileDocsMarkers returns the first line of text of each comment
// in source, which a declaration that keeps the comment repeats verbatim.
func declarationFileDocsMarkers(source string) []string {
	var markers []string
	for _, comment := range declarationFileDocsComment.FindAllString(source, -1) {
		comment = strings.TrimSuffix(strings.TrimLeft(comment, "/*!"), "*/")
		for _, line := range strings.Split(comment, "\n") {
			if line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "*")); line != "" {
				if !slices.Contains(markers, line) {
					markers = append(markers, line)
				}
				break
			}
		}
	}
	return markers
}

const declarationFileDocsDep = "export interface Dep {\n  d: number\n}\nexport const dep = 1\n"

type declarationFileDocsCase struct {
	key, header, gap, imports, first string
	source                           string
}

func declarationFileDocsCases() []declarationFileDocsCase {
	var cases []declarationFileDocsCase
	for _, h := range declarationFileDocsHeaders {
		for _, gap := range []string{"blank", "tight"} {
			for _, im := range declarationFileDocsImports {
				for _, first := range declarationFileDocsFirsts {
					source := h.text
					if gap == "blank" && h.text != "" {
						source += "\n"
					}
					source += im.text
					if im.text != "" {
						source += "\n"
					}
					source += first.text + "export const tail = 2\n"
					cases = append(cases, declarationFileDocsCase{key: h.name + "/" + gap + "/" + im.name + "/" + first.name, header: h.name, gap: gap, imports: im.name, first: first.name, source: source})
				}
			}
		}
	}
	return cases
}

// gapKey is the pending key of a cell.
func (c declarationFileDocsCase) gapKey() string {
	return c.key
}

func declarationFileDocsCompare(t *testing.T, w *Workspace, key, gapKey, vibe, twin string) {
	t.Helper()
	files := map[string]string{"main.vibe": vibe, "twin.ts": twin, "dep.ts": declarationFileDocsDep}
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var errs []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errs = append(errs, describe(d))
		}
	}
	if len(errs) > 0 {
		Gap(t, declarationFileDocsTarget, gapKey, "%s: the module and its twin are well typed, but the compiler reports: %s\n%s", key, strings.Join(errs, "; "), Archive(files))
		return
	}
	got, want := r.Outputs["out/main.d.ts"], r.Outputs["out/twin.d.ts"]
	if want == "" || got == "" {
		t.Fatalf("%s: missing declaration output (main %d bytes, twin %d bytes); outputs %v", key, len(got), len(want), slices.Sorted(maps.Keys(r.Outputs)))
	}
	var diffs []string
	markers := declarationFileDocsMarkers(vibe)
	if len(markers) == 0 && strings.Contains(vibe, "/"+"*") {
		t.Fatalf("%s: no comment markers found in a source with comments", key)
	}
	for _, m := range markers {
		if a, b := strings.Count(got, m), strings.Count(want, m); a != b {
			diffs = append(diffs, m+": "+strconv.Itoa(a)+" in main.d.ts, "+strconv.Itoa(b)+" in the twin")
		}
	}
	if len(diffs) > 0 {
		Gap(t, declarationFileDocsTarget, gapKey, "Chapter 1: %q; %s: %s\n--- main.d.ts\n%s--- twin.d.ts\n%s", declarationFileDocsQuotes[1], key, strings.Join(diffs, "; "), got, want)
	}
	ExpectPending(t, declarationFileDocsTarget, gapKey)
}

func TestDeclarationFileDocsQuoted(t *testing.T) {
	r4Quoted(t, "001-functions.md", declarationFileDocsQuotes...)
}

// TestDeclarationFileDocsWitness compiles the Smithers minimum: a module with
// a file doc, no imports and one documented export (sandbox rootedPath).
func TestDeclarationFileDocsWitness(t *testing.T) {
	TestDeclarationFileDocsQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "smithers-file-jsdoc-no-imports.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Main string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	declarationFileDocsCompare(t, NewWorkspace(t), witness.Source, "witness:smithers-file-jsdoc-no-imports", witness.Main, witness.Main)
}

func FuzzDeclarationFileDocs(f *testing.F) {
	startShortBudget(f)
	cases := declarationFileDocsCases()
	for _, key := range pendingSeedInputs(declarationFileDocsTarget, len(cases), func(i int) (string, string) {
		return cases[i].key, cases[i].gapKey()
	}) {
		f.Add(key)
	}

	f.Add("jsdoc/blank/none/const-doc")
	f.Add("license/tight/value/function")
	f.Add("none/blank/type/class")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestDeclarationFileDocsQuoted(t)
		i := slices.IndexFunc(cases, func(c declarationFileDocsCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		c := cases[i]
		declarationFileDocsCompare(t, w, c.key, c.gapKey(), c.source, c.source)
		ExpectPending(t, declarationFileDocsTarget, specCorpusKey(t))
	})
}

func TestDeclarationFileDocsNeighborhood(t *testing.T) {
	SkipShortMatrix(t, declarationFileDocsTarget, "VIBELANG_FILE_DOCS_MATRIX", "the complete header, gap, import and first-statement matrix runs separately")
	TestDeclarationFileDocsQuoted(t)
	w := NewWorkspace(t)
	for _, c := range declarationFileDocsCases() {
		t.Run(c.key, func(t *testing.T) { declarationFileDocsCompare(t, w, c.key, c.gapKey(), c.source, c.source) })
	}
}

var _ = PendingCompanion(declarationFileDocsTarget, "TestDeclarationFileDocsWitness")
