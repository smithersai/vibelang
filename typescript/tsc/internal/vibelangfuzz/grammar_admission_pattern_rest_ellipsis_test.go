package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The pinned MatchRestElement has one ellipsis, optionally followed by a
// MatchPattern. MatchPattern has no standalone ellipsis alternative.
const grammarPatternRestEllipsisQuote = "MatchRestElement[Yield, Await] :\n        `...`\n        `...` MatchPattern[?Yield, ?Await]"

func TestGrammarAdmissionPatternRestEllipsisQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/tc39-pattern-matching/spec.emu"), grammarPatternRestEllipsisQuote) {
		t.Fatal("pinned rest-pattern production changed; review the admission key")
	}
}

// Classify only a duplicated rest marker inside a recorded match pattern.
// Ordinary spread expressions, comments and strings are outside this key.
func grammarPatternRestEllipsis(source string, forms []parser.VibeSyntax) bool {
	has := func(at core.TextRange) bool {
		if at.Pos() < 0 || at.End() > len(source) || at.End() <= at.Pos() {
			return false
		}
		text := source[at.Pos():at.End()]
		scan := scanner.NewScanner()
		scan.SetText(text)
		previous := ast.KindUnknown
		for kind := scan.Scan(); kind != ast.KindEndOfFile; kind = scan.Scan() {
			// Shield a closed slash literal from this classification key.
			// An unclosed candidate leaves division tokens untouched; the
			// independent grammar oracle still decides all admission.
			if kind == ast.KindSlashToken || kind == ast.KindSlashEqualsToken {
				start := scan.TokenStart()
				candidate := scanner.NewScanner()
				candidate.SetText(text[start:])
				candidate.Scan()
				candidate.ReScanSlashToken()
				if candidate.TokenFlags()&ast.TokenFlagsUnterminated == 0 {
					text = text[start+candidate.TokenEnd():]
					scan.SetText(text)
					previous = ast.KindRegularExpressionLiteral
					continue
				}
			}
			if previous == ast.KindDotDotDotToken && kind == ast.KindDotDotDotToken {
				return true
			}
			previous = kind
		}
		return false
	}
	for _, form := range forms {
		switch form.Kind {
		case parser.VibeSyntaxIs:
			if has(form.Right) {
				return true
			}
		case parser.VibeSyntaxMatch:
			for _, arm := range form.Arms {
				if has(arm.Head) {
					return true
				}
			}
		}
	}
	return false
}

const grammarPatternRestEllipsisWitness = `for (var i = 0; xs is [let first, ... ...]; i++) {}`

func TestGrammarAdmissionPatternRestEllipsisKeys(t *testing.T) {
	for _, source := range []string{
		grammarPatternRestEllipsisWitness,
		"const b = xs is [... ...];",
		"const b = xs is [let first, ... /* rest */ ...];",
		"const b = xs is F(... ...);",
		"const b = xs is if (a / b) and [let first, ... ...];",
		"const b = match (xs) { when [... ...]: 1; default: 0; };",
	} {
		if got := grammarAdmissionForm(source); got != "admission:pattern-rest-ellipsis" {
			t.Errorf("key=%q, want admission:pattern-rest-ellipsis: %q", got, source)
		}
	}
	for _, source := range []string{
		"const b = xs is [...];",
		"const b = xs is [...let rest];",
		"const b = xs is [[...], ...];",
		"const b = xs is [... /* ... */ let rest];",
		"const b = match (xs) { when [let first, ...]: 1; default: 0; };",
		"const b = xs is ['... ...'];",
		"const b = xs is /... .../;",
		"const b = xs is /[... ...]/;",
		"const b = xs is [/... .../, let first];",
		"const b = [...xs, ...ys];",
		"const b = { is: '... ...' };",
	} {
		if got := grammarAdmissionForm(source); got == "admission:pattern-rest-ellipsis" {
			t.Errorf("control keyed as a duplicated rest marker: %q", source)
		}
	}
}

var grammarPatternRestEllipsisGaps = []string{
	grammarPatternRestEllipsisWitness,
	"for (var i = 0; xs is [let first, ... ...let rest]; i++) {}",
}

func TestGrammarAdmissionPatternRestEllipsisRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarPatternRestEllipsisGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range []string{
		"const b = xs is [let first, ... ...];",
		"for (var i = 0; xs is [... ...]; i++) {}",
		"for (let i = 0; xs is [let first, ... ...]; i++) {}",
		"for (var i = 0; xs is [let first, ...]; i++) {}",
		"for (var i = 0; xs is [let first, ...let rest]; i++) {}",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}
