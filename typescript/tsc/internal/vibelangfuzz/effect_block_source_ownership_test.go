package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
	"path/filepath"
	"strings"
	"testing"
)

const effectBlockBoundaryQuote = "the body of an `effect` block or function is evaluated on each run."

func TestEffectBlockSourceOwnershipQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", effectBlockBoundaryQuote)
	chapterSays(t, "001-functions.md", "a plain arrow written inside an `effect` function is a plain function")
}
func FuzzEffectBlockSourceOwnership(f *testing.F) {
	startShortBudget(f)
	for shape := range uint8(6) {
		f.Add(shape, false, false)
		f.Add(shape, true, false)
		f.Add(shape, false, true)
		f.Add(shape, true, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape uint8, plain, crlf bool) {
		TestEffectBlockSourceOwnershipQuoted(t)
		shape %= 6
		expression := "work() catch () => 0"
		body := "return " + expression
		if plain {
			body = "const plain = () => " + expression + "; return 0"
		}
		block := "effect { " + body + " }"
		source := "declare function work(): number!!;\nexport const value = " + block + "\n"
		switch shape {
		case 1:
			source = "declare function work(): number!!;\nexport effect function build() {return try " + block + "}\n"
		case 2:
			source = "declare function work(): number!!;\nexport const value = effect { const inner = " + block + "; return try inner }\n"
		case 3:
			source = "declare function work(): number!!;\nexport effect function build() { return (" + block + ") catch () => 0 }\n"
		case 4:
			source = "declare function work(): number!!;\nexport effect function build() {\n  const before = 1\n  try " + block + "\n  return before\n}\n"
		case 5:
			source = "declare function work(): number!!;\nexport effect function build() {\n  if (Math.random() > 2) try " + block + "\n  return 2\n}\n"
		}
		if crlf {
			source = "// café 😀\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		r := toolsCompile(t, w, "FuzzEffectBlockSourceOwnership", map[string]string{"main.vibe": source})
		defer r.Remove()
		want := 0
		if plain {
			want = 1
		}
		count := 0
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 504 {
				count++
			}
		}
		if count != want || !plain && HasError(r.Diagnostics) {
			Gap(t, "FuzzEffectBlockSourceOwnership", fmt.Sprintf("%d:%t:%t", shape, plain, crlf), "native boundary: want %d EK0504, got %v", want, r.Diagnostics)
			return
		}
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{FileName: filepath.Join(r.Dir, "main.vibe"), ModuleKey: "block-ownership/main"})
		count = 0
		for _, d := range p.Diagnostics {
			if d.Code == 504 {
				count++
			}
		}
		if count != want || !plain && len(p.Diagnostics) != 0 {
			Gap(t, "FuzzEffectBlockSourceOwnership", fmt.Sprintf("%d:%t:%t", shape, plain, crlf), "mapped boundary: want %d EK0504, got %v\n%s", want, p.Diagnostics, source)
		}
	})
}
