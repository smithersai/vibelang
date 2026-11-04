package vibelangfuzz

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/format"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatterRelationalRHSQuote = "PatternMatchingRelationalExpression[Yield, Await] :\n        Literal\n        NoSubstitutionTemplate\n        PatternMatchingMemberExpression[?Yield, ?Await]\n        PatternMatchingUnaryAlgebraicExpression[?Yield, ?Await]"

func TestFormatterRelationalRHSQuoted(t *testing.T) {
	chapterSays(t, "../vips/tc39-pattern-matching/spec.emu", formatterRelationalRHSQuote)
	chapterSays(t, "007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent.")
}

// A regex is not ECMAScript's Literal production. Keep it inside the
// member's bracket Expression for a valid relational operand. Mutate all
// comparison operators, regex flags, comments, CRLF and UTF-16 offsets.
func FuzzFormatterRelationalRHS(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"member-regex", "literal", "raw-regex-rejected"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(255))
	}
	ctx := format.WithFormatCodeSettings(context.Background(), lsutil.GetDefaultFormatCodeSettings(), "\n")
	hosts := []struct {
		name   string
		format vibelangfmt.TypeScriptFormatter
	}{
		{"identity", func(s string) (string, error) { return s, nil }},
		{"tsx", func(s string) (string, error) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/formatter.tsx", PathKey: "/formatter.tsx"}, s, core.ScriptKindTSX)
			return core.ApplyBulkEdits(s, format.FormatDocument(ctx, file)), nil
		}},
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestFormatterRelationalRHSQuoted(t)
		operator := []string{"<", ">", "<=", ">=", "==", "!=", "===", "!=="}[mode&7]
		regex := "/b/"
		if mode&64 != 0 {
			regex = "/b/gi"
		}
		operand := "limits[" + regex + ".source]"
		invalid := false
		switch key {
		case "literal":
			operand = "3"
		case "raw-regex-rejected":
			operand = regex
			invalid = true
		default:
			key = "member-regex"
		}
		trivia := " "
		if mode&16 != 0 {
			trivia = " /* pattern */ "
		}
		source := fmt.Sprintf("const el = match (s) { when%s%s %s: <A/>; default: <B/>; }\n", trivia, operator, operand)
		if mode&32 != 0 {
			source = strings.ReplaceAll(source, "; ", ";\n  ")
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		if mode&128 != 0 {
			source = "// café 😀\n" + source
		}
		for _, host := range hosts {
			once, err := vibelangfmt.Format("view.vibex", source, host.format)
			gapKey := key + ":" + host.name
			if invalid {
				if err == nil {
					Gap(t, "FuzzFormatterRelationalRHS", "reject:"+gapKey, "raw regex is outside the pinned relational RHS grammar:\n%s", source)
				}
				continue
			}
			if err != nil {
				Gap(t, "FuzzFormatterRelationalRHS", "valid:"+gapKey, "valid member/literal operand refused: %v\n%s", err, source)
				continue
			}
			if host.name == "identity" && once != source {
				Gap(t, "FuzzFormatterRelationalRHS", "identity:"+gapKey, "identity host changed source:\n%s\n%s", source, once)
			}
			twice, err := vibelangfmt.Format("view.vibex", once, host.format)
			if err != nil || twice != once {
				Gap(t, "FuzzFormatterRelationalRHS", "idempotent:"+gapKey, "second format changed source: %v\n%s\n%s", err, once, twice)
			}
			if mode&16 != 0 && !strings.Contains(once, "/* pattern */") {
				Gap(t, "FuzzFormatterRelationalRHS", "comment:"+gapKey, "lost pattern comment:\n%s", once)
			}
		}
	})
}
