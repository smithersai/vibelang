package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

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

// A toolsUnpermittedFix is a diagnostic that no permitted refusal explains,
// with what the Preconditions refusal lacks: an explanation, or a quick fix
// that --fix did not apply.
type toolsUnpermittedFix struct {
	diagnostic        *ast.Diagnostic
	explains, offered bool
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

// A retired declaration still emits its former implementation for the Chapter
// 7 migration oracle. Require that exact error, and refuse unrelated errors.
func declarationRetirementRunnable(r *Result, code int32) bool {
	if r.EmitSkipped {
		return false
	}
	found := false
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if !IsEK(d) || d.Code() != code {
			return false
		}
		found = true
	}
	return found
}
