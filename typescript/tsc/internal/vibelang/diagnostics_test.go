package vibelang

import (
	"fmt"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestCategory(t *testing.T) {
	t.Parallel()
	with := func(codes map[string]string) *core.CompilerOptions {
		return &core.CompilerOptions{VibeLang: &core.VibeLangOptions{Diagnostics: codes}}
	}
	tests := []struct {
		name    string
		message *Message
		options *core.CompilerOptions
		want    diagnostics.Category
		on      bool
	}{
		{"EK9100 is a migration warning", EK9100, nil, diagnostics.CategoryWarning, true},
		{"EK9100 can be an error", EK9100, with(map[string]string{"EK9100": "error"}), diagnostics.CategoryError, true},
		{"EK9100 can be a warning", EK9100, with(map[string]string{"EK9100": "warning"}), diagnostics.CategoryWarning, true},
		{"EK9100 can be off", EK9100, with(map[string]string{"EK9100": "off"}), 0, false},
		{"EK4406 can be an error", EK4406, with(map[string]string{"EK4406": "error"}), diagnostics.CategoryError, true},
		{"EK4406 can be a warning", EK4406, with(map[string]string{"EK4406": "warning"}), diagnostics.CategoryWarning, true},
		{"EK4406 is a migration warning", EK4406, nil, diagnostics.CategoryWarning, true},
		{"EK9204 is a warning by default", EK9204, nil, diagnostics.CategoryWarning, true},
		{"EK4403 is an error by default", EK4403, &core.CompilerOptions{}, diagnostics.CategoryError, true},
		{"EK9204 can be an error", EK9204, with(map[string]string{"EK9204": "error"}), diagnostics.CategoryError, true},
		{"EK4403 can be a warning", EK4403, with(map[string]string{"EK4403": "warning"}), diagnostics.CategoryWarning, true},
		{"EK4403 can be off", EK4403, with(map[string]string{"EK4403": "off"}), 0, false},
		{"EK1023 cannot be disabled", EK1023, with(map[string]string{"EK1023": "off"}), diagnostics.CategoryError, true},
		{"EK1010 cannot be disabled", EK1010, with(map[string]string{"EK1010": "off"}), diagnostics.CategoryError, true},
		{"other codes stay errors", EK9201, with(map[string]string{"EK9201": "off"}), diagnostics.CategoryError, true},
		{"EK3207 cannot be disabled", EK3207, with(map[string]string{"EK3207": "off"}), diagnostics.CategoryError, true},
		{"EK4801 is an error by default", EK4801, nil, diagnostics.CategoryError, true},
		{"EK4814 is a warning by default", EK4814, nil, diagnostics.CategoryWarning, true},
		{"EK4814 can be an error", EK4814, with(map[string]string{"EK4814": "error"}), diagnostics.CategoryError, true},
		{"EK4818 is off by default", EK4818, nil, 0, false},
		{"EK4818 can be a warning", EK4818, with(map[string]string{"EK4818": "warning"}), diagnostics.CategoryWarning, true},
		{"EK4813 stays an error", EK4813, with(map[string]string{"EK4813": "off"}), diagnostics.CategoryError, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, on := category(test.options, test.message)
			if got != test.want || on != test.on {
				t.Errorf("category(%s) = %v, %v; want %v, %v", test.message, got, on, test.want, test.on)
			}
		})
	}
}

// renumbering is the lane that registers the codes decided detail 60 gives
// each VIP's rules, one hundred-block per VIP.
const renumbering = "lane diag-renumber registers each VIP's hundred-block (decided detail 60)"

// specAhead holds the codes Appendix B assigns before the registry has them,
// each with the lane that registers it. A code here that the registry has, or
// that Appendix B no longer assigns, fails, so the change that registers it
// deletes its entry.
var specAhead = map[int32]string{
	1301: renumbering, 1302: renumbering, 1303: renumbering, 1304: renumbering,
	// Assigned by the round-17 and round-18 spec (decided detail 60) for VibeLang syntax errors and decided details 67b, 82 and 88.
	302: renumbering, 509: renumbering, 701: renumbering, 702: renumbering, 703: renumbering, 905: renumbering,
	1202: renumbering, 1305: renumbering, 1601: renumbering, 1702: renumbering, 1703: renumbering, 1704: renumbering, 1906: renumbering,
	// Assigned by the round-19 and round-20 spec for decided details 96 (a @throws tag on an effectful callable) and 100 (an extractor on a class without its own matcher).
	406: renumbering, 704: renumbering,
	// VIP-15 and VIP-16 catalog existing named/nongeneric declaration rejections.
	1501: renumbering, 1502: renumbering, 1603: renumbering,
	// Decided details 122/130 reserve a separate code for Data.taggedEnum helper variant names.
	1602: renumbering,
}

