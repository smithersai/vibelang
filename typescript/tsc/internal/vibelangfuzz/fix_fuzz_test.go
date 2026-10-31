package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"maps"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzFix runs vibelang --fix (vibelang.FixProjectWithOptions, the function
// the command line calls) on a project and checks Chapter 28's "####
// Diagnostics" (D291) and "Rewrites keep meaning" (D372):
//
//   - It never panics or hangs, and its rounds converge: "--fix repeats its
//     rounds until no fix applies".
//   - It changes only the project's own .vibe files.
//   - "--fix writes a file only when the fixed program reports no error the
//     original did not" (D291): the fixed project reports no error, by file
//     and code, more often than the original.
//   - Comments survive every rewrite (D372).
//   - "Applying a fix ... a second time changes nothing": --fix on the fixed
//     project changes no file.
//   - "--fix applies every such fix, and the quick fixes of the retired
//     spellings": after fixing, no diagnostic remains whose code that
//     sentence names, unless a refusal states the new error or the change in
//     meaning that prevents it.
//   - "Each fix keeps the program's meaning": a runnable program (one with an
//     exported zero-argument Effect function, with or without an expectation marker)
//     returns the same outcome after fixing, and its declarations, its
//     contracts, are unchanged ("It has the same types too").
func FuzzFix(f *testing.F) {
	startShortBudget(f)
	// Under -short every pending reproduction runs, with six of the
	// tsforms cases, the TypeScript forms --fix rewrites, and four other
	// cases: running all 22 tsforms cases took two minutes of seed CPU.
	// Campaigns take every tsforms case and 240 others; the nightly takes
	// every seed.
	isTSForms := func(s Seed) bool { return s.Pending == "" && strings.HasPrefix(s.Name, "tsforms-") }
	cases := CaseSeeds()
	tsforms := slices.DeleteFunc(slices.Clone(cases), func(s Seed) bool { return !isTSForms(s) })
	others := slices.DeleteFunc(slices.Clone(cases), isTSForms)
	for _, seed := range toolsSample(others, 4, 240, func(s Seed) bool { return s.Pending != "" }) {
		f.Add(Archive(seed.Files))
	}
	for _, seed := range toolsSample(tsforms, 6, 0, nil) {
		f.Add(Archive(seed.Files))
	}
	for _, seed := range toolsSample(SnippetSeeds(), 4, 60, nil) {
		f.Add(Archive(seed.Files))
	}
	w := NewWorkspace(f)
	codes := toolsFixCodes()
	var node *Node
	f.Cleanup(func() {
		if node != nil {
			node.Close()
		}
	})
	f.Fuzz(func(t *testing.T, archive string) {
		toolsGuard(t, "FuzzFix", func() {
			files := toolsUnarchive(archive)
			if toolsMainFile(files) == "" || toolsTooLarge(files) || toolsLeftOut("FuzzFix", files) {
				return
			}
			r := toolsCompile(t, w, "FuzzFix", files)
			defer r.Remove()
			config := toolsConfig(w, r.Dir)
			if r.Program == nil || config == nil || len(config.Errors) > 0 {
				return
			}
			var result *vibelang.FixResult
			toolsRun(t, "FuzzFix", "fix", archive, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, "FuzzFix", "fix:converge", "--fix did not reach a fixed point (%v):\n%s", result.Err, archive)
				return
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(r.Dir)+"/")
				// Chapter 28: --fix applies its fixes "to a project's own .vibe files".
				if _, ok := files[rel]; !ok || !strings.HasSuffix(rel, ".vibe") {
					Gap(t, "FuzzFix", "fix:scope", "--fix changed %s, which is not one of the project's own .vibe files:\n%s", name, archive)
				}
				fixed[rel] = file.Text
				// D372: comments survive every rewrite.
				if lost := toolsLostComments(file.Original, file.Text); len(lost) > 0 {
					Gap(t, "FuzzFix", "fix:comments", "--fix lost the comments %q of %s:\n%s\nfixed:\n%s", lost, rel, file.Original, file.Text)
				}
			}
			after := r
			if len(result.Files) > 0 {
				after = toolsCompile(t, w, "FuzzFix", fixed)
				defer after.Remove()
				// D291: --fix writes a file only when the fixed program reports no
				// error the original did not.
				if added := toolsAddedErrors(r, after); len(added) > 0 {
					Gap(t, "FuzzFix", "fix:new-error", "the fixed program reports errors the original does not: %s\n%s\nfixed:\n%s", strings.Join(added, "\n"), archive, Archive(fixed))
				}
			}
			// Chapter 28, "Idempotence": a second --fix changes nothing. When
			// the first changed nothing, it was the second.
			second := result
			if len(result.Files) > 0 {
				again := toolsConfig(w, after.Dir)
				toolsRun(t, "FuzzFix", "fix", Archive(fixed), nil, func() {
					second = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), again, vibelang.FixOptions{})
				})
			}
			if second.Err != nil || len(second.Files) > 0 {
				var changed []string
				for name, file := range second.Files {
					changed = append(changed, fmt.Sprintf("-- %s --\n%s", filepath.Base(name.AsString()), file.Text))
				}
				Gap(t, "FuzzFix", "fix:idempotence", "a second --fix changes the fixed project (%v):\n%s\nfixed:\n%s\nthen:\n%s", second.Err, archive, Archive(fixed), strings.Join(changed, "\n"))
			}
			// Chapter 28, Diagnostics: the spec, rather than the implementation's
			// offered actions, determines which codes --fix must address.
			toolsUnappliedFixes(t, w, after, codes, second.Refused, archive)
			if len(result.Files) == 0 {
				return
			}
			// "Each fix keeps the program's meaning ... It has the same types too:
			// every contract, inferred or written, is unchanged." A contract is a
			// function's signature (Chapter 14), which the declaration files
			// write; a declaration may print it differently after a fix (an
			// error class becomes an error declaration, D284-D290), so the
			// contracts are compared by assignability in both directions.
			if toolsErrorFree(r) && toolsErrorFree(after) {
				if mismatch := toolsContractMismatch(t, w, r, after); mismatch != "" {
					Gap(t, "FuzzFix", "fix:types", "--fix changed a contract: %s\nsource:\n%s\nfixed:\n%s", mismatch, archive, Archive(fixed))
				}
			}
			// D372: compare every callable exported Effect, not only main fixtures
			// marked with expect-result. Chapter 26 requires the same exit.
			if !toolsErrorFree(r) || !toolsErrorFree(after) {
				return
			}
			for _, entry := range toolsRunnableExports(r) {
				if node == nil {
					var err error
					if node, err = NewNode(w.Dir); err != nil {
						t.Fatalf("cannot verify D372 runtime equivalence: %v", err)
					}
				}
				was, is := node.Run(r, entry.file, entry.name), node.Run(after, entry.file, entry.name)
				// D372 says the fix keeps the program's outcome. An original that
				// doesn't run as an Effect program, such as one whose package.json
				// Node rejects before any user code, has no outcome to keep; a
				// fixed program that stops running does break it.
				if toolsInvalidOutcome(was) {
					continue
				}
				if toolsInvalidOutcome(is) {
					Gap(t, "FuzzFix", "fix:result", "D372: %s:%s returned an invalid Effect outcome: original %+v; fixed %+v\n%s\nfixed:\n%s", entry.file, entry.name, was, is, archive, Archive(fixed))
				}
				if toolsSameOutcome(was, is) {
					continue
				}
				// A cached module can vary because a previous call changed its state.
				// Only variation across fresh original modules makes this input
				// inconclusive; crashes, timeouts and plain results never do.
				repeated := toolsFreshOutcome(t, w, r, entry)
				if toolsInvalidOutcome(repeated) {
					Gap(t, "FuzzFix", "fix:result", "D372: a fresh original %s:%s returned %+v\n%s", entry.file, entry.name, repeated, archive)
				}
				if !toolsSameOutcome(was, repeated) {
					repeatedAgain := toolsFreshOutcome(t, w, r, entry)
					if toolsInvalidOutcome(repeatedAgain) {
						Gap(t, "FuzzFix", "fix:result", "D372: a fresh original %s:%s returned %+v\n%s", entry.file, entry.name, repeatedAgain, archive)
					}
					if !toolsSameOutcome(repeated, repeatedAgain) {
						t.Skipf("inconclusive D372 comparison: the original %s:%s is nondeterministic across fresh modules: %+v then %+v", entry.file, entry.name, repeated, repeatedAgain)
					}
				}
				Gap(t, "FuzzFix", "fix:result", "%s:%s: the fixed program ends %+v, the original %+v\n%s\nfixed:\n%s", entry.file, entry.name, is, was, archive, Archive(fixed))
			}
		})
	})
}

