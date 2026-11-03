package vibelang

import (
	"os"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestConcurrentHeadMigrationFix(t *testing.T) {
	tests := []struct{ name, source, want string }{
		{"live outer read", "export effect function f() { let value = 'outer'; let read: () => string = () => ''; for concurrent (const value of (read = (): string => value.toUpperCase(), [1])) { const item = { value }; void item } value = 'later'; return read }",
			"export effect function f() { let value = 'outer'; let read: () => string = () => ''; for concurrent (const value2 of (read = (): string => value.toUpperCase(), [1])) { const item = { value: value2 }; void item } value = 'later'; return read }"},
		{"object binding and local shadow", "export effect function f() { let value = 'outer'; let read: () => string = () => ''; for concurrent (const { value } of (read = (): string => value.toUpperCase(), [{ value: 1 }])) { const item = { value }; { const value = 'local'; void value } void item } return read }",
			"export effect function f() { let value = 'outer'; let read: () => string = () => ''; for concurrent (const { value: value2 } of (read = (): string => value.toUpperCase(), [{ value: 1 }])) { const item = { value: value2 }; { const value = 'local'; void value } void item } return read }"},
		{"outer write", "export effect function f() { let value = 0; let read: () => number = () => 0; for concurrent (const value of (read = () => value = 2, [1])) { void value } return read }",
			"export effect function f() { let value = 0; let read: () => number = () => 0; for concurrent (const value2 of (read = () => value = 2, [1])) { void value2 } return read }"},
		{"already valid", "export effect function f() { const value = 'outer'; let read: () => unknown = () => 0; for concurrent (const value of (read = () => value.toFixed(), [1])) {} return read }", ""},
		{"unrelated return operand", "export effect function f() { const value = 'outer'; let read: () => unknown = () => 0; for concurrent (const value of (read = () => value + 1 .missing, [1])) {} return read }", ""},
		{"unrelated error", "export effect function f() { const value = 'outer'; let read: () => unknown = () => 0; for concurrent (const value of (1 .missing, read = () => value.toFixed(), [1])) {} return read }", ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, test.source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{VIPOnly: true})
			if test.want == "" {
				if len(result.Files) != 0 || len(result.Refused) != 0 {
					t.Fatalf("unexpected rewrite: %+v", result)
				}
				return
			}
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					t.Logf("diagnostic: %s code %d pos %d end %d", d.Source(), d.Code(), d.Pos(), d.End())
				}
				t.Fatalf("fix result: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if fixed.Text != test.want {
				t.Fatalf("got:\n%s\nwant:\n%s", fixed.Text, test.want)
			}
			if fixed.Rewrites[concurrentHeadRenameLabel] != 1 {
				t.Fatalf("missing rewrite receipt: %+v", fixed.Rewrites)
			}
			if errors := errorsOf(t, fixed.Text); len(errors) != 0 {
				t.Fatalf("fixed source: %v", errors)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{VIPOnly: true})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}