// TestRegistryMatchesSpec checks the registry against Appendix B of the
// specification, the diagnostics VIP-34 asks for: every code the VIPs assign
// must be registered, unless specAhead names the lane that registers it. The
// registry's other codes are the old language's, which Appendix B says are
// not normative, until a VIP assigns codes to the rules it marks "code
// pending"; they are logged, not failed.
func TestRegistryMatchesSpec(t *testing.T) {
	t.Parallel()
	spec, err := os.ReadFile("../../../../docs/design/src/900-appendices.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(spec)
	start := strings.Index(text, "## Appendix B. Diagnostics")
	if start < 0 {
		t.Fatal("the specification has no Appendix B. Diagnostics")
	}
	appendix := text[start:]
	if next := strings.Index(appendix[1:], "\n## "); next >= 0 {
		appendix = appendix[:next+1]
	}
	var assigned []int32
	for _, m := range regexp.MustCompile("(?m)^\\| `?EK(38[0-9]{2,}|[0-9]{4})`? \\|").FindAllStringSubmatch(appendix, -1) {
		code, _ := strconv.Atoi(m[1])
		assigned = append(assigned, int32(code))
	}
	if len(assigned) == 0 {
		t.Fatal("Appendix B assigns no code")
	}
	for _, code := range assigned {
		lane, ahead := specAhead[code]
		switch {
		case registry[code] == nil && core.VibeImportedLintCodes[fmt.Sprintf("EK%04d", code)] == "" && !ahead:
			t.Errorf("Appendix B assigns EK%04d, which the registry does not have", code)
		case registry[code] != nil && ahead:
			t.Errorf("the registry has EK%04d now; delete it from specAhead (%s)", code, lane)
		}
	}
	for code, lane := range specAhead {
		if !slices.Contains(assigned, code) {
			t.Errorf("specAhead holds EK%04d, which Appendix B does not assign; delete it (%s)", code, lane)
		}
	}
	var pending []int32
	for code := range registry {
		if !slices.Contains(assigned, code) {
			pending = append(pending, code)
		}
	}
	slices.Sort(pending)
	t.Logf("%d codes assigned by Appendix B; %d registry codes of the old language await a VIP: %v", len(assigned), len(pending), pending)
}

func TestDirectiveCategory(t *testing.T) {
	t.Parallel()
	text := strings.Join([]string{
		"a()", // 0
		"// @vibelang-diagnostics-next-line EK4801:off",
		"b()", // 2: off for the next line only
		"c()", // 3
		"/* @vibelang-diagnostics EK4801:warning */",
		"d()", // 5: a warning from here on
		`const s = "@vibelang-diagnostics EK4801:off"`,
		"e()", // 7: a string is not a comment
		"// @vibelang-diagnostics *:off EK4818:warning",
		"f()", // 9: * turns EK4801 off, and EK4818 named on its own is a warning
		"// @vibelang-diagnostics EK4801:error",
		"g()", // 11: a later comment overrides *
		"// @vibelang-diagnostics-next-line EK4801:warning: the reason after a colon is prose",
		"h()", // 13: punctuation after a category ends it, so the reason can follow
		"// @vibelang-diagnostics-next-line EK4801:warning, EK4818:error.",
		"i()", // 15: so can a comma or a full stop
	}, "\n")
	at := func(line int) int {
		return len(strings.Join(strings.Split(text, "\n")[:line], "\n")) + core.IfElse(line > 0, 1, 0)
	}
	tests := []struct {
		line int
		m    *Message
		want diagnostics.Category
		on   bool
	}{
		{0, EK4801, diagnostics.CategoryError, true},
		{2, EK4801, 0, false},
		{3, EK4801, diagnostics.CategoryError, true},
		{5, EK4801, diagnostics.CategoryWarning, true},
		{7, EK4801, diagnostics.CategoryWarning, true},
		{9, EK4801, 0, false},
		{9, EK4818, diagnostics.CategoryWarning, true},
		{11, EK4801, diagnostics.CategoryError, true},
		{11, EK4818, diagnostics.CategoryWarning, true},
		{13, EK4801, diagnostics.CategoryWarning, true},
		{15, EK4801, diagnostics.CategoryWarning, true},
		{15, EK4818, diagnostics.CategoryError, true},
	}
	for _, test := range tests {
		category, on := category(nil, test.m)
		got, gotOn := directiveCategoryIn(text, at(test.line), test.m, category, on)
		if got != test.want || gotOn != test.on {
			t.Errorf("line %d, %s: got %v, %v; want %v, %v", test.line, test.m, got, gotOn, test.want, test.on)
		}
	}
}

// Every registered EK code shares the file-kind boundary, even when a project
// or a source directive explicitly asks for an error.
func TestEKDiagnosticsOnlyAttachToVibeLang(t *testing.T) {
	for _, ext := range []string{"ts", "tsx", "mts", "cts", "js", "jsx", "vibe"} {
		t.Run(ext, func(t *testing.T) {
			name := "/main." + ext
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(name)}, "// @vibelang-diagnostics *:error\nconst x = 1", core.ScriptKindTS)
			for code, m := range registry {
				options := &core.CompilerOptions{VibeLang: &core.VibeLangOptions{Diagnostics: map[string]string{"EK" + strconv.Itoa(int(code)): "error"}}}
				got := newDiagnosticAt(options, file, core.NewTextRange(len("// @vibelang-diagnostics *:error\n"), len("// @vibelang-diagnostics *:error\n")+1), m)
				if ext != "vibe" && got != nil {
					t.Errorf("EK%d attached to .%s", code, ext)
				}
				if ext == "vibe" && got == nil {
					t.Errorf("EK%d suppressed in .vibe", code)
				}
			}
		})
	}
}
