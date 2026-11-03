package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-7 delegates these static checks to TypeScript, including its exceptions
// for any, unknown, and types that contain undefined. Initialization in a
// pattern is conditional; its type must not be mistaken for its flow state.
const isAssignmentQuote = "These bindings take part in TypeScript's definite-assignment and use-before-declaration checks, as a `let` assigned where the pattern runs would."

func TestIsAssignmentTypesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), isAssignmentQuote) {
		t.Fatalf("chapter 004 no longer says %q", isAssignmentQuote)
	}
}

type isAssignmentType struct{ key, text string }

var isAssignmentTypes = []isAssignmentType{
	{"number", "number"}, {"string", "string"}, {"unknown", "unknown"},
	{"any", "any"}, {"optional", "number | undefined"}, {"void", "void"},
}
var isAssignmentPaths = []string{"fallthrough", "guard-return", "short-circuit", "skipped"}

func isAssignmentSource(typ, path, form, name string, vibe bool) string {
	subject, pattern, test := "[number, "+typ+"]", "[1, let "+name+"]", "s[0] === 1 && ("+name+" = s[1], true)"
	if form == "object" {
		subject, pattern, test = "{kind: number, value: "+typ+"}", "{kind: 1, value: let "+name+"}", "s.kind === 1 && ("+name+" = s.value, true)"
	}
	decl := "let " + name + ": " + typ + "; "
	if vibe {
		test, decl = "s is "+pattern, ""
	}
	test = "(" + test + ")"
	body := "if (" + test + ") return " + name + "; return " + name + ";"
	switch path {
	case "guard-return":
		body = "if (!" + test + ") return; return " + name + ";"
	case "short-circuit":
		body = "if (b && " + test + ") return " + name + "; return " + name + ";"
	case "skipped":
		body = "if (true || " + test + ") return " + name + "; return;"
	}
	return "export function read(s: " + subject + ", b: boolean) { " + decl + body + " }\n"
}

func isAssignmentCodes(t *testing.T, w *Workspace, source, extension string) []string {
	t.Helper()
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main." + extension: source}})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var codes []string
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			prefix := d.Source()
			if prefix == "" {
				prefix = "TS"
			}
			codes = append(codes, fmt.Sprintf("%s%04d", prefix, d.Code()))
		}
	}
	slices.Sort(codes)
	return codes
}

func checkIsAssignmentTypes(t *testing.T, w *Workspace, typ isAssignmentType, path, form, name string) {
	t.Helper()
	native := isAssignmentSource(typ.text, path, form, name, false)
	source := isAssignmentSource(typ.text, path, form, name, true)
	want := isAssignmentCodes(t, w, native, "ts")
	got := isAssignmentCodes(t, w, source, "vibe")
	// The typed controls must exercise native TS2454, rather than agree because
	// neither compiler reached the declaration or the condition's assignment.
	expected := []string(nil)
	if (typ.key == "number" || typ.key == "string") && path != "guard-return" {
		expected = []string{"TS2454"}
	}
	if !slices.Equal(want, expected) {
		t.Fatalf("native control: got %v, want %v\n%s", want, expected, native)
	}
	if !slices.Equal(got, want) {
		Gap(t, "FuzzIsAssignmentTypes", typ.key+"/"+path+"/"+form, "native %v, pattern %v\n%s\n%s", want, got, native, source)
	}
}

func TestIsAssignmentTypes(t *testing.T) {
	w := NewWorkspace(t)
	for _, typ := range isAssignmentTypes {
		for _, path := range isAssignmentPaths {
			for _, form := range []string{"list", "object"} {
				t.Run(typ.key+"/"+path+"/"+form, func(t *testing.T) { checkIsAssignmentTypes(t, w, typ, path, form, "value") })
			}
		}
	}
}

func FuzzIsAssignmentTypes(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for i, typ := range isAssignmentTypes {
		for _, form := range []string{"list", "object"} {
			f.Add([]byte(typ.key + "/" + isAssignmentPaths[i%len(isAssignmentPaths)] + "/" + form))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) == 0 {
			return
		}
		typ := isAssignmentTypes[int(data[0])%len(isAssignmentTypes)]
		path := isAssignmentPaths[int(data[len(data)-1])%len(isAssignmentPaths)]
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
			for _, candidate := range isAssignmentPaths {
				if parts[1] == candidate {
					path = candidate
				}
			}
			if parts[2] == "list" || parts[2] == "object" {
				form = parts[2]
			}
		}
		checkIsAssignmentTypes(t, w, typ, path, form, name)
	})
}
