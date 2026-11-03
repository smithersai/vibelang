package vibelang

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// applyHunks rebuilds b from a and the hunks of a to b.
func applyHunks(a, b string, hunks []textHunk) string {
	var out strings.Builder
	at := 0
	for _, h := range hunks {
		out.WriteString(a[at:h.aStart])
		out.WriteString(b[h.bStart:h.bEnd])
		at = h.aEnd
	}
	out.WriteString(a[at:])
	return out.String()
}

func TestTextHunksMapSites(t *testing.T) {
	a := "one\nreturn n + 1\nthree\nfour\n"
	site := RefusedSite{Start: strings.Index(a, "n + 1"), End: strings.Index(a, "n + 1") + 5}
	for _, test := range []struct {
		name, b string
		holds   bool
	}{
		{"edit before", "uno dos\nreturn n + 1\nthree\nfour\n", true},
		{"edit after", "one\nreturn n + 1\nthree\nfive\n", true},
		{"lines added around", "zero\none\nreturn n + 1\nthree\nthree and a half\nfour\n", true},
		{"same line, before the site", "one\nyield n + 1\nthree\nfour\n", true},
		// The bytes stand, so the byte rule holds; the fixer refuses such an
		// edit itself (TestFixSitesGuard).
		{"rewritten around it", "one\n{ n + 1; return }\nthree\nfour\n", true},
		{"edits on both sides", "one\nyield n + 1;\nthree\nfour\n", true},
		{"inside", "one\nreturn n - 1\nthree\nfour\n", false},
		{"deleted", "one\nthree\nfour\n", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			hunks := textHunks(a, test.b)
			if got := applyHunks(a, test.b, hunks); got != test.b {
				t.Fatalf("hunks rebuild %q", got)
			}
			if got := SiteHolds(a, test.b, site); got != test.holds {
				t.Fatalf("SiteHolds = %v; hunks %v", got, hunks)
			}
		})
	}
}

// A site declined in a text an earlier round changed is reported in the
// file before the run.
func TestFixSitesReportInOriginal(t *testing.T) {
	original := "import { x } from \"y\"\nfunction* g() {\n  return 1 + 1\n}\n"
	current := "function* g() {\n  return 1 + 1\n}\n"
	name := tspath.RootedFilePath("/p/main.vibe")
	sites := newFixSites(func(tspath.RootedFilePath) string { return original })
	at := strings.Index(current, "1 + 1")
	sites.add(name, current, at, at+5, "EK2128", "r")
	sites.add(name, current, at, at+5, "EK2128", "r") // a later round declines it again
	all := sites.all()
	if len(all) != 1 {
		t.Fatalf("sites %+v", all)
	}
	site := all[0]
	if original[site.Start:site.End] != "1 + 1" || site.StartLine != 3 || site.StartColumn != 10 || site.EndColumn != 15 || site.New {
		t.Fatalf("site %+v", site)
	}
	var out bytes.Buffer
	reportSites(&out, all, nil, func(n tspath.RootedFilePath) string { return filepath.Base(n.AsString()) })
	want := fmt.Sprintf("vibelang --fix: refused site: main.vibe:3:10-3:15 [%d,%d) EK2128: r\n", site.Start, site.End)
	if out.String() != want {
		t.Fatalf("report %q; want %q", out.String(), want)
	}
}

// A fix whose edits touch a refused site is refused; a fix of the site's own
// diagnostic repairs it.
func TestFixSitesGuard(t *testing.T) {
	text := "aaaa bbbbb cccc dddd\n"
	name := tspath.RootedFilePath("/p/main.vibe")
	sites := newFixSites(func(tspath.RootedFilePath) string { return text })
	sites.add(name, text, 5, 10, fixCodeName(EK2128.Code), "r")
	over := fileFix{code: EK1002.Code, edits: []sourceEdit{{3, 12, "x"}}, key: "over"}
	inside := fileFix{code: EK1002.Code, edits: []sourceEdit{{7, 7, "x"}}, key: "inside"}
	before := fileFix{code: EK1002.Code, edits: []sourceEdit{{0, 4, "x"}}, key: "before"}
	adjacent := fileFix{code: EK1002.Code, edits: []sourceEdit{{10, 10, "x"}}, key: "adjacent"}
	kept, blocked, by := sites.guard(name, text, []fileFix{over, inside, before, adjacent})
	if len(kept) != 2 || kept[0].key != "before" || kept[1].key != "adjacent" || len(blocked) != 2 || by[0].Code != "EK2128" {
		t.Fatalf("kept %v blocked %v", kept, blocked)
	}
	own := fileFix{code: EK2128.Code, edits: []sourceEdit{{0, 12, "x"}}, key: "own", siteStart: 5, siteEnd: 10, sited: true}
	if kept, _, _ := sites.guard(name, text, []fileFix{own}); len(kept) != 1 || len(sites.all()) != 0 {
		t.Fatalf("own fix: kept %v, sites %v", kept, sites.all())
	}
}

