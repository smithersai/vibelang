package vibelang

import (
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// alchemy-native-style-fix-coverage: a project that turns a VibeLang port on
// through the rule's assigned lint code, "vibe": { "severities": {
// "EK38123": "error" } }, sees EK4823's check reported as EK38123, and the
// language server offered no fix for it, though EK4823's own report has one
// (fly's Metadata.ts kept two single-return arrow blocks).

// lintCodeOf returns the assigned lint code that reports port, or fails.
func lintCodeOf(t *testing.T, port *Message) int32 {
	t.Helper()
	lints := core.VibeLintPorts[fmt.Sprintf("EK%04d", port.Code)]
	if len(lints) != 1 {
		t.Fatalf("EK%04d has lint codes %v", port.Code, lints)
	}
	code, err := strconv.Atoi(strings.TrimPrefix(lints[0], "EK"))
	if err != nil {
		t.Fatal(err)
	}
	return int32(code)
}

const quickFixCompilerOptions = `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true}`

// lintSeverityTsconfig is the project that sets severity for code.
func lintSeverityTsconfig(code int32, severity string) string {
	return `{"compilerOptions":` + quickFixCompilerOptions + `,"files":["main.vibe"],"vibe":{"severities":{"EK` + strconv.Itoa(int(code)) + `":"` + severity + `"}}}`
}

// quickFixResult returns source after the quick fix titled title for its
// diagnostic with code in the project tsconfig, and whether there was one.
func quickFixResult(t *testing.T, source, tsconfig string, code int32, title string) (string, bool) {
	t.Helper()
	program, file, service, converters := editorProgramConfig(t, source, editorPackageJSON, editorPackages, tsconfig)
	var diagnostic *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == code {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		t.Fatalf("missing EK%d in %s", code, source)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction != nil && action.CodeAction.Title == title && action.CodeAction.Edit != nil && action.CodeAction.Edit.Changes != nil {
				return applyEditorEdits(t, file, converters, (*action.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]), true
			}
		}
	}
	return "", false
}

func TestPortedLintCodeQuickFixes(t *testing.T) {
	for _, test := range []struct {
		name         string
		port         *Message
		source, want string
		title        string
	}{
		{"arrow block", EK4823, "export const one = (n: number) => { return n; };\n", "export const one = (n: number) => n;\n", "Write the value as the body"},
		{"arrow object", EK4823, "export const box = (n: number) => { return { value: n }; };\n", "export const box = (n: number) => ({ value: n });\n", "Write the value as the body"},
		{"callback block", EK4823, "export const two = [1, 2].map((n) => { return n * 2; });\n", "export const two = [1, 2].map((n) => n * 2);\n", "Write the value as the body"},
		{"empty pipe", EK4824, "import { pipe } from \"effect/Function\";\nexport const same = pipe(1);\n", "import { pipe } from \"effect/Function\";\nexport const same = 1;\n", "Remove the pipe"},
		{"pipe chain", EK4825, "import { pipe } from \"effect/Function\";\nconst inc = (n: number) => n + 1;\nexport const two = pipe(pipe(0, inc), inc);\n", "import { pipe } from \"effect/Function\";\nconst inc = (n: number) => n + 1;\nexport const two = pipe(0, inc, inc);\n", "Pass every function to one pipe"},
	} {
		for _, severity := range []string{"error", "warning"} {
			t.Run(test.name+"/"+severity, func(t *testing.T) {
				code := lintCodeOf(t, test.port)
				got, ok := quickFixResult(t, test.source, lintSeverityTsconfig(code, severity), code, test.title)
				if !ok {
					t.Fatalf("EK%d: missing quick fix %q", code, test.title)
				}
				if got != test.want {
					t.Fatalf("edited source differs:\ngot:  %q\nwant: %q", got, test.want)
				}
			})
		}
	}
}

// portedFixShapes are the keyed sources FuzzPortedLintCodeQuickFix builds:
// the port, its fix title and the source for an expression or receiver.
var portedFixShapes = map[string]struct {
	port   *Message
	title  string
	source func(expression string) string
}{
	"arrow-block":    {EK4823, "Write the value as the body", func(e string) string { return "export const f = (n: number) => { return " + e + "; };\n" }},
	"arrow-callback": {EK4823, "Write the value as the body", func(e string) string { return "export const xs = [1, 2].map((n) => { return " + e + " });\n" }},
	"arrow-object":   {EK4823, "Write the value as the body", func(e string) string { return "export const f = (n: number) => { return { value: " + e + " }; };\n" }},
	"arrow-nested":   {EK4823, "Write the value as the body", func(e string) string { return "export const f = (n: number) => () => { return " + e + " };\n" }},
	"pipe-empty":     {EK4824, "Remove the pipe", func(e string) string { return "import { pipe } from \"effect/Function\";\nconst n = 1;\nexport const same = pipe(" + e + ");\n" }},
	"pipe-chain":     {EK4825, "Pass every function to one pipe", func(e string) string { return "import { pipe } from \"effect/Function\";\nconst n = 1;\nconst inc = (x: number) => x + 1;\nexport const v = pipe(pipe(" + e + ", inc), inc);\n" }},
}

var portedFixExpressions = []string{"n", "n + 1", "n * 2 - 3", "(n > 0 ? n : -n)", "`${n}`.length", "Math.max(n, 0)", "[n, n].length"}

// A port is one check under either code (VIP-38's assigned lint codes): the
// quick fix a project gets for EK4823 enabled directly must be the one it gets
// for EK4823's check enabled through EK38123. This compares the compiler with
// itself on the two configurations, which must agree.
func FuzzPortedLintCodeQuickFix(f *testing.F) {
	for key := range portedFixShapes {
		for _, variant := range []uint8{0, 3} {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		shape, ok := portedFixShapes[key]
		if !ok {
			t.Skip("unknown shape key")
		}
		source := shape.source(portedFixExpressions[int(variant)%len(portedFixExpressions)])
		directive := fmt.Sprintf("// @vibelang-diagnostics EK%04d:warning\n", shape.port.Code)
		native, nativeOK := quickFixResult(t, directive+source, `{"compilerOptions":`+quickFixCompilerOptions+`,"files":["main.vibe"]}`, shape.port.Code, shape.title)
		code := lintCodeOf(t, shape.port)
		ported, portedOK := quickFixResult(t, source, lintSeverityTsconfig(code, "warning"), code, shape.title)
		if !nativeOK {
			t.Fatalf("%s: no EK%d quick fix %q\n%s", key, shape.port.Code, shape.title, source)
		}
		if nativeOK != portedOK || strings.TrimPrefix(native, directive) != ported {
			t.Fatalf("%s: EK%d fix %v %q, EK%d fix %v %q\n%s", key, shape.port.Code, nativeOK, native, code, portedOK, ported, source)
		}
	})
}