// toolsFreshOutcome runs the original in a fresh Node process at its original
// path. D1 makes some values path-dependent, so changing the compilation
// directory would not prove the genuine runtime variation required by D372.
func toolsFreshOutcome(t *testing.T, w *Workspace, r *Result, entry toolsRunnable) Outcome {
	t.Helper()
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatalf("cannot verify runtime variation: %v", err)
	}
	defer node.Close()
	return node.Run(r, entry.file, entry.name)
}

// toolsCompile compiles a project as toolsRun runs a stage.
func toolsCompile(t *testing.T, w *Workspace, target string, files map[string]string) *Result {
	t.Helper()
	var r *Result
	var err error
	toolsRun(t, target, "compile", Archive(files), nil, func() { r, err = w.Compile(t.Context(), Project{Files: files}) })
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// toolsErrorFree reports whether a compilation reports no error and emitted.
func toolsErrorFree(r *Result) bool {
	return !r.EmitSkipped && !slices.ContainsFunc(r.Diagnostics, func(d *ast.Diagnostic) bool { return d.Category() == diagnostics.CategoryError })
}

// toolsSameOutcome compares Chapter 26 and D372's exits: "the same exit and
// Cause". The exit is the kind, tag and value; the Cause is every reason in
// order, as Chapter 17 and node.go's worker record it.
func toolsSameOutcome(a, b Outcome) bool {
	if a.Kind != b.Kind || a.Tag != b.Tag || !slices.Equal(a.Cause, b.Cause) {
		return false
	}
	var x, y any
	if len(a.Value) != 0 && json.Unmarshal(a.Value, &x) != nil {
		return false
	}
	if len(b.Value) != 0 && json.Unmarshal(b.Value, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}

// toolsInvalidOutcome rejects harness failures and non-Effect results. They
// cannot establish the Effect exit promised by Chapter 26 and D372.
func toolsInvalidOutcome(outcome Outcome) bool {
	return !slices.Contains([]string{"success", "failure", "defect", "interrupt"}, outcome.Kind)
}

type toolsRunnable struct{ file, name string }

// toolsEffectType matches a declaration file's type that is an Effect, such
// as `Effect.Effect<A, E, R>` or `import("effect/Effect").Effect<A>`.
var toolsEffectType = regexp.MustCompile(`^(?:import\("[^"]*"\)\.)?(?:Effect\.)?Effect\s*<`)

// toolsRunnableExports finds exported functions requiring no arguments whose
// declaration promises an Effect. Chapter 14's contracts identify programs;
// an expect-result comment is not a prerequisite of D372's equivalence rule.
// The declared return type itself is the Effect: a plain function that
// returns an Effect function, such as `() => <A>(e: Effect<A>) => Effect<A>`,
// returns a function, which has no Effect exit to compare.
func toolsRunnableExports(r *Result) []toolsRunnable {
	var entries []toolsRunnable
	for name, text := range r.Outputs {
		module, ok := strings.CutSuffix(name, ".d.ts")
		if !ok {
			continue
		}
		if _, ok := r.Outputs[module+".js"]; !ok {
			continue
		}
		file := toolsParse(name, text)
		for _, statement := range file.Statements.Nodes {
			if !ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
				continue
			}
			add := func(fn *ast.Node, name string) {
				if len(fn.Parameters()) != 0 || fn.Type() == nil {
					return
				}
				typ := strings.TrimSpace(text[fn.Type().Pos():fn.Type().End()])
				if toolsEffectType.MatchString(typ) {
					entries = append(entries, toolsRunnable{module + ".js", name})
				}
			}
			switch statement.Kind {
			case ast.KindFunctionDeclaration:
				if statement.Name() != nil {
					add(statement, statement.Name().Text())
				}
			case ast.KindVariableStatement:
				for _, d := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
					if d.Name().Kind == ast.KindIdentifier && d.Type() != nil && d.Type().Kind == ast.KindFunctionType {
						add(d.Type(), d.Name().Text())
					}
				}
			}
		}
	}
	slices.SortFunc(entries, func(a, b toolsRunnable) int { return strings.Compare(a.file+":"+a.name, b.file+":"+b.name) })
	return entries
}

