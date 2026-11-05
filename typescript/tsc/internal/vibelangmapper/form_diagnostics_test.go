package vibelangmapper

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// formChoiceAhead lists documentation modules where the projector reports a
// form choice that the editor and the compiler do not, each with the claimed
// fix it waits for. The projector cannot type a join operand bound to
// FiberSet.run or FiberMap.run's result. A listed module skips the comparison;
// one where the editor and the projection agree, or that the docs no longer
// hold, fails so that its line is deleted.
var formChoiceAhead = map[string]string{
	"docs/user/src/observability/034-tracking-fibers.md#block-1": "mapper:join-operand-fiber-run (fix-main-red)",
	"docs/user/src/observability/034-tracking-fibers.md#block-2": "mapper:join-operand-fiber-run (fix-main-red)",
}

// TestFormDiagnosticsMatchesProjection keeps the editor's inexpensive query
// aligned with the projector's ambiguity reports across lowering shapes.
func TestFormDiagnosticsMatchesProjection(t *testing.T) {
	// The projection cases' expected diagnostics belong to TestProjection; this
	// test reads only their sources.
	cases := make([]struct{ name, source, virtual string }, 0, len(projectionCases))
	for _, tc := range projectionCases {
		cases = append(cases, struct{ name, source, virtual string }{name: tc.name, source: tc.source, virtual: tc.virtual})
	}
	for _, source := range []string{
		`function f() { return pipe(() => { throw new Offline() }, retry({ times: 2 }), timeout("1 second")) }`,
		`import { opaque } from "./other"; function f() { return pipe(() => a(), opaque) }`,
		`import { opaque } from "./other"; function f() { const job = () => a(); return pipe(job, opaque) }`,
		`function f() { return pipe((() => a()), retry({ times: 2 })) }`,
	} {
		cases = append(cases, struct{ name, source, virtual string }{name: source, source: source})
	}
	// Reuse the docs checker's materializer so cross-block imports, generated
	// exports, fragments and deliberate errors match the production census.
	cases = append(cases, docsFormCases(t)...)
	seen := map[string]bool{}
	for _, tc := range cases {
		seen[tc.name] = true
		t.Run(tc.name, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, tc.source, core.ScriptKindTS)
			got := FormDiagnostics(file)
			var want []Diagnostic
			for _, d := range Project(tc.source, testContext).Diagnostics {
				// Inline-module refusal belongs only to the text mapper; the
				// native editor can preserve separate-module semantics.
				if d.Code == CodeFormChoice && d.Message == inlineModuleProjectionMessage {
					continue
				}
				if d.Code == CodeFormChoice || d.Code == CodeDataMethod {
					want = append(want, d)
				}
			}
			order := func(a, b Diagnostic) int {
				if a.Start != b.Start {
					return a.Start - b.Start
				}
				return a.Length - b.Length
			}
			slices.SortFunc(got, order)
			slices.SortFunc(want, order)
			agree := len(got) == 0 && len(want) == 0 || reflect.DeepEqual(got, want)
			if reason, ahead := formChoiceAhead[tc.name]; ahead {
				if agree {
					t.Fatalf("the editor and the projection now agree: delete %q from formChoiceAhead (%s)", tc.name, reason)
				}
				t.Logf("pending %s: editor %d choices, projection %d", reason, len(got), len(want))
				return
			}
			if len(got) == 0 && len(want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("editor choices %#v; projection choices %#v", got, want)
			}
		})
	}
	for name, reason := range formChoiceAhead {
		if !seen[name] {
			t.Errorf("formChoiceAhead lists %q (%s), which the docs corpus no longer holds: delete it", name, reason)
		}
	}
}

// A property access inside a for statement asks whether the loop's head is
// source (isMatchForm), which reads the projector's memo. FormDiagnostics runs
// in the editor, so a projector without that memo panicked on an ordinary loop.
func TestFormDiagnosticsReadsForStatements(t *testing.T) {
	for _, source := range []string{
		"effect function f() {\n  for (let attempt = 1; attempt <= 3; attempt++) {\n    try Console.log(`attempt ${attempt}`)\n  }\n}\n",
		"function f(xs: number[]) {\n  for (let i = 0; i < 3; i++) {\n    xs.push(i)\n  }\n}\n",
		"function f(xs: number[]) {\n  for (let i = xs.length; i > 0; i--) {}\n}\n",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, source, core.ScriptKindTS)
		if got := FormDiagnostics(file); len(got) != 0 {
			t.Errorf("form choices %#v for %s", got, source)
		}
	}
}

// docsFormCases materializes every documentation module through check-snippets,
// avoiding a stale copied fixture and a dependency on a prior parity run.
func docsFormCases(t *testing.T) []struct{ name, source, virtual string } {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	bun, err := exec.LookPath("bun")
	if err != nil {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			t.Fatal(homeErr)
		}
		bun = filepath.Join(home, ".bun/bin/bun")
	}
	script := `
const {readFileSync} = await import("node:fs");
const {join,relative} = await import("node:path");
const [root,temp] = process.argv.slice(1);
const {extract,writeProject,markdownPages} = await import(join(root,"docs/tools/check-snippets.ts"));
const cases = [];
let pageNumber = 0;
for (const page of markdownPages(join(root,"docs/user"))) {
 const blocks = extract(readFileSync(page,"utf8"));
 if (!blocks.length) continue;
 const dir = join(temp, "page-" + pageNumber++);
 const {filenames} = writeProject(dir,blocks);
 // A block in the VIP language waits for the compiler (its pending line); the census skips it, as check-snippets does.
 const pending = new Set(blocks.filter(block => block.pending).map(block => block.number));
 for (const [number,name] of filenames) {
  if (name.endsWith(".vibe") && !pending.has(number)) cases.push({name:relative(root,page)+"#block-"+number,file:name,source:readFileSync(join(dir,name),"utf8")});
 }
}
process.stdout.write(JSON.stringify(cases));`
	cmd := exec.CommandContext(t.Context(), bun, "-e", script, root, t.TempDir())
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("materialize docs: %v: %s", err, output)
	}
	var docs []struct{ Name, File, Source string }
	if err := json.Unmarshal(output, &docs); err != nil {
		t.Fatal(err)
	}
	if len(docs) == 0 {
		t.Fatal("no documentation modules materialized")
	}
	cases := make([]struct{ name, source, virtual string }, 0, len(docs))
	choices := 0
	for _, doc := range docs {
		cases = append(cases, struct{ name, source, virtual string }{name: docsFormCaseName(doc.Name, doc.File), source: doc.Source})
		for _, d := range Project(doc.Source, testContext).Diagnostics {
			if d.Code == CodeFormChoice {
				choices++
			}
		}
	}
	t.Logf("docs corpus: %d modules, %d projector EK9005 sites", len(docs), choices)
	return cases
}
