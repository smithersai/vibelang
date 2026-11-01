package scanner

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestLosslessECMALineTerminators(t *testing.T) {
	for _, newline := range []string{"\n", "\r", "\r\n", "\u2028", "\u2029"} {
		t.Run(fmt.Sprintf("%q", newline), func(t *testing.T) {
			source := "a" + newline + " b"
			s := NewScanner()
			s.SetSkipTrivia(false)
			s.SetText(source)
			kinds := []ast.Kind{ast.KindIdentifier, ast.KindNewLineTrivia, ast.KindWhitespaceTrivia, ast.KindIdentifier, ast.KindEndOfFile}
			starts := []int{0, 1, 1 + len(newline), 2 + len(newline), len(source)}
			ends := []int{1, 1 + len(newline), 2 + len(newline), len(source), len(source)}
			for i, kind := range kinds {
				if got := s.Scan(); got != kind {
					t.Fatalf("token %d: got %v, want %v", i, got, kind)
				}
				if s.TokenFullStart() != starts[i] || s.TokenStart() != starts[i] || s.TokenEnd() != ends[i] {
					t.Fatalf("token %d: full/start/end = %d/%d/%d, want %d/%d/%d", i, s.TokenFullStart(), s.TokenStart(), s.TokenEnd(), starts[i], starts[i], ends[i])
				}
			}

			s = NewScanner()
			s.SetSkipTrivia(true)
			s.SetText(source)
			if s.Scan() != ast.KindIdentifier || s.Scan() != ast.KindIdentifier || !s.HasPrecedingLineBreak() || s.TokenStart() != 2+len(newline) {
				t.Fatal("parser mode must retain the preceding-line-break flag and token start")
			}
		})
	}
}

func TestLosslessUnicodeTriviaBoundaries(t *testing.T) {
	for _, space := range []string{" ", "\u00a0", "\u2003", "\ufeff"} {
		s := NewScanner()
		s.SetSkipTrivia(false)
		s.SetText("a" + space + "b")
		if s.Scan() != ast.KindIdentifier || s.Scan() != ast.KindWhitespaceTrivia || s.HasPrecedingLineBreak() {
			t.Fatalf("single-line whitespace %q became a line break", space)
		}
	}
	for _, literal := range []struct {
		text string
		kind ast.Kind
	}{
		{"\"x\u2028y\"", ast.KindStringLiteral},
		{"`x\u2029y`", ast.KindNoSubstitutionTemplateLiteral},
		{"/* x\u2028y */", ast.KindMultiLineCommentTrivia},
	} {
		s := NewScanner()
		s.SetSkipTrivia(false)
		s.SetText(literal.text)
		if got := s.Scan(); got != literal.kind || s.TokenStart() != 0 || s.TokenEnd() != len(literal.text) {
			t.Fatalf("split literal/comment %q: %v at %d..%d", literal.text, got, s.TokenStart(), s.TokenEnd())
		}
	}
	for _, newline := range []string{"\u2028", "\u2029"} {
		s := NewScanner()
		s.SetSkipTrivia(false)
		s.SetText("// x" + newline + "b")
		if s.Scan() != ast.KindSingleLineCommentTrivia || s.TokenEnd() != 4 || s.Scan() != ast.KindNewLineTrivia || s.TokenEnd() != 4+len(newline) || s.Scan() != ast.KindIdentifier {
			t.Fatalf("line comment swallowed separator %q", newline)
		}
	}
}