// toolsFixCodes reads the codes Chapter 28's Diagnostics says --fix fixes:
// "--fix applies every such fix [of the lint codes EK4830-EK4837 and those
// named beside them, such as EK4839], the quick fixes of the retired
// spellings, and EK1002's", and EK1023's sites (D382). A registry
// row's "(quick fix)", such as EK4802's, is an editor quick fix, which
// FuzzEditor checks; D291's "every safe fix" summarizes this sentence. The
// implementation's code-action list is deliberately not an oracle.
var toolsFixCodes = sync.OnceValue(func() []int32 {
	text := SpecText("428-part4-ch28-tooling.md")
	retired := regexp.MustCompile(`retired spellings that still compile the same, each with a quick fix: ([^.]*)\.`).FindStringSubmatch(text)
	forms := regexp.MustCompile(`EK(48\d\d)-EK(48\d\d) mark Effect code written the way Effect's TypeScript writes it(.*?)They are lint too`).FindStringSubmatch(text)
	fix := regexp.MustCompile("--fix` applies every such fix, (.*?) to a project's own").FindStringSubmatch(text)
	if retired == nil || forms == nil || fix == nil || !strings.Contains(fix[1], "the quick fixes of the retired spellings") {
		panic("Chapter 28 no longer names the codes --fix fixes; update toolsFixCodes")
	}
	var codes []int32
	add := func(text string) {
		for _, m := range regexp.MustCompile(`EK(\d{4})`).FindAllStringSubmatch(text, -1) {
			code, _ := strconv.Atoi(m[1])
			if !slices.Contains(codes, int32(code)) {
				codes = append(codes, int32(code))
			}
		}
	}
	add(retired[1])
	add(forms[3]) // the lint codes named beside the range (D472, D473)
	add(fix[1])   // EK1002's Effect.gen fix (D470)
	first, _ := strconv.Atoi(forms[1])
	last, _ := strconv.Atoi(forms[2])
	for code := first; code <= last; code++ {
		add(fmt.Sprintf("EK%04d", code))
	}
	// D382's Diagnostics rule also requires --fix to migrate classified sites.
	if strings.Contains(text, "**EK1023**") && strings.Contains(text, "--fix` rewrites each other site") {
		add("EK1023")
	}
	slices.Sort(codes)
	return codes
})

