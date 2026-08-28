package compiler

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Module row qualifier INJECTIVITY on the Go fork, and the shared vectors that
// keep the fork's copy of the algorithm and the reference frontend's from
// drifting apart.
//
// The qualifier exists for one job. When two modules in a project declare an
// Error or Context class with the same name, the bare name is no longer an
// identity, so buildRowNames renames every colliding declaration to
// `Name@module/path`. A disambiguator that itself re-collides has not done that
// job, and the shipped one did — MEASURED on the fork, by compiling and reading
// the failure row back out of SMITHERS1101:
//
//	files "a b.sm" and "a_b.sm", each declaring Boom
//	  -> "explicit return type cannot represent recoverable failures {Boom@a_b}"
//	     in BOTH files
//	  no diagnostic anywhere says the two are one
//
// So the fork reproduced it independently; this was not inferred from reading
// buildRowNames.
//
// The second half was a live CROSS-BACKEND DISAGREEMENT rather than a shared
// blind spot. The fork walked runes (`for _, character := range qualifier`) and
// wrote one '_' per rune; the reference walked UTF-16 code units (a non-`u`
// regex class) and wrote one '_' per unit. For an astral character in a module
// path the two backends therefore minted different row names for the same
// program: `x😀.sm` gave `x_` here and `x__` there. No conformance case could
// see it — the corpus contains no module path outside [A-Za-z0-9._/-] and no
// class name declared in two modules, so buildRowNames never qualifies anything
// there, and the runner compares diagnostic codes and positions rather than
// message text in any event.
//
// Both halves are fixed by the same reversible `+%04X` escape stableErrorIdentity
// already uses, encoded through utf16 so the two backends count the same units.

// rowQualifierVector is one row of conformance/identity/module-row-qualifier.json.
type rowQualifierVector struct {
	Why       string `json:"why"`
	Module    string `json:"module"`
	ViaFork   bool   `json:"viaFork"`
	Qualifier string `json:"qualifier"`
}

func loadRowQualifierVectors(t *testing.T) []rowQualifierVector {
	t.Helper()
	text, err := os.ReadFile("../conformance/identity/module-row-qualifier.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Vectors []rowQualifierVector `json:"vectors"`
	}
	if err := json.Unmarshal(text, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Vectors) == 0 {
		t.Fatal("the shared row qualifier corpus is empty")
	}
	return corpus.Vectors
}

// rowQualifierSource declares a Boom and a function whose EXPLICIT return type
// cannot carry it, which is what makes the row name observable: SMITHERS1101's
// message is built from formatRowSet(fn.bodyFailures).
func rowQualifierSource(function string) string {
	return "export class Boom extends Error {\n" +
		"  constructor(readonly value: number) { super(\"bad\") }\n" +
		"}\n" +
		"export function " + function + "(value: number): number {\n" +
		"  if (value < 0) throw new Boom(value)\n" +
		"  return value\n" +
		"}\n"
}

// boomRowIn returns the qualified Boom row the fork published for one file.
func boomRowIn(t *testing.T, result CompileResult, file string) string {
	t.Helper()
	for _, item := range result.Diagnostics {
		if item.Code != "SMITHERS1101" || item.File != file {
			continue
		}
		open := strings.Index(item.Message, "{")
		closed := strings.LastIndex(item.Message, "}")
		if open < 0 || closed < open {
			t.Fatalf("SMITHERS1101 in %q carries no failure row: %q", file, item.Message)
		}
		return item.Message[open+1 : closed]
	}
	t.Fatalf("no SMITHERS1101 for %q in %#v", file, result.Diagnostics)
	return ""
}

// ---------------------------------------------------------------------------
// The shared cross-language vectors, through the fork
// ---------------------------------------------------------------------------

