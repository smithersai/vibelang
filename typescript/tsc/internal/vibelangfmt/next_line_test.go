package vibelangfmt_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/format"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

func TestFormatNextLineDeclarationBodies(t *testing.T) {
	ctx := format.WithFormatCodeSettings(context.Background(), lsutil.GetDefaultFormatCodeSettings(), "\n")
	formatters := map[string]vibelangfmt.TypeScriptFormatter{
		"typescript": func(text string) (string, error) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/format.ts", PathKey: "/format.ts"}, text, core.ScriptKindTS)
			return core.ApplyBulkEdits(text, format.FormatDocument(ctx, file)), nil
		},
	}
	if binary := os.Getenv("VIBELANG_DPRINT"); binary != "" {
		config, err := filepath.Abs(filepath.Join("testdata", "dprint.json"))
		if err != nil {
			t.Fatal(err)
		}
		formatters["dprint"] = func(text string) (string, error) {
			command := exec.Command(binary, "fmt", "--config", config, "--stdin", "file.ts")
			command.Stdin = strings.NewReader(text)
			var out, stderr bytes.Buffer
			command.Stdout, command.Stderr = &out, &stderr
			if err := command.Run(); err != nil {
				return "", fmt.Errorf("%w: %s", err, stderr.String())
			}
			return out.String(), nil
		}
	}
	sources := map[string]string{
		"data":          "data Delivery\n{\n  Waiting;\n  Sent\n\n  { tracking: string };\n  Rejected { reason: string };\n}\n",
		"schema":        "schema Account\n{\n  id: string\n}\n",
		"error":         "error Missing\n{\n  id: string\n}\n",
		"data variant":  "data D {\n  A\n  { value: string }\n}\n",
		"generic data":  "data Result<A>\n{\n  Done { value: A };\n  Empty;\n}\n",
		"generic error": "error Missing<A>\n{\n  id: A\n}\n",
		"nested":        "function f() {\n  data D\n  {\n    A;\n    B { n: number };\n  }\n  return D.A()\n}\n",
		"crlf":          "error Missing\r\n{\r\n  id: string\r\n}\r\n",
	}
	for host, formatter := range formatters {
		t.Run(host, func(t *testing.T) {
			for name, source := range sources {
				t.Run(name, func(t *testing.T) {
					first, err := vibelangfmt.Format("next-line.vibe", source, formatter)
					if err != nil {
						t.Fatal(err)
					}
					second, err := vibelangfmt.Format("next-line.vibe", first, formatter)
					if err != nil {
						t.Fatal(err)
					}
					if first != second {
						t.Fatalf("formatting is not idempotent\nfirst:\n%s\nsecond:\n%s", first, second)
					}
				})
			}
		})
	}
}