// The end check: a rewrite that changes a refused site anyway is caught.
func TestFixSitesCheck(t *testing.T) {
	text := "keep this; return n + 1\n"
	name := tspath.RootedFilePath("/p/main.vibe")
	sites := newFixSites(func(tspath.RootedFilePath) string { return text })
	at := strings.Index(text, "n + 1")
	sites.add(name, text, at, at+5, "EK2128", "r")
	if changed := sites.check(name, "kept this; return n + 1\n"); len(changed) != 0 {
		t.Fatalf("an edit before the site: %v", changed)
	}
	if changed := sites.check(name, "keep this; return n - 1\n"); len(changed) != 1 {
		t.Fatalf("a rewrite of the site: %v", changed)
	}
}

// End to end: the producer's EK2128 fix moves the plain generator's EK2128,
// which --fix declines; the site is reported where it stood, and its bytes
// hold.
func TestFixReportsDeclinedPlainGeneratorReturn(t *testing.T) {
	source := `export effect function* p(n: number) {
  yield n
  return n + 1
}
export function* g(n: number) {
  yield n
  return n + 1
}
`
	_, file, _, _ := editorProgramWith(t, source, map[string]string{})
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text == source {
		t.Fatalf("no fix applied; the test needs one before the site")
	}
	var site *RefusedSite
	for i := range result.Sites {
		if result.Sites[i].Code == "EK2128" {
			site = &result.Sites[i]
		}
	}
	at := strings.LastIndex(source, "n + 1")
	if site == nil || site.Start != at || site.End != at+5 || !strings.HasPrefix(site.Reason, "no fix applies: A JavaScript caller") {
		t.Fatalf("site %+v, want [%d,%d); sites %+v", site, at, at+5, result.Sites)
	}
	if !SiteHolds(source, fixed.Text, *site) || len(result.Changed) != 0 {
		t.Fatalf("site changed:\n%s", fixed.Text)
	}
	var out bytes.Buffer
	result.Report(&out, func(n tspath.RootedFilePath) string { return filepath.Base(n.AsString()) })
	if want := fmt.Sprintf("vibelang --fix: refused site: main.vibe:7:10-7:15 [%d,%d) EK2128: no fix applies: ", at, at+5); !strings.Contains(out.String(), want) {
		t.Fatalf("report:\n%s\nwant a line starting %q", out.String(), want)
	}
}

// A file whose only diagnostic --fix declines still reports its site.
func TestFixReportsDeclinedWithoutFixes(t *testing.T) {
	source := "export function* g(n: number) {\n  yield n\n  return n + 1\n}\n"
	_, file, _, _ := editorProgramWith(t, source, map[string]string{})
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	at := strings.Index(source, "n + 1")
	if len(result.Sites) != 1 || result.Sites[0].Code != "EK2128" || result.Sites[0].Start != at || result.Files[file.FileName()] != nil {
		t.Fatalf("sites %+v, files %v", result.Sites, result.Files)
	}
}

// Property: any two edits that do not touch a site leave its bytes, and the
// hunks always rebuild the edited text.
func FuzzTextHunks(f *testing.F) {
	f.Add("one\nreturn n + 1\nthree\n", uint16(0), uint8(3), "uno", uint16(19), uint8(5), "", uint16(11), uint8(5))
	f.Add("000000", uint16(2), uint8(2), "1", uint16(6), uint8(0), "1", uint16(4), uint8(1))                 // two edits flank the site on one line
	f.Add("0000000000010000000000", uint16(0), uint8(3), "", uint16(20), uint8(2), "", uint16(11), uint8(5)) // the diff draws the change across the site
	f.Add("0\n0\n0\n00", uint16(0), uint8(2), "1", uint16(8), uint8(0), "0", uint16(3), uint8(1))
	f.Add("a\nb\nc\nd\n", uint16(2), uint8(2), "x\ny\n", uint16(6), uint8(0), "z", uint16(4), uint8(1))
	f.Fuzz(func(t *testing.T, a string, p1 uint16, l1 uint8, t1 string, p2 uint16, l2 uint8, t2 string, sp uint16, sl uint8) {
		if len(a) == 0 || len(a) > 4000 {
			return
		}
		e1s := int(p1) % (len(a) + 1)
		e1e := min(len(a), e1s+int(l1)%16)
		e2s := int(p2) % (len(a) + 1)
		e2e := min(len(a), e2s+int(l2)%16)
		if e2s < e1e && e1s < e2e || e1s == e2s {
			return
		}
		edits := []sourceEdit{{e1s, e1e, t1}, {e2s, e2e, t2}}
		if e2s < e1s {
			edits[0], edits[1] = edits[1], edits[0]
		}
		b := applyEdits(a, edits)
		hunks := textHunks(a, b)
		if got := applyHunks(a, b, hunks); got != b {
			t.Fatalf("hunks %v rebuild %q, want %q", hunks, got, b)
		}
		s := int(sp) % (len(a) + 1)
		site := RefusedSite{Start: s, End: min(len(a), s+int(sl)%32)}
		for _, e := range edits {
			if spanTouches(e.start, e.end, site.Start, site.End) || e.start == site.Start || e.start == site.End {
				return // an edit at a boundary may diff as one inside
			}
		}
		if !SiteHolds(a, b, site) {
			t.Fatalf("site [%d,%d) of %q lost under %v: %q", site.Start, site.End, a, edits, b)
		}
	})
}

