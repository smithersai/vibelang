package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 7 refuses only an unparsable file and keeps ordinary strings and
// data; VIP-39 makes JSX text JSX's alone. A host that writes a space in JSX
// text as a {" "} child, or folds one into text, must leave the written text.
var formatJSXTextSpacesQuotes = []struct{ file, quote string }{
	{"007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent."},
	{"007-tooling.md", "This source-text boundary never permits changes to ordinary strings/data"},
}

// Each form lists its JSX text slots as written: the text between an
// element's other children, with any {" "} space in it. Formatting must
// leave every slot verbatim; the children between them may change layout.
var formatJSXTextSpacesForms = []struct {
	key, body string
	slots     []string
}{
	{"t3code-detached-head", "<span >\n          Detached HEAD: create and check out a branch to enable push and{\" \"}\n          {null} actions.\n        </span>",
		[]string{"\n          Detached HEAD: create and check out a branch to enable push and{\" \"}\n          ", " actions.\n        "}},
	{"before-element", "<p>\n  Read the{\" \"}\n  <a href=\"x\">docs</a> first.\n</p>", []string{"\n  Read the{\" \"}\n  ", " first.\n", "docs"}},
	{"after-element", "<p>\n  <b>Bold</b>{\" \"}\n  text follows\n</p>", []string{"{\" \"}\n  text follows\n", "Bold"}},
	{"two-spaces", "<p>\n  a{\" \"}\n  {x}{\" \"}\n  b\n</p>", []string{"\n  a{\" \"}\n  ", "{\" \"}\n  b\n"}},
	{"fragment", "<>\n  one{\" \"}\n  {x} three\n</>", []string{"\n  one{\" \"}\n  ", " three\n"}},
	{"nested", "<div>\n  <span>\n    inner{\" \"}\n    {x}\n  </span>{\" \"}\n  after\n</div>", []string{"\n    inner{\" \"}\n    ", "{\" \"}\n  after\n"}},
	{"mid-line", "<p>left {\" \"} right {x}</p>", []string{"left {\" \"} right "}},
	{"entity", "<p>\n  a&nbsp;b{\" \"}\n  {x}\n</p>", []string{"\n  a&nbsp;b{\" \"}\n  "}},
	{"one-line", "<p>Hello {x} and <b>you</b>.</p>", []string{"Hello ", " and ", "you"}},
	{"long-line", "<p>A sentence long enough that a host formatter wraps it at the print width, around {x} and the words that follow it here.</p>",
		[]string{"A sentence long enough that a host formatter wraps it at the print width, around ", " and the words that follow it here."}},
}

func TestFormatJSXTextSpacesQuoted(t *testing.T) {
	for _, q := range formatJSXTextSpacesQuotes {
		if !strings.Contains(SpecText(q.file), q.quote) {
			t.Fatalf("%s no longer says %q", q.file, q.quote)
		}
	}
}

// TestFormatJSXTextSpacesCorpus checks that every saved input names a form.
func TestFormatJSXTextSpacesCorpus(t *testing.T) {
	known := map[string]bool{}
	for _, form := range formatJSXTextSpacesForms {
		known[form.key] = true
	}
	names, err := filepath.Glob(filepath.Join(repoTestdata(), "fuzz", "FuzzFormatJSXTextSpaces", "*"))
	if err != nil || len(names) == 0 {
		t.Fatalf("no saved inputs: %v", err)
	}
	for _, name := range names {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		quoted, _ := strings.CutPrefix(lines[len(lines)-1], "[]byte(")
		input, err := strconv.Unquote(strings.TrimSuffix(quoted, ")"))
		parts := strings.Split(input, ":")
		if err != nil || len(parts) != 3 || parts[0] != "jsx-text" || !known[parts[1]] {
			t.Fatalf("%s does not name a known form", filepath.Base(name))
		}
	}
}

func formatJSXTextSpacesSource(body string, mode int) string {
	source := "declare const x: string\nexport const View = () => (" + body + ")\n"
	if mode&1 != 0 {
		source = "declare const x: string\nexport function View() {\n  return (\n" + body + "\n  )\n}\n"
	}
	if mode&2 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source
}

func FuzzFormatJSXTextSpaces(f *testing.F) {
	startShortBudget(f)
	if testing.Short() && !toolsFuzzing() {
		for _, key := range []string{"jsx-text:before-element:1", "jsx-text:nested:2", "jsx-text:one-line:0"} {
			f.Add([]byte(key))
		}
	} else {
		for _, form := range formatJSXTextSpacesForms {
			for mode := range 4 {
				f.Add([]byte("jsx-text:" + form.key + ":" + strconv.Itoa(mode)))
			}
		}
	}
	formatter := toolsFormatter(f)
	// Keys name the host formatter, so a gap one of them has never hides the other.
	host := "language-server"
	if os.Getenv("VIBELANG_DPRINT") != "" {
		host = "dprint"
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestFormatJSXTextSpacesQuoted(t)
		form, mode := formatJSXTextSpacesForms[0], 0
		if parts := strings.Split(string(data), ":"); len(parts) == 3 && parts[0] == "jsx-text" {
			found := false
			for _, known := range formatJSXTextSpacesForms {
				if parts[1] == known.key {
					form, found = known, true
				}
			}
			if !found {
				t.Skip("unknown form key")
			}
			if value, err := strconv.ParseUint(parts[2], 10, 8); err == nil {
				mode = int(value) % 4
			}
		} else if len(data) > 0 {
			form = formatJSXTextSpacesForms[int(data[0])%len(formatJSXTextSpacesForms)]
			if len(data) > 1 {
				mode = int(data[1]) % 4
			}
		}
		source := formatJSXTextSpacesSource(form.body, mode)
		if syntax := toolsSyntaxError("main.vibex", source); syntax != "" {
			t.Fatalf("invalid model input: %s\n%s", syntax, source)
		}
		once, err := vibelangfmt.Format("main.vibex", source, formatter)
		if err != nil {
			Gap(t, "FuzzFormatJSXTextSpaces", "refused:"+host+":"+form.key, "Chapter 7: %q; a parsable .vibex file was refused: %v\n%s", formatJSXTextSpacesQuotes[0].quote, err, source)
		}
		for _, slot := range form.slots {
			if mode&2 != 0 {
				slot = strings.ReplaceAll(slot, "\n", "\r\n")
			}
			if !strings.Contains(once, slot) {
				Gap(t, "FuzzFormatJSXTextSpaces", "text:"+host+":"+form.key, "Chapter 7: %q; VIP-39 JSX text changed: want %q in\n%s", formatJSXTextSpacesQuotes[1].quote, slot, once)
			}
		}
		twice, err := vibelangfmt.Format("main.vibex", once, formatter)
		if err != nil || once != twice {
			Gap(t, "FuzzFormatJSXTextSpaces", "fixed-point:"+host+":"+form.key, "Chapter 7 formatting is idempotent: %v\n%s\nthen:\n%s", err, once, twice)
		}
		for _, kind := range []string{"refused", "text", "fixed-point"} {
			ExpectPending(t, "FuzzFormatJSXTextSpaces", kind+":"+host+":"+form.key)
		}
	})
}
