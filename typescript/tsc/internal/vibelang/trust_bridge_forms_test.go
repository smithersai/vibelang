package vibelang

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// bridgeProject compiles main.vibe beside the other files, each a name
// relative to the project directory, with effect and vibelang-runtime
// installed. It returns the program, main.vibe and a language service.
func bridgeProject(t *testing.T, files map[string]string) (*compiler.Program, *ast.SourceFile, *ls.LanguageService, *lsconv.Converters) {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, target := range editorPackages {
		if _, err := os.Stat(filepath.Join(root, target)); err != nil {
			t.Fatalf("fixture package %q is unavailable: %v; run sh scripts/setup.sh", name, err)
		}
		if err := os.Symlink(filepath.Join(root, target), filepath.Join(dir, "node_modules", name)); err != nil {
			t.Fatal(err)
		}
	}
	all := map[string]string{
		"package.json":  editorPackageJSON,
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"files":["main.vibe"]}`,
	}
	for name, text := range files {
		all[name] = text
	}
	for name, text := range all {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		text, ok := fs.ReadFile(name)
		if !ok {
			t.Fatalf("missing document %s", name)
		}
		return lsconv.ComputeLSPLineStarts(text)
	})
	return program, file, ls.NewLanguageService(nil, program, editorTestHost{converters: converters}, string(file.FileName())), converters
}

// bridgeErrors returns every error the program reports, syntax and global
// diagnostics included, as text.
func bridgeErrors(t *testing.T, program *compiler.Program) []string {
	t.Helper()
	var all []*ast.Diagnostic
	all = append(all, program.GetSyntacticDiagnostics(t.Context(), nil)...)
	all = append(all, program.GetSemanticDiagnostics(t.Context(), nil)...)
	all = append(all, program.GetGlobalDiagnostics(t.Context())...)
	var errors []string
	for _, d := range all {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, diagnosticWithNotes(d))
		}
	}
	return errors
}

// TestForeignCallBridgeFormsCompile closes the loop between EK0403 and its
// repairs: every bridge form the note names, and every code action EK0403
// offers, written into the program, leaves no error. The chapter 900 EK0403
// row names the repairs: the Effect.try bridge, Effect.orDie over it to keep
// exceptions as defects, and @throws {never} on a provably non-throwing
// same-project declaration. The note once also named
// trusted(f, [Errors]) from vibelang-runtime, whose function argument is
// EK0402 for an unannotated TypeScript function (VIP-4), so following the
// note traded one error for another.
func TestForeignCallBridgeFormsCompile(t *testing.T) {
	const throwing = "export function evaluate(x: number): number { if (x < 0) throw new Error(\"negative\"); return x }\n"
	const total = "export function evaluate(x: number): number { return x * 2 }\n"
	notePattern := regexp.MustCompile(`Call it through (.+?), or keep its exceptions as defects with (.+?)\.(?:\n|$)`)
	for _, test := range []struct {
		name, foreign, imports, call string
		actions                      []string // code action descriptions, in order
	}{
		{"imported function", throwing, `import { evaluate } from "./probe_foreign.ts"`, "evaluate(x)", []string{"Write the call through Effect.try, preserving failures and defects"}},
		{"namespace member", throwing, `import * as Permission from "./probe_foreign.ts"`, "Permission.evaluate(x)", []string{"Write the call through Effect.try, preserving failures and defects"}},
		{"effect operand", throwing, `import { evaluate } from "./probe_foreign.ts"` + "\neffect function base(x: number) { return x + 1 }", "evaluate(try base(x))", []string{"Write the call through Effect.try, preserving failures and defects"}},
		{"provably total", total, `import { evaluate } from "./probe_foreign.ts"`, "evaluate(x)", []string{"Write the call through Effect.try, preserving failures and defects", "Add /** @throws {never} */ to evaluate"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			prefix := test.imports + "\nexport effect function use(x: number) {\n  "
			source := prefix + "return " + test.call + "\n}\n"
			program, file, service, converters := bridgeProject(t, map[string]string{"main.vibe": source, "probe_foreign.ts": test.foreign})
			var witness *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK0403.Code {
					witness = d
				} else if d.Category() == diagnostics.CategoryError {
					t.Fatalf("unexpected error before the repair: %s", diagnosticWithNotes(d))
				}
			}
			if witness == nil {
				t.Fatal("missing EK0403 witness")
			}
			note := diagnosticWithNotes(witness)
			if strings.Contains(note, "trusted(") {
				t.Fatalf("EK0403 suggests the legacy trusted wrapper: %s", note)
			}
			forms := notePattern.FindStringSubmatch(note)
			if forms == nil {
				t.Fatalf("EK0403 note names no bridge forms: %s", note)
			}
			if !strings.Contains(forms[2], "Effect.orDie(Effect.try({ try: () => ") || !strings.HasSuffix(forms[2], "catch: (e) => e }))") {
				t.Fatalf("the defect bridge is %q, want the code action's inline identity bridge", forms[2])
			}
			// Each form is statements: the consts it binds, then the run.
			for _, form := range forms[1:] {
				run := lastStatement(form)
				body := strings.TrimSuffix(form, run) + "return " + run
				fixed, _, _, _ := bridgeProject(t, map[string]string{"main.vibe": prefix + body + "\n}\n", "probe_foreign.ts": test.foreign})
				if errors := bridgeErrors(t, fixed); len(errors) != 0 {
					t.Errorf("the note's form %s does not compile:\n%s", form, strings.Join(errors, "\n"))
				}
			}
			actions, err := foreignCallFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: witness.Loc(), ErrorCode: EK0403.Code, Program: program, LS: service})
			if err != nil {
				t.Fatal(err)
			}
			var descriptions []string
			for _, action := range actions {
				descriptions = append(descriptions, action.Description)
			}
			if strings.Join(descriptions, "\n") != strings.Join(test.actions, "\n") {
				t.Fatalf("code actions %q, want %q", descriptions, test.actions)
			}
			for _, action := range actions {
				after := map[string]string{"main.vibe": source, "probe_foreign.ts": test.foreign}
				after["main.vibe"] = applyEditorEdits(t, file, converters, action.Changes)
				for _, change := range action.AdditionalChanges {
					for _, target := range program.SourceFiles() {
						if lsconv.FileNameToDocumentURI(target.FileName()) == change.URI {
							after[filepath.Base(string(target.FileName()))] = applyEditorEdits(t, target, converters, change.Changes)
						}
					}
				}
				fixed, _, _, _ := bridgeProject(t, after)
				if errors := bridgeErrors(t, fixed); len(errors) != 0 {
					t.Errorf("code action %q does not compile:\n%s\n%s", action.Description, after["main.vibe"], strings.Join(errors, "\n"))
				}
			}
		})
	}
}

// lastStatement is the run that ends a note's form, after the consts that
// bind its Effect operands.
func lastStatement(form string) string {
	if i := strings.LastIndex(form, "; try "); i >= 0 {
		return form[i+2:]
	}
	return form
}
