package vibelangfuzz

import (
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatDottedOperationCommentKey = "dotted-operation-comments"
const formatDottedOperationCommentReason = "a comment inside VibeLang syntax cannot be formatted; move it before or after the form: "

// Match the formatter's own location and quoted replacement span, rather than
// a message fragment a source comment could imitate.
func formatDottedOperationCommentRefusal(err error) bool {
	if err == nil {
		return false
	}
	text, ok := strings.CutPrefix(err.Error(), "main.vibe: vibelang format: ")
	if !ok {
		return false
	}
	location, quoted, ok := strings.Cut(text, ": "+formatDottedOperationCommentReason)
	if !ok {
		return false
	}
	parts := strings.Split(location, ":")
	if len(parts) != 2 {
		return false
	}
	for _, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 1 {
			return false
		}
	}
	span, err := strconv.Unquote(quoted)
	if err != nil || (!strings.Contains(span, "//") && !strings.Contains(span, "/*")) {
		return false
	}
	ts := grammarLexSource(span)
	if len(ts) < 3 || ts[0].kind != 'w' || ts[2].kind != 'w' || ts[1].text != "." {
		return false
	}
	switch ts[0].text {
	case "try":
		return len(ts) == 3 && (ts[2].text == "all" || ts[2].text == "race" || ts[2].text == "any" || ts[2].text == "allSettled")
	case "fork":
		if ts[2].text == "in" {
			// The formatter replaces the complete owner call for fork.in.
			// Keep an operand following that call outside this known gap.
			return len(ts) >= 6 && ts[3].text == "(" && ts[len(ts)-1].text == ")" && grammarBalancedEnd(ts, 4) == len(ts)-1
		}
		return len(ts) == 3 && (ts[2].text == "scoped" || ts[2].text == "detached")
	}
	return false
}

func TestFormatDottedOperationCommentsQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", "whitespace, comments and line breaks may separate the tokens of `try.all`, `fork.in`, `fork.scoped` and `fork.detached`")
	chapterSays(t, "007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent.")
}

func formatDottedOperationCommentSources() []string {
	var sources []string
	gaps := [][2]string{
		{" /* run */ ", " "},
		{" // run\n ", " "},
		{" ", " /* operation */ "},
		{" ", " // operation\n "},
		{" /* run */ ", " /* operation */ "},
		{" // run\n ", " // operation\n "},
	}
	for _, operation := range []string{"all", "race", "any", "allSettled"} {
		for _, gap := range gaps {
			sources = append(sources, "import { Effect } from \"effect\"\neffect function f() { return try"+gap[0]+"."+gap[1]+operation+" [Effect.succeed(1)] }")
		}
	}
	for _, operation := range []string{"in", "scoped", "detached"} {
		for _, gap := range gaps {
			owner := ""
			if operation == "in" {
				owner = "(null as any)"
			}
			sources = append(sources, "import { Effect } from \"effect\"\neffect function f() { return fork"+gap[0]+"."+gap[1]+operation+owner+" Effect.succeed(1) }")
		}
	}
	return sources
}

func TestFormatDottedOperationCommentRefusalKeys(t *testing.T) {
	TestFormatDottedOperationCommentsQuoted(t)
	for _, source := range formatDottedOperationCommentSources() {
		if syntax := formatSyntaxError(source); syntax != "" {
			t.Fatalf("admitted fixture has syntax error %q\n%s", syntax, source)
		}
		_, err := vibelangfmt.Format("main.vibe", source, func(s string) (string, error) { return s, nil })
		if !formatDottedOperationCommentRefusal(err) {
			t.Errorf("dotted header refusal not identified: %v\n%s", err, source)
		}
	}
	makeError := func(span string) error {
		return fmt.Errorf("main.vibe: vibelang format: 1:1: %s%q", formatDottedOperationCommentReason, span)
	}
	for _, span := range []string{"fork /* context */ . in(scope)", "fork /* context */ . in(owner({ nested: [1] }))", "fork /* context */ . scoped", "fork /* context */ . detached"} {
		if !formatDottedOperationCommentRefusal(makeError(span)) {
			t.Errorf("owned dotted header not identified: %q", span)
		}
	}
	for _, span := range []string{"try.all", "fork /* comment */ . in", "fork /* comment */ . in()", "fork /* comment */ . in(s) work()", "fork /* comment */ . in(a, b)", "try /* comment */ . map", "fork /* comment */ . other", "try /* comment */ . any []", "effect /* comment */ function", "'try /* comment */ . any'"} {
		if formatDottedOperationCommentRefusal(makeError(span)) {
			t.Errorf("unrelated span entered known refusal: %q", span)
		}
	}
	if formatDottedOperationCommentRefusal(nil) || formatDottedOperationCommentRefusal(fmt.Errorf("unrelated: %s%q", formatDottedOperationCommentReason, "try /* comment */ . any")) {
		t.Fatal("unrelated error entered dotted-comment family")
	}
}