// A rewrite after the rounds drops an edit that touches a refused site, or a
// diagnostic --fix declines, and keeps the file's other edits: overlapping,
// nested either way, and adjacent edits (Smithers apps/mvp, 2026-11-03: the
// module export rewrite of a declined site stopped the run with exit 3).
func TestFixSitesTouched(t *testing.T) {
	text := "aaaa bbbbb cccc dddd\n"
	name := tspath.RootedFilePath("/p/main.vibe")
	sites := newFixSites(func(tspath.RootedFilePath) string { return text })
	sites.add(name, text, 5, 10, "EK2128", "r")                         // bbbbb
	declined := []declinedSite{{start: 16, end: 20, code: EK2128.Code}} // dddd
	for _, test := range []struct {
		name       string
		start, end int
		want       string
	}{
		{"overlaps the start", 3, 7, "EK2128 at 1:6"},
		{"overlaps the end", 8, 12, "EK2128 at 1:6"},
		{"inside the site", 6, 8, "EK2128 at 1:6"},
		{"around the site", 0, 12, "EK2128 at 1:6"},
		{"insertion inside", 7, 7, "EK2128 at 1:6"},
		{"adjacent before", 0, 5, ""},
		{"adjacent after", 10, 11, ""},
		{"insertion at the end", 10, 10, ""},
		{"inside a declined diagnostic", 17, 18, "EK2128 at 1:17"},
		{"adjacent to a declined diagnostic", 11, 16, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := sites.touched(name, text, test.start, test.end, declined); got != test.want {
				t.Fatalf("touched [%d,%d) = %q; want %q", test.start, test.end, got, test.want)
			}
		})
	}
}

// preludeFixCase runs --fix on source as main.vibe in a project that emits
// nothing, as TestFixPreludeRewrites does: a project that emits declarations
// keeps an import its declaration file would need (D501).
func preludeFixCase(t *testing.T, source string) (*FixResult, tspath.RootedFilePath) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return fixCase(t, dir), file.FileName()
}

// End to end: the prelude's module export rewrite would shorten
// Option.Option inside a plain generator's return, a site --fix declines.
// That edit goes and is reported, and the one outside the site stays. Before,
// the edit inside changed the diagnostic, so the gate refused the file's
// whole rewrite and no export was shortened.
func TestFixPreludeKeepsRefusedSite(t *testing.T) {
	source := `import { Option } from "effect"

function* g(x: unknown) {
  yield 1
  return x as Option.Option<number>
}
const first = (value: Option.Option<number>): number => Option.getOrElse(value, () => 0)
`
	result, name := preludeFixCase(t, source)
	if len(result.Changed) != 0 {
		t.Fatalf("a rewrite changed a refused site: %+v", result.Changed)
	}
	fixed := result.Files[name]
	if fixed == nil {
		t.Fatalf("no rewrite kept; sites %+v", result.Sites)
	}
	want := strings.Replace(strings.TrimPrefix(source, "import { Option } from \"effect\"\n"), "(value: Option.Option<number>)", "(value: Option<number>)", 1)
	if fixed.Text != want || fixed.Rewrites[preludeKeyLabel] != 1 {
		t.Fatalf("wrote %q\nwant %q\nrewrites %v", fixed.Text, want, fixed.Rewrites)
	}
	at := strings.Index(source, "x as Option.Option<number>")
	var declined, dropped bool
	for _, site := range result.Sites {
		if site.Code == "EK2128" && site.Start == at && site.End == at+len("x as Option.Option<number>") {
			declined = true
		}
		if site.Code == preludeKeyLabel && strings.HasPrefix(site.Reason, "its rewrite would edit the refused site EK2128 at 5:10") {
			dropped = true
		}
	}
	if !declined || !dropped {
		t.Fatalf("sites %+v: want the EK2128 site at [%d,...) and the dropped rewrite", result.Sites, at)
	}
}

