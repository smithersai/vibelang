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
// fix it waits for. In each, the projector reads an `effect { ... }` block that
// a function returns or passes as a callback as an unformed lambda, one
// character into the keyword. A listed module skips the comparison; one where
// the editor and the projection agree, or that the docs no longer hold, fails
// so that its line is deleted.
var formChoiceAhead = map[string]string{
	"docs/user/src/error-management/016-fallback.md#block-4":                    "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/086-getting-started.md#block-7":                       "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/089-advanced-usage.md#block-2":                        "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/setup/vite.md#block-6":                                       "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/vibelang-features/118-experimental-platform-apis.md#block-6": "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/error-management/006-two-error-types.md#block-1":             "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/scheduling/037-using-schedules.md#block-5":                   "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/091-transformations.md#block-4":                       "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/094-error-messages.md#block-1":                        "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/094-error-messages.md#block-4":                        "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/095-error-formatters.md#block-1":                      "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/095-error-formatters.md#block-2":                      "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/095-error-formatters.md#block-3":                      "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/095-error-formatters.md#block-4":                      "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/schema/097-default-constructors.md#block-3":                  "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/setup/react.md#block-2":                                      "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/setup/vibelang-cli.md#block-4":                               "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/setup/vue.md#block-3":                                        "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/vibelang-features/114-vibelang-for-effect-users.md#block-11": "mapper:effect-block-catch-head (impl-hunt-run)",
	// VIP-6 (d9f6dcb0f3ce) retired these blocks' pending lines; each is the
	// same effect-block head the entries above wait on.
	"docs/user/src/error-management/014-expected-errors.md#block-9":       "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/error-management/014-expected-errors.md#block-11":      "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/platform/alchemy.md#block-2":                           "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/setup/svelte.md#block-2":                               "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/vibelang-features/113-building-an-http-api.md#block-2": "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/vibelang-features/115-cheat-sheet.md#block-33":         "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/vibelang-features/115-cheat-sheet.md#block-35":         "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/vibelang-features/115-cheat-sheet.md#block-37":         "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/platform/106-file-system.md#block-6":                   "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/setup/react.md#block-4":                                "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/setup/svelte.md#block-4":                               "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/testing/063-testclock.md#block-2":                      "mapper:effect-block-catch-head (impl-hunt-run)",
	"docs/user/src/testing/063-testclock.md#block-5":                      "mapper:effect-block-catch-head (impl-hunt-run)",
	// VIP-6 retired these blocks' pending lines too. The projector cannot
	// type a join operand bound to FiberSet.run or FiberMap.run's result.
	"docs/user/src/observability/034-tracking-fibers.md#block-1": "mapper:join-operand-fiber-run (fix-main-red)",
	"docs/user/src/observability/034-tracking-fibers.md#block-2": "mapper:join-operand-fiber-run (fix-main-red)",
	// The editor reports D253 on an array method of a typed callback parameter or property; the projector does not.
	"docs/user/src/044-batching.md#block-6": "mapper:d253-editor-only-typed-receiver (fix-main-red)",
	"docs/user/src/setup/vue.md#block-5":    "mapper:d253-editor-only-typed-receiver (fix-main-red)",
	// Effect arrows as object-literal property values: the editor and the projector report different spans.
	"docs/user/src/getting-started/real-provider-before-after.md#block-2": "mapper:object-property-effect-arrow-spans (fix-main-red)",
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
  if (name.endsWith(".vibe") && !pending.has(number)) cases.push({name:relative(root,page)+"#block-"+number,source:readFileSync(join(dir,name),"utf8")});
 }
}
process.stdout.write(JSON.stringify(cases));`
	cmd := exec.CommandContext(t.Context(), bun, "-e", script, root, t.TempDir())
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("materialize docs: %v: %s", err, output)
	}
	var docs []struct{ Name, Source string }
	if err := json.Unmarshal(output, &docs); err != nil {
		t.Fatal(err)
	}
	if len(docs) == 0 {
		t.Fatal("no documentation modules materialized")
	}
	cases := make([]struct{ name, source, virtual string }, 0, len(docs))
	choices := 0
	for _, doc := range docs {
		cases = append(cases, struct{ name, source, virtual string }{name: doc.Name, source: doc.Source})
		for _, d := range Project(doc.Source, testContext).Diagnostics {
			if d.Code == CodeFormChoice {
				choices++
			}
		}
	}
	t.Logf("docs corpus: %d modules, %d projector EK9100 sites", len(docs), choices)
	return cases
}
