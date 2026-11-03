package vibelangfuzz

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"maps"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
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
//   - "One `vibelang --fix` run applies fixes until none applies; running it
//     again changes nothing" (Chapter 7, decided 2026-10-31): --fix on the
//     fixed project changes no file.
//   - The current tooling chapter's explicitly named trailing-block codemod
//     applies, under the existing safe-fix/refusal checks it preserves.
//   - "Each fix keeps the program's meaning": a runnable program (one with an
//     exported zero-argument Effect function, with or without an expectation marker)
//     returns the same outcome after fixing, and its declarations, its
//     contracts, are unchanged ("It has the same types too").
//
// A corpus file named fix-vip-only-* runs vibelang --fix --fix-vip-only
// instead, the first step the migrate flow takes on a repository written
// for VibeLang 0.0.10 or earlier, under the same checks.
// Chapter 007 / trailing-block codemod and documented refusal boundaries preserve programs: docs/design/src/007-tooling.md#e8fbaefe60690b11
func FuzzFix(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("007-tooling.md"), "the selected project's own files") {
		f.Fatal("missing current --fix write boundary")
	}
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
	// Imported dependencies remain read-only while an owned type rewrite runs.
	f.Add(Archive(map[string]string{
		"main.vibe":                            "import type { Foreign } from \"dependency\"; export type Local = Effect.Effect<number>; export type Imported = Foreign;\n",
		"node_modules/dependency/package.json": "{\"name\":\"dependency\",\"type\":\"module\",\"types\":\"./index.vibe\"}",
		"node_modules/dependency/index.vibe":   "export type Foreign = Effect.Effect<string>;\n",
	}))
	for _, choices := range []string{"\x00\x07\x00\x00\x00", "\x01\x81\x01\x00\x01", "\x02\x82\x00\x01\x01\x01", "\x00\x80\x01\x01\x00", "\x01\xff\x00\x00\x01"} {
		f.Add(optionMatchFixKey + choices)
	}
	for _, data := range []string{"\x04\x00\x02", "\x14\x04\x03"} {
		f.Add(trailingWhitespaceFixKey + data)
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
			trailingWhitespace := strings.HasPrefix(archive, trailingWhitespaceFixKey)
			var trailingReference string
			if trailingWhitespace {
				TestTrailingBlocksQuoted(t)
				source, reference := trailingWhitespaceFixSources(archive)
				trailingReference = reference
				archive = Archive(map[string]string{"main.vibe": source})
			}
			nativeTS := trailingWhitespace || strings.HasPrefix(archive, nativeFixReferenceKey)
			if nativeTS {
				TestCatchScopeFixQuoted(t)
				archive = strings.TrimPrefix(archive, nativeFixReferenceKey)
			}
			directOption := strings.HasPrefix(archive, optionMatchFixKey)
			if directOption {
				TestOptionMatchFixQuoted(t)
				archive = optionMatchFixArchive(archive)
			}
			options := vibelang.FixOptions{VIPOnly: strings.HasPrefix(corpusFile(t, "FuzzFix"), "fix-vip-only-")}
			files := toolsUnarchive(archive)
			if toolsMainFile(files) == "" || toolsTooLarge(files) || toolsLeftOut("FuzzFix", files) {
				return
			}
			r := toolsCompile(t, w, "FuzzFix", files)
			defer r.Remove()
			// Native TypeScript migration inputs may be invalid in the old
			// VibeLang execution model before fixing. Compare their native
			// reference, rather than silently dropping the runtime oracle.
			runtimeBefore := toolsTrailingBlockBaseline(t, r)
			if nativeTS {
				if len(files) != 1 || files["main.vibe"] == "" {
					return
				}
				reference := files["main.vibe"]
				if trailingWhitespace {
					reference = trailingReference
				}
				runtimeBefore = toolsCompile(t, w, "FuzzFix", map[string]string{"main.ts": reference})
				defer runtimeBefore.Remove()
				if !toolsErrorFree(runtimeBefore) {
					t.Skip("not an admissible native TypeScript reference")
				}
			}
			config := toolsConfig(w, r.Dir)
			if r.Program == nil || config == nil || len(config.Errors) > 0 {
				return
			}
			if directOption {
				found := false
				for _, d := range r.Diagnostics {
					if d.Code() == 4839 {
						found = true
					}
				}
				if !toolsErrorFree(r) || !found {
					Gap(t, "FuzzFix", "fix:direct-option-match:diagnostic", "Chapter 7 requires EK4839 on a direct Option.match: %v\n%s", SortedKeys(Keys(r.Dir, r.Diagnostics)), archive)
				}
			}
			var result *vibelang.FixResult
			toolsRun(t, "FuzzFix", "fix", archive, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, options)
			})
			if directOption && len(result.Files) == 0 {
				Gap(t, "FuzzFix", "fix:direct-option-match:missing", "the direct Option.match must have a safe fix:\n%s", archive)
			}
			if trailingWhitespace && len(result.Files) == 0 {
				Gap(t, "FuzzFix", "fix:trailing-whitespace:missing", "Chapter 7 requires the mechanical trailing-block migration:\n%s", archive)
			}
			if result.Err != nil {
				Gap(t, "FuzzFix", "fix:converge", "--fix did not reach a fixed point (%v):\n%s", result.Err, archive)
				return
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(r.Dir)+"/")
				// Chapter 007: the selected project's own program sources, including .vibex.
				if _, ok := files[rel]; !ok || !(strings.HasSuffix(rel, ".vibe") || strings.HasSuffix(rel, ".vibex")) {
					Gap(t, "FuzzFix", "fix:scope", "--fix changed %s, which is not one of the project's own .vibe files:\n%s", name, archive)
				}
				if strings.Contains("/"+filepath.ToSlash(rel)+"/", "/node_modules/") {
					Gap(t, "FuzzFix", "fix:scope-dependency", "chapter 007 forbids dependency writes: %s", rel)
				}
				fixed[rel] = file.Text
				// D372: comments survive every rewrite.
				if lost := slices.DeleteFunc(toolsLostComments(file.Original, file.Text), fixRemovedThrowsTag.MatchString); len(lost) > 0 {
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
			// Chapter 7 (decided 2026-10-31): "One `vibelang --fix` run applies
			// fixes until none applies; running it again changes nothing." When
			// the first changed nothing, it was the second.
			second := result
			if len(result.Files) > 0 {
				again := toolsConfig(w, after.Dir)
				toolsRun(t, "FuzzFix", "fix", Archive(fixed), nil, func() {
					second = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), again, options)
				})
			}
			// A pending convergence defect belongs to one exact input and mode;
			// it must not excuse another project or another --fix invocation.
			idempotenceKey := fmt.Sprintf("fix:idempotence:%t:%x", options.VIPOnly, sha256.Sum256([]byte(archive)))
			if second.Err != nil || len(second.Files) > 0 {
				var changed []string
				for name, file := range second.Files {
					changed = append(changed, fmt.Sprintf("-- %s --\n%s", filepath.Base(name.AsString()), file.Text))
				}
				Gap(t, "FuzzFix", idempotenceKey, "a second --fix changes the fixed project (%v):\n%s\nfixed:\n%s\nthen:\n%s", second.Err, archive, Archive(fixed), strings.Join(changed, "\n"))
			}
			// A repaired idempotence gap must retire its exact pending key even
			// when a later contract or runtime check finds a different gap.
			ExpectPending(t, "FuzzFix", idempotenceKey)
			// Current tooling explicitly names this codemod, independently of
			// implementation action availability. Keep main's VIP-only scope;
			// the unscoped run checks its completion and safe refusals.
			if !options.VIPOnly {
				toolsUnappliedFixes(t, w, after, codes, second.Refused, archive)
			}
			if len(result.Files) == 0 {
				if nativeTS {
					t.Log("native-ts reference valid; no rewrite offered")
				}
				return
			}
			// "Each fix keeps the program's meaning ... It has the same types too:
			// every contract, inferred or written, is unchanged." A contract is a
			// function's signature (Chapter 14), which the declaration files
			// write; a declaration may print it differently after a fix (an
			// error class becomes an error declaration, D284-D290), so the
			// contracts are compared by assignability in both directions.
			if toolsTrailingBlockRunnable(runtimeBefore) && toolsErrorFree(after) {
				if mismatch := toolsContractMismatch(t, w, runtimeBefore, after, false); mismatch != "" {
					key := "fix:types"
					if toolsContractMismatch(t, w, runtimeBefore, after, true) == "" {
						key = "fix:types:directory-service-key"
					}
					Gap(t, "FuzzFix", key, "--fix changed a contract: %s\nsource:\n%s\nfixed:\n%s", mismatch, archive, Archive(fixed))
				}
			}
			// D372: compare every callable exported Effect, not only main fixtures
			// marked with expect-result. Chapter 26 requires the same exit.
			// The explicit-class repair is offered for rejected static members
			// and setters (EK1302). Its D372 meaning-preservation contract
			// still applies to their already-emitted runtime representation.
			if (!toolsTrailingBlockRunnable(runtimeBefore) && !toolsMemberRepairRuntime(r)) || !toolsErrorFree(after) {
				if nativeTS {
					t.Logf("native-ts remaining diagnostics prevent runtime comparison: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
				}
				return
			}
			resultKey := fixResultInputKey(archive, options.VIPOnly, nativeTS)
			if directOption {
				resultKey = "fix:direct-option-match:value-and-events"
			}
			for _, entry := range toolsRunnableExports(runtimeBefore) {
				if node == nil {
					var err error
					if node, err = NewNode(w.Dir); err != nil {
						t.Fatalf("cannot verify D372 runtime equivalence: %v", err)
					}
				}
				was, is := node.Run(runtimeBefore, entry.file, entry.name), node.Run(after, entry.file, entry.name)
				if nativeTS {
					t.Logf("native-ts runtime comparison %s:%s original=%s/%s fixed=%s/%s", entry.file, entry.name, was.Kind, was.Value, is.Kind, is.Value)
				}
				// D372 says the fix keeps the program's outcome. An original that
				// doesn't run as an Effect program, such as one whose package.json
				// Node rejects before any user code, has no outcome to keep; a
				// fixed program that stops running does break it.
				if toolsInvalidOutcome(was) {
					if nativeTS {
						Gap(t, "FuzzFix", "fix:native-ts:runtime", "native reference must run: %+v\n%s", was, archive)
					}
					if directOption {
						Gap(t, "FuzzFix", "fix:direct-option-match:runtime", "generated Option.match must run for value/event comparison: %+v\n%s", was, archive)
					}
					continue
				}
				if toolsInvalidOutcome(is) {
					Gap(t, "FuzzFix", resultKey, "D372: %s:%s returned an invalid Effect outcome: original %+v; fixed %+v\n%s\nfixed:\n%s", entry.file, entry.name, was, is, archive, Archive(fixed))
				}
				if toolsSameOutcome(was, is) {
					continue
				}
				// A cached module can vary because a previous call changed its state.
				// Only variation across fresh original modules makes this input
				// inconclusive; crashes, timeouts and plain results never do.
				repeated := toolsFreshOutcome(t, w, runtimeBefore, entry)
				if toolsInvalidOutcome(repeated) {
					Gap(t, "FuzzFix", resultKey, "D372: a fresh original %s:%s returned %+v\n%s", entry.file, entry.name, repeated, archive)
				}
				if !toolsSameOutcome(was, repeated) {
					repeatedAgain := toolsFreshOutcome(t, w, runtimeBefore, entry)
					if toolsInvalidOutcome(repeatedAgain) {
						Gap(t, "FuzzFix", resultKey, "D372: a fresh original %s:%s returned %+v\n%s", entry.file, entry.name, repeatedAgain, archive)
					}
					if !toolsSameOutcome(repeated, repeatedAgain) {
						t.Skipf("inconclusive D372 comparison: the original %s:%s is nondeterministic across fresh modules: %+v then %+v", entry.file, entry.name, repeated, repeatedAgain)
					}
				}
				Gap(t, "FuzzFix", resultKey, "%s:%s: the fixed program ends %+v, the original %+v\n%s\nfixed:\n%s", entry.file, entry.name, is, was, archive, Archive(fixed))
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

// toolsMemberRepairRuntime admits only the error-member rejection that has
// an explicit equivalent class fix. Other invalid programs have no runtime
// equivalence promise in this oracle.
func toolsMemberRepairRuntime(r *Result) bool {
	if r.EmitSkipped {
		return false
	}
	found := false
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if !IsEK(d) || d.Code() != 1302 {
			return false
		}
		found = true
	}
	return found
}

// toolsErrorFree reports whether a compilation reports no error and emitted.
func toolsErrorFree(r *Result) bool {
	return !r.EmitSkipped && !slices.ContainsFunc(r.Diagnostics, func(d *ast.Diagnostic) bool { return d.Category() == diagnostics.CategoryError })
}

// VIP-11 retires source that previously ran. EK1101 is its migration
// diagnostic, so it must not exclude the old emit from the existing D372
// Exit oracle. Every other error still makes an original non-runnable.
func toolsTrailingBlockRunnable(r *Result) bool {
	return !r.EmitSkipped && !slices.ContainsFunc(r.Diagnostics, func(d *ast.Diagnostic) bool {
		return d.Category() == diagnostics.CategoryError && !(IsEK(d) && d.Code() == 1101)
	})
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

// Only current tooling's explicit trailing-block codemod enters this check.
// Historical lint ranges, retired spellings and editor quick-fix availability
// do not establish a command-line completion promise.
const currentFixCodesQuote = "| `EK1101` | A rejected trailing block | Pass the block as the last argument:"
const currentFixSafetyQuote = "`vibelang --fix` retains its safety checks and refusal rules."

var toolsFixCodes = sync.OnceValue(func() []int32 {
	text := currentSpecText(toolingChapter)
	requireQuote(text, currentFixCodesQuote)
	requireQuote(text, currentFixSafetyQuote)
	// The current table names the codemod's diagnostic beside its trigger.
	for _, row := range diagnosticTable(text, []string{"Code", "Trigger", "Repair"}, true) {
		if row[1] == "A rejected trailing block" {
			codes := codesIn(row[0])
			if len(codes) != 1 {
				panic("invalid current trailing-block codemod code")
			}
			return codes
		}
	}
	panic("current tooling no longer names the trailing-block codemod diagnostic")
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
		Gap(t, "FuzzFix", fmt.Sprintf("fix:unapplied:EK%04d:%s", d.Code(), state), "D291/D372: after --fix, %s still reports %s without a permitted refusal (no --fix refusal; explanation %v; quick fix offered %v):\n%s", rel, d.String(), u.explains, u.offered, archive)
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
		if _, ok := r.Sources[rel]; !ok || !(strings.HasSuffix(rel, ".vibe") || strings.HasSuffix(rel, ".vibex")) || strings.Contains("/"+filepath.ToSlash(rel)+"/", "/node_modules/") {
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
	codes := []int32{4837} // A helper fixture, not a current codemod assignment.
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
			name := ""
			if id := statement.Name(); id != nil {
				name = id.Text()
			}
			// `export default function main` binds `default`, which is what
			// an importer reads (typeof A0.default), not `main`.
			if ast.HasSyntacticModifier(statement, ast.ModifierFlagsDefault) {
				name = "default"
			}
			if name != "" && !slices.Contains(names, name) {
				names = append(names, name)
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
//
// With sameDirectory, each program's directory name at the start of a string
// literal becomes one name, as if both had compiled in one directory. Chapter
// 5 gives a service in a package whose package.json has no string `name` "no
// derived key" (EK0903), but the compiler derives one from the project
// directory, so the two compiles declare different keys; a mismatch that this
// removes is that gap (fix:types:directory-service-key), not a changed
// contract.
// nominalMember is the private member that makes an error declaration's
// class nominal (D407). Two copies of one declaration differ only by it, so
// the copies compare structurally without it.
var nominalMember = regexp.MustCompile(`(?m)^[ \t]*#private;\n`)

func toolsContractMismatch(t *testing.T, w *Workspace, before, after *Result, sameDirectory bool) string {
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
		if sameDirectory {
			text = strings.ReplaceAll(text, `"`+filepath.Base(before.Dir)+"/", `"project/`)
			fixed = strings.ReplaceAll(fixed, `"`+filepath.Base(after.Dir)+"/", `"project/`)
		}
		files["a/"+module+".d.ts"], files["b/"+module+".d.ts"] = nominalMember.ReplaceAllString(text, ""), nominalMember.ReplaceAllString(fixed, "")
		names := toolsContracts(text)
		if len(names) == 0 {
			continue
		}
		fmt.Fprintf(&check, "import * as A%d from \"./a/%s.js\"\nimport * as B%d from \"./b/%s.js\"\n", n, module, n, module)
		probeModule := slices.ContainsFunc(toolsParse("contracts.d.ts", text).Statements.Nodes, ast.IsExternalModuleIndicator) && slices.ContainsFunc(toolsParse("contracts.d.ts", fixed).Statements.Nodes, ast.IsExternalModuleIndicator)
		fixedNames := toolsContracts(fixed)
		for i, function := range names {
			if !slices.Contains(fixedNames, function) {
				return fmt.Sprintf("%s no longer declares %s", name, function)
			}
			access := function
			if function != "default" && probeModule {
				// Private declarations may appear in a public type without being
				// module exports. Expose them only in the copied probe, so their
				// contracts stay checked alongside exported functions. An exported
				// ambient constant preserves implicit ambient exports; an export
				// list would turn those other declarations private.
				access = fmt.Sprintf("__vibelangContract%d", i)
				for strings.Contains(text, access) || strings.Contains(fixed, access) {
					access += "_"
				}
				export := "\nexport declare const " + access + ": typeof " + function + ";\n"
				text += export
				fixed += export
			}
			fmt.Fprintf(&check, "export const ab%d_%s: typeof A%d.%s = B%d.%s\nexport const ba%d_%s: typeof B%d.%s = A%d.%s\n", n, function, n, access, n, access, n, function, n, access, n, access)
		}
		files["a/"+module+".d.ts"], files["b/"+module+".d.ts"] = nominalMember.ReplaceAllString(text, ""), nominalMember.ReplaceAllString(fixed, "")
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

// fixRemovedThrowsTag matches a comment that holds only `@throws` and
// `@rethrows` tags. In a .vibe file each is EK0406, whose fix removes it
// (chapter 3, Thrown types: "is `EK0406`: remove it"), so D372 does not count it.
var fixRemovedThrowsTag = regexp.MustCompile(`^/\*\*\s*(?:(?:@throws\s*\{[^}]*\}|@rethrows\s+\w+)\s*)+\*/$`)