// toolsUnappliedFixes requires every spec-promised repair to remove its code
// or explain a refusal allowed by Chapter 28, Diagnostics and Preconditions
// (D291, D372). An absent implementation code action is not a refusal.
// Chapter 28 permits two refusals:
//
//   - D291: "--fix writes a file only when the fixed program reports no
//     error the original did not". --fix's refusal names the code and the
//     line it did not fix and the error the fix would add.
//   - Preconditions (D372, D284-D290; for EK1023, D382 "it never guesses"):
//     "Where a fix would change something, the diagnostic says what would
//     change and offers no automatic fix." The diagnostic of that code
//     carries an explanation beyond its rule's message, a note in its
//     message chain, and the language service offers no quick fix for it.
//
// The specification fixes neither text: what an explanation says is the
// compiler's, so the oracle requires only that one exists, attached to the
// code it explains.
func toolsUnappliedFixes(t *testing.T, w *Workspace, r *Result, codes []int32, refused []vibelang.FixRefusal, archive string) {
	t.Helper()
	for _, u := range toolsUnpermitted(t, w, r, codes, refused) {
		d := u.diagnostic
		rel := strings.TrimPrefix(d.File().FileName().AsString(), filepath.ToSlash(r.Dir)+"/")
		// The key says whether the language service offers the quick fix
		// that --fix left unapplied, or offers none, so that a known code
		// with no fix does not switch the oracle off for one that --fix skips.
		state := "no-fix"
		if u.offered {
			state = "offered"
		}
		Gap(t, "FuzzFix", fmt.Sprintf("fix:unapplied:EK%d:%s", d.Code(), state), "D291/D372: after --fix, %s still reports %s without a permitted refusal (no --fix refusal; explanation %v; quick fix offered %v):\n%s", rel, d.String(), u.explains, u.offered, archive)
	}
}