// Property: whatever mix of qualified module exports sits inside a declined
// site and outside it, --fix changes no refused site (no exit 3), every
// declined site keeps its bytes, and only the exports outside are shortened.
func FuzzFixPreludeRefusedSite(f *testing.F) {
	f.Add(uint8(1), uint8(1))
	f.Add(uint8(2), uint8(0))
	f.Add(uint8(0), uint8(2))
	f.Fuzz(func(t *testing.T, inside, outside uint8) {
		inside, outside = inside%3, outside%3
		var b strings.Builder
		b.WriteString("import { Option } from \"effect\"\n\nfunction* g(x: unknown) {\n  yield 1\n  return [")
		for i := range inside {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString("x as Option.Option<number>")
		}
		b.WriteString("]\n}\n")
		for i := range outside {
			fmt.Fprintf(&b, "const f%d = (v: Option.Option<number>): number => Option.getOrElse(v, () => %d)\n", i, i)
		}
		source := b.String()
		result, name := preludeFixCase(t, source)
		if len(result.Changed) != 0 {
			t.Fatalf("a rewrite changed a refused site: %+v\n%s", result.Changed, source)
		}
		text := source
		if fixed := result.Files[name]; fixed != nil {
			text = fixed.Text
		}
		for _, site := range result.Sites {
			if site.Code == "EK2128" && !SiteHolds(source, text, site) {
				t.Fatalf("site %+v changed:\n%s", site, text)
			}
		}
		if got := strings.Count(text, "Option.Option"); got != int(inside) {
			t.Fatalf("%d Option.Option left, want the %d inside the site:\n%s", got, inside, text)
		}
	})
}

// The Smithers apps/mvp shape (2026-11-03, creationSteps.vibe): a round
// refuses a fix and records its site; the prelude rewrite after the rounds
// then has an edit inside that site. The edit goes, reported as a site of
// its own; an edit outside or adjacent stays; an import removal that would
// touch the site takes the file's whole prelude rewrite.
func TestKeepPreludeEditsRefusedSite(t *testing.T) {
	source := "export const a = 1\nexport const b = 2\n"
	program, file, _, _ := editorProgram(t, source)
	name := file.FileName()
	sites := newFixSites(func(tspath.RootedFilePath) string { return source })
	at := strings.Index(source, "1")
	sites.add(name, source, at, at+1, "EK4835", "the fixed program would report TS2554")
	g := &fixGate{ctx: t.Context(), refused: map[string]bool{}, sites: sites}
	inside := sourceEdit{at, at + 1, "10"}
	outside := sourceEdit{strings.Index(source, "2"), strings.Index(source, "2") + 1, "20"}
	adjacent := sourceEdit{at + 1, at + 1, " as number"}
	got := g.keepPreludeEdits(program, file, preludeRewrite{edits: []sourceEdit{inside, outside, adjacent}, keys: 3})
	if !slices.Equal(got.edits, []sourceEdit{outside, adjacent}) || got.keys != 2 {
		t.Fatalf("kept %+v", got)
	}
	var dropped *RefusedSite
	for _, s := range sites.all() {
		if s.Code == preludeKeyLabel {
			dropped = &s
		}
	}
	if dropped == nil || dropped.Start != at || dropped.Reason != "its rewrite would edit the refused site EK4835 at 1:18" {
		t.Fatalf("sites %+v", sites.all())
	}
	// The note guards nothing: the refused site's own fix stays free to retry.
	own := fileFix{code: EK4835.Code, edits: []sourceEdit{inside}, key: "own", siteStart: at, siteEnd: at + 1, sited: true}
	if kept, blocked, _ := sites.guard(name, source, []fileFix{own}); len(kept) != 1 || len(blocked) != 0 {
		t.Fatalf("the dropped edit's note blocked the site's own fix: kept %v, blocked %v", kept, blocked)
	}
	sites.add(name, source, at, at+1, "EK4835", "the fixed program would report TS2554")
	whole := g.keepPreludeEdits(program, file, preludeRewrite{edits: []sourceEdit{{at - 2, at + 1, ""}, outside}, imports: 1, keys: 1, importEdits: 1})
	if len(whole.edits) != 0 {
		t.Fatalf("an import removal over a site kept %+v", whole)
	}
}
