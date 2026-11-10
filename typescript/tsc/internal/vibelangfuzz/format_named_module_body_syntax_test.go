package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatNamedModuleBodyKey = "key:native-module-body-syntax\n"
const formatNamedModuleBodyQuote = "Its body is a TypeScript file stored in the `.vibe` file"
const formatNamedModuleRefusalQuote = "An unparsable file is reported and left unchanged; formatting is idempotent."

var formatNamedModuleBodyRows = []struct {
	key, body string
	invalid   bool
}{
	{"error-declaration", "error Failure { reason: string }", true},
	{"effect-contract", "export function read(): number!Failure { return 1 }", true},
	{"unfinished-initializer", "export const broken = (", true},
	{"valid-constant", "export const value = 1", false},
	{"valid-function", "export function read(n: number): number { return n + 1 }", false},
	{"valid-throw", "export function read(): never { throw new Error('x') }", false},
}

func formatNamedModuleBodySyntaxQuoted(t testing.TB) {
	t.Helper()
	for _, row := range []struct{ chapter, quote string }{
		{"001-functions.md", formatNamedModuleBodyQuote},
		{"007-tooling.md", formatNamedModuleRefusalQuote},
	} {
		b, err := os.ReadFile(SpecPath(row.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), row.quote) {
			t.Fatalf("chapter %s no longer says %q", row.chapter, row.quote)
		}
	}
}
func TestFormatNamedModuleBodySyntaxQuoted(t *testing.T) { formatNamedModuleBodySyntaxQuoted(t) }

func formatNamedModuleBodySyntaxSource(source string) string {
	if !strings.HasPrefix(source, formatNamedModuleBodyKey) {
		return source
	}
	data := strings.TrimPrefix(source, formatNamedModuleBodyKey)
	parts := strings.SplitN(data, "\x00", 2)
	row := formatNamedModuleBodyRows[len(data)%len(formatNamedModuleBodyRows)]
	for _, r := range formatNamedModuleBodyRows {
		if r.key == parts[0] {
			row = r
			break
		}
	}
	variant := byte(len(data))
	if len(parts) > 1 && len(parts[1]) > 0 {
		variant = parts[1][0]
	}
	name := "host"
	if variant&1 != 0 {
		name = "text"
	}
	newline := "\n"
	if variant&2 != 0 {
		newline = "\r\n"
	}
	return "/* native module */" + newline + "module " + name + " {" + newline + row.body + newline + "}" + newline + "export function main() { return 1 }" + newline
}

func TestFormatNamedModuleBodySyntax(t *testing.T) {
	formatter := toolsFormatter(t)
	for _, row := range formatNamedModuleBodyRows {
		for variant := byte(0); variant < 4; variant++ {
			t.Run(fmt.Sprintf("%s/%d", row.key, variant), func(t *testing.T) {
				source := formatNamedModuleBodySyntaxSource(formatNamedModuleBodyKey + row.key + "\x00" + string([]byte{variant}))
				syntax := formatSyntaxError(source)
				if (syntax != "") != row.invalid {
					t.Fatalf("native syntax classification: invalid=%v, got %q; %s", row.invalid, syntax, source)
				}
				once, err := vibelangfmt.Format("main.vibe", source, formatter)
				if row.invalid {
					if err == nil {
						t.Fatalf("formatted invalid TypeScript module body: %s", source)
					}
					return
				}
				if err != nil {
					t.Fatalf("refused valid native body: %v; %s", err, source)
				}
				if err := vibelangfmt.SameProgram(source, once); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
