package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Smithers' agent/fs (migrate-smithers inbox, EK9202 "needs FileSystem, but
// its contract says R = FileSystem"): with the DOM lib loaded, a contract's
// bare FileSystem is the DOM's (VIP-14), the body's FileSystem() Effect's.
// The diagnostic names Effect's type FileSystem.FileSystem, explains the
// collision, and --fix and --fix-vip-only write the contract's type through
// its module, the meaning it had before VIP-14.
func TestContractAmbientNamesake(t *testing.T) {
	body := "  const fs = try FileSystem()\n  return String(typeof fs)\n}\n"
	for _, test := range []struct {
		name, contract, want string
	}{
		{"alone", "Effect<string, never, FileSystem>", "Effect<string, never, FileSystem.FileSystem>"},
		{"union", "Effect<string, never, FileSystem | Path>", "Effect<string, never, FileSystem.FileSystem | Path>"},
		{"bang form", "string!!FileSystem", "string!!FileSystem.FileSystem"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "export effect function read(): " + test.contract + " {\n" + body
			program, file, _, _ := editorProgram(t, source)
			var messages []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK9202.Code {
					messages = append(messages, diagnosticChainText(d))
				}
			}
			if len(messages) != 1 {
				t.Fatalf("want one EK9202, got %q", messages)
			}
			for _, want := range []string{
				"read needs FileSystem.FileSystem, but its contract says R = ",
				"In a type position the bare name FileSystem is the ambient FileSystem type, not Effect's (VIP-14); Effect's FileSystem type is FileSystem.FileSystem.",
			} {
				if !strings.Contains(messages[0], want) {
					t.Errorf("EK9202 says\n%s\nwant it to contain\n%s", messages[0], want)
				}
			}
			if strings.Contains(messages[0], "FileSystem | FileSystem") {
				t.Errorf("EK9202 suggests a contract that names the DOM's FileSystem again:\n%s", messages[0])
			}
			for _, options := range []FixOptions{{}, {VIPOnly: true}} {
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
				fixed := result.Files[file.FileName()]
				if fixed == nil {
					t.Fatalf("%+v: --fix left the contract %s", options, test.contract)
				}
				if want := "export effect function read(): " + test.want + " {\n" + body; fixed.Text != want {
					t.Errorf("%+v: --fix wrote\n%s\nwant\n%s", options, fixed.Text, want)
				}
			}
		})
	}
	for _, control := range []struct{ name, source string }{
		// The DOM's FileSystem in a contract whose body needs no Effect FileSystem.
		{"no escape", "export effect function name(fs: FileSystem): Effect<string> {\n  return fs.name\n}\n"},
		// Effect's type written through its module already.
		{"qualified", "export effect function read(): Effect<string, never, FileSystem.FileSystem> {\n" + body},
	} {
		t.Run(control.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, control.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("unexpected error %d: %s", d.Code(), diagnosticChainText(d))
				}
			}
			if fixed := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine()).Files[file.FileName()]; fixed != nil {
				t.Fatalf("--fix rewrote\n%s", fixed.Text)
			}
		})
	}
}

// --fix removes an import of a module the prelude supplies (fix_prelude.go)
// and keeps each use's meaning. With the DOM lib a bare FileSystem type is
// the DOM's (VIP-14), so the imported FileSystem a type wrote becomes
// FileSystem.FileSystem, not the bare name (Smithers' explicit import beside
// the prelude name, migrate-smithers inbox). A parameter type is the silent
// case: the DOM's FileSystem compiles there too, and only the declaration
// file changes.
func TestFixPreludeImportAmbientType(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"parameter", "import { FileSystem } from \"effect/FileSystem\"\n\nexport const size = (fs: FileSystem): number => 1\n", "(fs: FileSystem.FileSystem): number"},
		{"contract", "import { FileSystem } from \"effect/FileSystem\"\n\nexport effect function read(): Effect<string, never, FileSystem> {\n  const fs = try FileSystem\n  return String(typeof fs)\n}\n", "Effect<string, never, FileSystem.FileSystem>"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("unexpected error %d: %s", d.Code(), diagnosticChainText(d))
				}
			}
			fixed := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine()).Files[file.FileName()]
			if fixed == nil || strings.Contains(fixed.Text, "import") {
				return // the import stayed, and so did the meaning
			}
			if !strings.Contains(fixed.Text, test.want) {
				t.Fatalf("--fix removed the import and left a bare FileSystem, the DOM's:\n%s", fixed.Text)
			}
		})
	}
}

// diagnosticChainText is d's message followed by each message it chains.
func diagnosticChainText(d *ast.Diagnostic) string {
	text := d.MessageText()
	for _, chained := range d.MessageChain() {
		text += "\n" + diagnosticChainText(chained)
	}
	return text
}