// A toolsUnpermittedFix is a diagnostic that no permitted refusal explains,
// with what the Preconditions refusal lacks: an explanation, or a quick fix
// that --fix did not apply.
type toolsUnpermittedFix struct {
	diagnostic        *ast.Diagnostic
	explains, offered bool
}

// toolsUnpermitted returns the diagnostics of r's own .vibe files whose code
// --fix fixes and that no permitted refusal explains.
func toolsUnpermitted(t *testing.T, w *Workspace, r *Result, codes []int32, refused []vibelang.FixRefusal) []toolsUnpermittedFix {
	t.Helper()
	var out []toolsUnpermittedFix
	for _, d := range r.Diagnostics {
		if d.Source() != "EK" || !slices.Contains(codes, d.Code()) || d.File() == nil {
			continue
		}
		rel := strings.TrimPrefix(d.File().FileName().AsString(), filepath.ToSlash(r.Dir)+"/")
		if _, ok := r.Sources[rel]; !ok || !strings.HasSuffix(rel, ".vibe") {
			continue
		}
		// D291 permits a refusal that identifies an error the rewrite adds.
		if slices.ContainsFunc(refused, func(f vibelang.FixRefusal) bool {
			line := int(newToolsLines(d.File().Text()).position(d.Pos()).Line) + 1
			endLine := int(newToolsLines(d.File().Text()).position(d.End()).Line) + 1
			return f.File == d.File().FileName() && f.Code == d.Code() && f.Line >= line && f.Line <= endLine && strings.TrimSpace(f.Error) != ""
		}) {
			continue
		}
		// D372: the diagnostic itself explains, and offers no fix.
		explains, offered := toolsExplains(d), toolsOffersQuickFix(t, w, r, rel, d)
		if explains && !offered {
			continue
		}
		out = append(out, toolsUnpermittedFix{d, explains, offered})
	}
	return out
}

// TestFixPermittedRefusals checks the refusal oracle of FuzzFix: EK4837 on a
// Schema.TaggedError class whose tag is not its name is a warning with no
// quick fix that says what a schema error declaration would change (its tag
// is its name), so Chapter 28 permits it ("where it would not, the warning
// says what would change and offers none"). The same warning without its
// explanation is no permitted refusal. Since bc799ed7, EK4837 offers a fix for
// a class tagged with its own name, as in catch-tag-exhaustive.
func TestFixPermittedRefusals(t *testing.T) {
	files := map[string]string{"main.vibe": "import { Schema } from \"effect\"\n" +
		"export class ProbeFailure extends Schema.TaggedError<ProbeFailure>()(\"Probe\", { message: Schema.String }) {}\n"}
	w := NewWorkspace(t)
	r := toolsCompile(t, w, "FuzzFix", files)
	defer r.Remove()
	codes := toolsFixCodes()
	var warning *ast.Diagnostic
	for _, d := range r.Diagnostics {
		if d.Source() == "EK" && d.Code() == 4837 {
			warning = d
		}
	}
	if warning == nil {
		t.Fatal("a Schema.TaggedError class tagged other than its name draws no EK4837")
	}
	only := func(d *ast.Diagnostic) *Result {
		copied := *r
		copied.Diagnostics = []*ast.Diagnostic{d}
		return &copied
	}
	if left := toolsUnpermitted(t, w, only(warning), codes, nil); len(left) > 0 {
		t.Errorf("a warning that offers no fix and says what would change is not a permitted refusal: %s (%+v)", left[0].diagnostic.String(), left[0])
	}
	bare := warning.Clone()
	bare.SetMessageChain(nil)
	if left := toolsUnpermitted(t, w, only(bare), codes, nil); len(left) != 1 {
		t.Errorf("a warning that offers no fix and says nothing of what would change passed as a permitted refusal")
	}
}

// toolsExplains reports whether a diagnostic carries an explanation beyond
// its rule's message: a note with text in its message chain.
func toolsExplains(d *ast.Diagnostic) bool {
	return slices.ContainsFunc(d.MessageChain(), func(note *ast.Diagnostic) bool {
		return strings.TrimSpace(note.String()) != "" || toolsExplains(note)
	})
}

