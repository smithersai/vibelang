package vibelangmapper

import (
	"fmt"
	"strings"
	"testing"
)

// An is whose pattern binds names is a holder that spans its subject and
// pattern. When the subject is written in parentheses, `(x as T) is [let a]`,
// the holder starts with the subject's own parenthesis, and the projection
// took it for a source parenthesized expression: it walked the parser's tests
// as source text, and the overlapping edits passed the whole file through
// unchanged (TestCorpusPlans, case is-nested-binding-temps, whose subject is
// `([3, cause.reasons] as const)`). Parentheses around a subject change
// nothing about the is: each projection of `(x) is P` is the projection of
// `x is P` with the subject's read in parentheses.

var parenthesizedIsSubjects = []string{"r", "r.inner", "g(r)", "[3, r]", "r[0]"}

var parenthesizedIsPatterns = []string{
	"[let a]",
	"{ inner: let a }",
	"[let a, [{ k: let b }]]",
	"Foo(let a)",
	"{ k: 1, v: let a }",
}

var parenthesizedIsHomes = []string{
	"export const f = (r: any) => {\n  if (%s) return 0\n  return 1\n}\n",
	"export const f = (r: any) => {\n  while (%s) r = 0\n  return 1\n}\n",
	"export const f = (r: any) => {\n  if (r !== null && %s) return 0\n  return 1\n}\n",
	"export effect function main(r: any) {\n  if (%s) return 0\n  return 1\n}\n",
}

func FuzzParenthesizedIsSubject(f *testing.F) {
	for s := range parenthesizedIsSubjects {
		for p := range parenthesizedIsPatterns {
			for h := range parenthesizedIsHomes {
				for depth := 1; depth <= 2; depth++ {
					f.Add(uint8(s), uint8(p), uint8(h), uint8(depth))
				}
			}
		}
	}
	f.Fuzz(func(t *testing.T, s, p, h, depth uint8) {
		subject := parenthesizedIsSubjects[int(s)%len(parenthesizedIsSubjects)]
		pattern := parenthesizedIsPatterns[int(p)%len(parenthesizedIsPatterns)]
		home := parenthesizedIsHomes[int(h)%len(parenthesizedIsHomes)]
		n := 1 + int(depth)%2
		wrapped := strings.Repeat("(", n) + subject + strings.Repeat(")", n)
		plain := fmt.Sprintf(home, subject+" is "+pattern)
		parens := fmt.Sprintf(home, wrapped+" is "+pattern)
		for name, project := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
			want := project(plain, testContext)
			got := project(parens, testContext)
			for _, projection := range []Projection{want, got} {
				for _, d := range projection.Diagnostics {
					if strings.Contains(d.Message, "overlapping edits") {
						t.Fatalf("%s: %q: %s", name, parens, d.Message)
					}
				}
			}
			// Where the plain projection reads the subject into the is's temp,
			// the parenthesized one reads the same subject in parentheses.
			// Elsewhere (a while's inline tests, a subject that runs) the two
			// differ only in parentheses.
			if read := "$is1 = " + subject; strings.Contains(want.Text, read) {
				if expected := strings.Replace(want.Text, read, "$is1 = "+wrapped, 1); got.Text != expected {
					t.Fatalf("%s: %q projects differently from %q:\n got: %s\nwant: %s", name, parens, plain, got.Text, expected)
				}
			} else if withoutParens(got.Text) != withoutParens(want.Text) {
				t.Fatalf("%s: %q projects differently from %q beyond parentheses:\n got: %s\nwant: %s", name, parens, plain, got.Text, want.Text)
			}
		}
	})
}

func withoutParens(text string) string {
	return strings.NewReplacer("(", "", ")", "").Replace(text)
}

// TestParenthesizedIsSubjectCast covers subjects that need their
// parentheses, a cast and a const assertion, which have no unparenthesized
// twin: each projects without overlapping edits.
func TestParenthesizedIsSubjectCast(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"export const f = (r: unknown) => {\n  if ((r as any) is [let e]) return e\n  return 0\n}\n",
		"export const f = (r: unknown) => {\n  if (([3, r] as const) is [let n, [{ a: let e }]]) return [n, e]\n  return 0\n}\n",
		"export const f = (r: unknown) => {\n  while ((r as any) is { next: let r2 }) r = r2\n  return 0\n}\n",
	} {
		p := lower(source, testContext)
		if _, _, overlap, ok := p.plan.render(checking{names: p.names}, source, func() string { return "" }); !ok {
			t.Errorf("%q: overlapping edits at %d", source, overlap)
		}
	}
}
