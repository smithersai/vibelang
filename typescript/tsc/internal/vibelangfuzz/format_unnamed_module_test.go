package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatUnnamedModuleKey = "key:unnamed-module-projection\n"
const formatUnnamedModuleQuote = "It preserves inferred and declared public types, declarations and throws contracts, and diagnostic codes, categories and occurrences"

func TestFormatUnnamedModuleQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), formatUnnamedModuleQuote) {
		t.Fatalf("chapter 7 no longer says %q", formatUnnamedModuleQuote)
	}
}

// The key selects this recovery neighbourhood independently of other generators.
// VIP-34 requires preserving diagnostics, including EK4003 for the missing name;
// a temporary TypeScript projection name must never become a source repair.
func formatUnnamedModuleSource(source string) string {
	if !strings.HasPrefix(source, formatUnnamedModuleKey) {
		return source
	}
	data := []byte(strings.TrimPrefix(source, formatUnnamedModuleKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	body := []string{"", "export function clean(): string { return \"\" }", "/* body */ export const value={x:1, y:[2,3]}", "export async function clean() { return await Promise.resolve(1) }"}[pick(0)%4]
	if pick(0)&128 != 0 {
		body = "export const broken = ("
	}
	gap := []string{" ", "", " /* missing name */ "}[pick(1)%3]
	newline := []string{"\n", "\r\n"}[pick(2)%2]
	result := "/** module */" + newline + "module" + gap + "{" + newline + body + newline + "}" + newline
	switch pick(3) % 3 {
	case 1:
		result += "module named { export const n=1 }" + newline
	case 2:
		result += "module { export const n=2 }" + newline
	}
	return result + "export function main( ) { return 1 }" + newline
}

func TestFormatUnnamedModuleGenerator(t *testing.T) {
	formatter := toolsFormatter(t)
	for body := byte(0); body < 4; body++ {
		for gap := byte(0); gap < 3; gap++ {
			for tail := byte(0); tail < 6; tail++ {
				source := formatUnnamedModuleSource(formatUnnamedModuleKey + string([]byte{body, gap, tail, tail / 2}))
				if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
					t.Fatalf("%s\n%s", syntax, source)
				}
				once, err := vibelangfmt.Format("main.vibe", source, formatter)
				if err != nil {
					t.Fatalf("%v\n%s", err, source)
				}
				if err := vibelangfmt.SameProgram(source, once); err != nil {
					t.Fatal(err)
				}
				twice, err := vibelangfmt.Format("main.vibe", once, formatter)
				if err != nil || once != twice {
					t.Fatalf("unstable: %v\n%s\n%s", err, once, twice)
				}
			}
		}
	}
}

func TestFormatUnnamedModuleDiagnostics(t *testing.T) {
	w := NewWorkspace(t)
	source := formatUnnamedModuleSource(formatUnnamedModuleKey + "\x01\x02\x00\x02")
	once, err := vibelangfmt.Format("main.vibe", source, toolsFormatter(t))
	if err != nil {
		t.Fatal(err)
	}
	before := toolsCompile(t, w, "FuzzFormat", Single(source).Files)
	defer before.Remove()
	after := toolsRecompile(t, w, before, Single(once).Files)
	if difference := toolsFormatDifference(before, after); difference != "" {
		t.Fatal(difference)
	}
	count := 0
	for _, d := range after.Diagnostics {
		if diagnosticCodeName(d.Source(), d.Code()) == "EK4003" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("want two missing-name diagnostics, got %d: %v", count, after.Diagnostics)
	}
}

// VIP-34: "An unparsable file is reported and left unchanged; formatting is idempotent."
func TestFormatUnnamedModuleSyntaxQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "An unparsable file is reported and left unchanged; formatting is idempotent.") {
		t.Fatal("formatter syntax-error contract changed")
	}
	source := formatUnnamedModuleSource(formatUnnamedModuleKey + string([]byte{128, 0, 0, 0}))
	if syntax := formatSyntaxError(source); syntax == "" {
		t.Fatalf("missed invalid recovered TypeScript body: %s", source)
	}
	if _, err := vibelangfmt.Format("main.vibe", source, toolsFormatter(t)); err == nil {
		t.Fatal("formatted invalid recovered TypeScript body")
	}
}
