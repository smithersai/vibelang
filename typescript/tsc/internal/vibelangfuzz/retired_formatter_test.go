package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
	"strings"
	"testing"
)

// VIP-35: "the first release ships without handlers." Whitespace, encoding
// and JSX mode cannot make a retired control declaration reach the host.
func FuzzRetiredFormatterControl(f *testing.F) {
	startShortBudget(f)
	for _, n := range []uint8{0, 1, 7, 255} {
		f.Add(n, false, false)
		f.Add(n, true, true)
	}
	f.Fuzz(func(t *testing.T, n uint8, crlf, jsx bool) {
		gap := strings.Repeat(" \t", int(n%8)+1)
		source := "control" + gap + "Approval { approve(): boolean }\n"
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		name := "retired.vibe"
		if jsx {
			name += "x"
		}
		called := false
		result, err := vibelangfmt.Format(name, source, func(text string) (string, error) { called = true; return text, nil })
		if err == nil || !strings.Contains(err.Error(), parser.RetiredControlMessage) || result != "" || called {
			t.Fatalf("source %q: result=%q err=%v host called=%v", source, result, err, called)
		}
	})
}
