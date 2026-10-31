package format

import (
	"context"
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 7 / VIP-34: "formatting is idempotent."
func TestFormatVibeLangDeclarationBraceLayout(t *testing.T) {
	for _, declaration := range []struct{ head, body string }{
		{"data Delivery", "Waiting;\nSent\n\n{ tracking: string };\nRejected { reason: string };"},
		{"data Delivery<A>", "Waiting;\nSent { tracking: A };"},
		{"schema User", "id: string;\nname: string;"},
		{"schema User", "address: { id: string };\nname: string;"},
		{"error Oops", "id: string;"},
		{"schema error Oops", "id: string;"},
	} {
		for _, gap := range []string{" ", "\n", "\n\n"} {
			for _, width := range []int{2, 4} {
				t.Run(fmt.Sprintf("%s/%q/%d", declaration.head, gap, width), func(t *testing.T) {
					source := declaration.head + gap + "{\n" + declaration.body + "\n}\n"
					settings := lsutil.GetDefaultFormatCodeSettings()
					settings.IndentSize, settings.TabSize = width, width
					settings.ConvertTabsToSpaces = core.TSTrue
					ctx := WithFormatCodeSettings(context.Background(), settings, "\n")
					apply := func(text string) string {
						file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/layout.vibe", PathKey: "/layout.vibe"}, text, core.ScriptKindTS)
						return core.ApplyBulkEdits(text, FormatDocument(ctx, file))
					}
					once := apply(source)
					if once == source {
						t.Fatal("formatter did not format the unindented body")
					}
					if err := vibelangfmt.SameProgram(source, once); err != nil {
						t.Fatal(err)
					}
					if twice := apply(once); twice != once {
						t.Fatalf("second format changes declaration layout\nsource:\n%s\nonce:\n%s\ntwice:\n%s", source, once, twice)
					}
				})
			}
		}
	}
}
