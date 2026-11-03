package vibelang

import (
	"bytes"
	"fmt"
	"path/filepath"
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