// toolsOffersQuickFix reports whether the language service offers a quick
// fix for the diagnostic d of the file rel, the automatic fix that a refusal
// under Chapter 28's Preconditions offers none of.
func toolsOffersQuickFix(t *testing.T, w *Workspace, r *Result, rel string, d *ast.Diagnostic) bool {
	t.Helper()
	program := toolsProgram(w, r.Dir)
	if program == nil {
		t.Fatalf("cannot build the program of %s to ask for its quick fixes", r.Dir)
	}
	uri := toolsURI(r.Dir, rel)
	service, _ := toolsService(w, program, toolsFileName(r.Dir, rel))
	var offered bool
	toolsRun(t, "FuzzFix", "code actions", Archive(r.Sources), nil, func() {
		diagnostics, err := toolsDiagnostics(t.Context(), service, uri)
		if err != nil {
			t.Fatalf("diagnostics of %s: %v", rel, err)
		}
		lines := newToolsLines(d.File().Text())
		start, end := lines.position(d.Pos()), lines.position(d.End())
		for _, ld := range diagnostics {
			if code, source := toolsDiagnosticCode(ld); code != d.Code() || source != "EK" || ld.Range.End.Line < start.Line || ld.Range.Start.Line > end.Line {
				continue
			}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: ld.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{ld}}})
			if err != nil {
				t.Fatalf("code actions of %s: %v", rel, err)
			}
			if response.CommandOrCodeActionArray == nil {
				continue
			}
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction != nil && action.CodeAction.Kind != nil && *action.CodeAction.Kind == lsproto.CodeActionKindQuickFix && action.CodeAction.Edit != nil {
					offered = true
				}
			}
		}
	})
	return offered
}

// toolsContracts returns the names of the contracts a declaration file
// declares: its top-level functions, and its constants whose type is a
// function type.
func toolsContracts(dts string) []string {
	file := toolsParse("contracts.d.ts", dts)
	var names []string
	for _, statement := range file.Statements.Nodes {
		switch statement.Kind {
		case ast.KindFunctionDeclaration:
			if name := statement.Name(); name != nil && !slices.Contains(names, name.Text()) {
				names = append(names, name.Text())
			}
		case ast.KindVariableStatement:
			for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if t := declaration.Type(); t != nil && t.Kind == ast.KindFunctionType && declaration.Name().Kind == ast.KindIdentifier {
					names = append(names, declaration.Name().Text())
				}
			}
		}
	}
	return names
}

// toolsContractMismatch checks that each contract the original program's
// declaration files declare is mutually assignable with the fixed program's:
// a TypeScript file imports both declaration sets and assigns each function
// to the other's type. It returns the first error, or "".
// nominalMember is the private member that makes an error declaration's
// class nominal (D407). Two copies of one declaration differ only by it, so
// the copies compare structurally without it.
var nominalMember = regexp.MustCompile(`(?m)^[ \t]*#private;\n`)

func toolsContractMismatch(t *testing.T, w *Workspace, before, after *Result) string {
	t.Helper()
	files := map[string]string{}
	var check strings.Builder
	n := 0
	for name, text := range before.Outputs {
		module, ok := strings.CutSuffix(strings.TrimPrefix(name, "out/"), ".d.ts")
		if !ok || strings.HasPrefix(module, "/") || !ValidProjectPath(module+".d.ts") {
			continue
		}
		fixed, ok := after.Outputs[name]
		if !ok {
			return name + " is gone"
		}
		files["a/"+module+".d.ts"], files["b/"+module+".d.ts"] = nominalMember.ReplaceAllString(text, ""), nominalMember.ReplaceAllString(fixed, "")
		names := toolsContracts(text)
		if len(names) == 0 {
			continue
		}
		fmt.Fprintf(&check, "import * as A%d from \"./a/%s.js\"\nimport * as B%d from \"./b/%s.js\"\n", n, module, n, module)
		for _, function := range names {
			if !slices.Contains(toolsContracts(fixed), function) {
				return fmt.Sprintf("%s no longer declares %s", name, function)
			}
			fmt.Fprintf(&check, "export const ab%d_%s: typeof A%d.%s = B%d.%s\nexport const ba%d_%s: typeof B%d.%s = A%d.%s\n", n, function, n, function, n, function, n, function, n, function, n, function)
		}
		n++
	}
	if n == 0 {
		return ""
	}
	files["check.ts"] = check.String()
	r := toolsCompile(t, w, "FuzzFix", files)
	defer r.Remove()
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			return d.String() + "\n" + files["check.ts"]
		}
	}
	return ""
}
