package vibelang

import (
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// For generated modules with dead directives in every comment form, the
// rewrite keeps every token of the code, keeps each explanation once, writes
// each ported rule under its code, and leaves no Effect marker in a comment.
func TestDeadEffectDirectiveEditsProperty(t *testing.T) {
	rules := []string{"globalDate", "overriddenSchemaConstructor", "effectSucceedWithVoid", "preferSchemaOverJson", "raceFirstWithSleepToTimeout", "*"}
	severities := []string{"off", "warning", "error", "suggestion", "skip-file"}
	separators := []string{"", " -", " --", ":", " —", " "}
	proses := []string{"", "why", "The SDK credential API requires undefined, not void.", "races the interval: not a timeout", "see #123, then x-y"}
	codes := []string{"export const a = 1", "  const b = f(2)", "return x", "constructor(props: P) {}", "}"}
	port := func(_ int, rule string) string {
		if rule == "overriddenSchemaConstructor" {
			return "EK4814"
		}
		return ""
	}
	for seed := range uint64(600) {
		r := rand.New(rand.NewPCG(seed, 2026_11_04))
		pick := func(xs []string) string { return xs[r.IntN(len(xs))] }
		var lines, wantProse, wantPorts []string
		for range 1 + r.IntN(5) {
			var named []string
			ported := []string{}
			for range 1 + r.IntN(3) {
				rule, severity := pick(rules), pick(severities)
				named = append(named, rule+":"+severity)
				if rule == "overriddenSchemaConstructor" && (severity == "off" || severity == "warning" || severity == "error") {
					ported = append(ported, "EK4814:"+severity)
				}
			}
			prose := pick(proses)
			tail := ""
			if prose != "" {
				tail = pick(separators) + " " + prose
			}
			directive := effectNextLineMarker + " " + strings.Join(named, " ") + tail
			switch r.IntN(4) {
			case 0:
				lines = append(lines, "  // "+directive)
			case 1:
				lines = append(lines, "/* "+directive+" */")
			case 2:
				lines = append(lines, pick(codes)+" // "+directive)
			default:
				lines = append(lines, "/* "+directive+" */ "+pick(codes))
			}
			if len(ported) > 0 {
				wantPorts = append(wantPorts, strings.Join(ported, " "))
			} else if prose != "" {
				wantProse = append(wantProse, prose)
			}
			lines = append(lines, pick(codes))
		}
		source := strings.Join(lines, "\n") + "\n"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: tspath.CaseSensitive.PathKey("/main.vibe")}, source, core.ScriptKindTS)
		var positions []int
		for i := 0; ; {
			j := strings.Index(source[i:], effectNextLineMarker)
			if j < 0 {
				break
			}
			positions = append(positions, i+j)
			i += j + 1
		}
		got := applyEdits(source, deadEffectDirectiveEdits(file, positions, port))
		fail := func(format string, args ...any) {
			t.Fatalf("seed %d: %s\nsource:\n%s\ngot:\n%s", seed, fmt.Sprintf(format, args...), source, got)
		}
		if !slices.Equal(codeTokens(source), codeTokens(got)) {
			fail("the code's tokens changed")
		}
		if strings.Contains(got, effectNextLineMarker) {
			fail("an Effect marker is left")
		}
		for _, prose := range wantProse {
			if !strings.Contains(got, prose) {
				fail("lost the explanation %q", prose)
			}
		}
		for _, ported := range wantPorts {
			if !strings.Contains(got, directiveMarker+directiveNextLine+" "+ported) {
				fail("lost the ported setting %q", ported)
			}
		}
	}
}

// codeTokens returns the texts of the tokens of text, without its comments.
func codeTokens(text string) []string {
	lex := scanner.NewScanner()
	lex.SetText(text)
	var tokens []string
	for lex.Scan() != ast.KindEndOfFile {
		tokens = append(tokens, lex.TokenText())
	}
	return tokens
}
