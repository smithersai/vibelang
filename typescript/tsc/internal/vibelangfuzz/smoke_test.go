package vibelangfuzz

import (
	"slices"
	"strconv"
	"testing"
)

// TestHarness compiles and runs one program through the shared harness, and
// checks that every acceptance case and documentation snippet loads as a seed.
func TestHarness(t *testing.T) {
	w := NewWorkspace(t)
	r, err := w.Compile(t.Context(), Single(`error NotFound { id: string }
service Users { name(id: string): string!NotFound }
function nameOf(id: string) {
  if (id !== "42") throw new NotFound({ id })
  return Users.name(id)
}
export function main() {
  provide Layer.succeed(Users, { name(id) { return "Ada" } }) {
    return [nameOf("42"), nameOf("7") catch (e) => e._tag]
  }
}
export function fails() { return nameOf("7") }
`))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	for _, d := range r.Diagnostics {
		t.Errorf("diagnostic: %s", d.String())
	}
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(t, "%v", err)
	}
	defer node.Close()
	if got := node.Run(r, "out/main.js", "main"); got.Kind != "success" || string(got.Value) != `["Ada","NotFound"]` {
		t.Errorf("main: %+v", got)
	}
	// Chapter 3 and Chapter 17: throw is an expected failure, never a defect.
	if got := node.Run(r, "out/main.js", "fails"); got.Kind != "failure" || got.Tag != "NotFound" || !slices.Equal(got.Cause, []string{"fail:NotFound"}) {
		t.Errorf("fails: %+v", got)
	}
	if n := len(CaseSeeds()); n < 700 {
		t.Errorf("%d case seeds; the acceptance corpus has more than 700", n)
	}
	if n := len(SnippetSeeds()); n < 500 {
		t.Errorf("%d snippet seeds; the documents hold more than 500 vibe blocks", n)
	}
	rows, _ := appendixBRows(currentSpecText(grammarAppendix))
	if len(rows) == 0 {
		t.Fatal("current Appendix B has no diagnostic rows")
	}
	for name := range rows {
		code, err := strconv.Atoi(name)
		if err != nil {
			t.Fatal(err)
		}
		if !SpecHasCode(int32(code)) {
			t.Errorf("Appendix B code EK%s missing from the registry", name)
		}
	}

	files := map[string]string{"main.vibe": "x\n", "a/b.ts": "y\n"}
	if got := Unarchive(Archive(files)); len(got) != 2 || got["a/b.ts"] != "y\n" {
		t.Errorf("archive round trip: %v", got)
	}
	if got := Unarchive("-- ../x --\nz\n-- node_modules/effect/index.d.ts --\n"); len(got) != 0 {
		t.Errorf("unsafe names survived: %v", got)
	}
}

// TestDecodedUTF16Len holds DecodedUTF16Len to the lengths Node's
// TextDecoder gives the same bytes.
func TestDecodedUTF16Len(t *testing.T) {
	for _, test := range []struct {
		text string
		want int
	}{
		{"0\xe4\x91", 2},        // a truncated three-byte sequence is one U+FFFD
		{"\xed\xa0\x80", 3},     // a surrogate's lead byte starts no maximal subpart
		{"\xf0\x9f\x98\x80", 2}, // a valid emoji is a surrogate pair
		{"\xf0\x9f\x98", 1},     // a truncated emoji
		{"\xc0\x80", 2},         // an overlong lead byte
		{"a\xffb\xe0\x80", 5},   // 0xe0 continues only with a0-bf
		{"\xef\xbf\xbd\x80", 2}, // an encoded U+FFFD, then a stray continuation
	} {
		if got := DecodedUTF16Len(test.text); got != test.want {
			t.Errorf("DecodedUTF16Len(%q) = %d, want %d", test.text, got, test.want)
		}
	}
}