// The fork mints exactly the qualifiers the reference does, measured by
// compiling each vector's file name in a project where its Boom collides with a
// second module's and reading the row name back out of the diagnostic.
//
// This is the one test that stops the two implementations drifting. It is not a
// re-derivation of the algorithm in Go test code — that would be a THIRD copy —
// it is the fork's own output compared against a corpus the reference is checked
// against by poc/src/language/module-row-qualifier.test.ts.
//
// Every vector is compiled against ONE fixed partner module, because the
// qualifier is only minted when a name collides. The partner is `zz-partner.sm`,
// whose own qualifier is pinned by the same assertion.
func TestPinnedForkModuleRowQualifierMatchesTheSharedVectors(t *testing.T) {
	vectors := loadRowQualifierVectors(t)

	const partner = "zz-partner.sm"
	skipped := 0
	exercised := 0
	for _, vector := range vectors {
		if !vector.ViaFork {
			// virtualFileName fail-closes on these names, so they are unreachable
			// input here rather than an exemption from agreement. The reference
			// still pins them.
			skipped++
			continue
		}
		if vector.Module == partner {
			t.Fatalf("vector %q collides with the fixed partner module", vector.Module)
		}
		result := compileInternalSource(t, []SourceFile{
			{Path: vector.Module, Kind: FileKindSmithers, Text: rowQualifierSource("subject")},
			{Path: partner, Kind: FileKindSmithers, Text: rowQualifierSource("partner")},
		})
		got := boomRowIn(t, result, vector.Module)
		want := "Boom@" + vector.Qualifier
		if got != want {
			t.Fatalf("%s\n module %q\n  fork      = %q\n  reference = %q", vector.Why, vector.Module, got, want)
		}
		other := boomRowIn(t, result, partner)
		if other != "Boom@zz-partner" {
			t.Fatalf("the partner module's own row moved: %q", other)
		}
		if got == other {
			t.Fatalf("%q and %q were handed one row name %q", vector.Module, partner, got)
		}
		exercised++
	}
	if skipped > 2 {
		t.Fatalf("%d vectors are unreachable through the fork; the corpus is drifting out of the fork's reach", skipped)
	}
	if exercised != len(vectors)-skipped {
		t.Fatalf("exercised %d of %d reachable vectors", exercised, len(vectors)-skipped)
	}
}

// ---------------------------------------------------------------------------
// The reproduction, through the fork
// ---------------------------------------------------------------------------

// The two module names the normalization used to fold together, in one project,
// each declaring a class with one name. This is the program the qualifier exists
// for, and the one it used to answer with a single name for both.
func TestPinnedForkModuleRowQualifierSeparatesNormalizedModuleNames(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "a b.sm", Kind: FileKindSmithers, Text: rowQualifierSource("spaced")},
		{Path: "a_b.sm", Kind: FileKindSmithers, Text: rowQualifierSource("scored")},
		// '+' is the escape introducer, so it must escape itself or the encoding
		// is not reversible and this third module folds onto one of the first two.
		{Path: "a+b.sm", Kind: FileKindSmithers, Text: rowQualifierSource("plussed")},
	})
	rows := map[string]string{}
	for _, file := range []string{"a b.sm", "a_b.sm", "a+b.sm"} {
		row := boomRowIn(t, result, file)
		if prior, clash := rows[row]; clash {
			t.Fatalf("%s and %s were handed one row name %q", prior, file, row)
		}
		rows[row] = file
	}
	// Compared as a SET, so nothing here has to order author-controlled strings —
	// byte order and UTF-16 order disagree on exactly the inputs this file is full
	// of (see fork_utf16_order_test.go), and sortUTF16 lives inside the bridge.
	want := map[string]bool{"Boom@a+0020b": true, "Boom@a_b": true, "Boom@a+002Bb": true}
	for row := range rows {
		if !want[row] {
			t.Fatalf("unexpected row name %q; want one of %#v", row, want)
		}
		delete(want, row)
	}
	if len(want) != 0 {
		t.Fatalf("row names never minted: %#v", want)
	}
}

// An astral character in a module path is TWO UTF-16 code units and therefore
// two escapes. The fork used to walk runes and write one '_', while the
// reference wrote two — the same program, two different row names, on two
// backends that are supposed to be interchangeable.
func TestPinnedForkModuleRowQualifierCountsUTF16CodeUnits(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "x\U0001F600.sm", Kind: FileKindSmithers, Text: rowQualifierSource("astral")},
		{Path: "x__.sm", Kind: FileKindSmithers, Text: rowQualifierSource("scored")},
	})
	astral := boomRowIn(t, result, "x\U0001F600.sm")
	if astral != "Boom@x+D83D+DE00" {
		t.Fatalf("astral module row = %q, want %q (one escape per UTF-16 unit, not per rune)", astral, "Boom@x+D83D+DE00")
	}
	if scored := boomRowIn(t, result, "x__.sm"); scored == astral {
		t.Fatalf("the astral module and %q were handed one row name %q", "x__.sm", astral)
	}
}
