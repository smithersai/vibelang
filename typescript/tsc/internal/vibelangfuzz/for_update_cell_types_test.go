package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

// Chapter 004 sends a read in a for statement's update of a binding from its
// test through TypeScript's type-dependent definite-assignment check. The
// update runs in a fresh iteration environment before the test initializes
// the cell, so the oracle is TypeScript's own check of a read of a declared,
// never-assigned let of the same type: TS2454 unless the type or the read is
// exempt.
const forUpdateCellQuote = "In `for (init; test; update)`, a direct read in `update` of a binding from `test` follows the same type-dependent `TS2454` checks: `update` starts in a fresh iteration environment before the `test` that initializes that cell."

func TestForUpdateCellTypesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), forUpdateCellQuote) {
		t.Fatalf("chapter 004 no longer says %q", forUpdateCellQuote)
	}
}

// forUpdateCellReads are the update's read forms: a plain read, a call
// argument and a non-null assertion, which TypeScript also exempts.
var forUpdateCellReads = []string{"assign", "argument", "nonnull"}

func forUpdateCellRead(read, name string) string {
	switch read {
	case "argument":
		return "seen.push(" + name + ")"
	case "nonnull":
		return "seen.push(" + name + "!)"
	}
	return "last = " + name
}

func forUpdateCellSource(typ isAssignmentType, read, form, name string, vibe bool) string {
	subject, pattern := "readonly ["+typ.text+"][]", "[let "+name+"]"
	if form == "object" {
		subject, pattern = "readonly {value: "+typ.text+"}[]", "{value: let "+name+"}"
	}
	head := "export function read(xs: " + subject + ") { let i = 0; let last: unknown; const seen: unknown[] = []; "
	if !vibe {
		// The native control: the same read of the cell before anything assigns it.
		return head + "let " + name + ": " + typ.text + "; " + forUpdateCellRead(read, name) + "; return [i, last, seen, xs] }\n"
	}
	return head + "for (; i < xs.length && (xs[i] is " + pattern + "); " + forUpdateCellRead(read, name) + ") i++; return [last, seen] }\n"
}

func checkForUpdateCellTypes(t *testing.T, w *Workspace, typ isAssignmentType, read, form, name string) {
	t.Helper()
	native := forUpdateCellSource(typ, read, form, name, false)
	source := forUpdateCellSource(typ, read, form, name, true)
	want := isAssignmentCodes(t, w, native, "ts")
	got := isAssignmentCodes(t, w, source, "vibe")
	// The control must exercise native TS2454 for the checked types, rather
	// than agree because neither compiler reached the read.
	expected := []string(nil)
	if (typ.key == "number" || typ.key == "string") && read != "nonnull" {
		expected = []string{"TS2454"}
	}
	if !slices.Equal(want, expected) {
		t.Fatalf("native control: got %v, want %v\n%s", want, expected, native)
	}
	if !slices.Equal(got, want) {
		Gap(t, "FuzzForUpdateCellTypes", typ.key+"/"+read+"/"+form, "native %v, update read %v\n%s\n%s", want, got, native, source)
	}
}

func TestForUpdateCellTypes(t *testing.T) {
	w := NewWorkspace(t)
	for _, typ := range isAssignmentTypes {
		for _, read := range forUpdateCellReads {
			for _, form := range []string{"list", "object"} {
				t.Run(typ.key+"/"+read+"/"+form, func(t *testing.T) { checkForUpdateCellTypes(t, w, typ, read, form, "value") })
			}
		}
	}
}

func FuzzForUpdateCellTypes(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for i, typ := range isAssignmentTypes {
		for _, form := range []string{"list", "object"} {
			f.Add([]byte(typ.key + "/" + forUpdateCellReads[i%len(forUpdateCellReads)] + "/" + form))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) == 0 {
			return
		}
		typ := isAssignmentTypes[int(data[0])%len(isAssignmentTypes)]
		read := forUpdateCellReads[int(data[len(data)-1])%len(forUpdateCellReads)]
		form := "list"
		name := "value"
		if len(data) > 1 && data[1]&1 != 0 {
			form = "object"
			name = "$value"
		}
		parts := strings.Split(string(data), "/")
		if len(parts) == 3 {
			for _, candidate := range isAssignmentTypes {
				if parts[0] == candidate.key {
					typ = candidate
				}
			}
			for _, candidate := range forUpdateCellReads {
				if parts[1] == candidate {
					read = candidate
				}
			}
			if parts[2] == "list" || parts[2] == "object" {
				form = parts[2]
			}
		}
		checkForUpdateCellTypes(t, w, typ, read, form, name)
	})
}
