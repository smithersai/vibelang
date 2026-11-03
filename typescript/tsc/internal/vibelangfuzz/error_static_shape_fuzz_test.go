package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const errorStaticShapeQuote = "| a user-written `static` member or setter, in either error form | `EK1302` |"
const errorStaticInvalidKeyQuote = "Ordinary TypeScript invalid-key errors remain independent."
const errorMemberPriorityQuote = "Otherwise a member gets one diagnostic: the first row that names it."

func TestErrorStaticShapeQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", errorStaticShapeQuote, errorMemberPriorityQuote, errorStaticInvalidKeyQuote)
}

var errorStaticShapeRows = []struct{ key, member string }{
	{"override-field", "static override extra = 1"},
	{"override-suggestion", "static override makeOptio() { return 1 }"},
	{"override-method", "static override extra() { return 1 }"},
	{"override-getter", "static override get extra() { return 1 }"},
	{"name", "static name = 1"},
	{"length", "static length = 1"},
	{"prototype", "static prototype = 1"},
	{"quoted-prototype", "static \"prototype\" = 1"},
	{"computed-prototype", "static [\"prototype\"] = 1"},
	{"parenthesized-prototype", "static [(\"prototype\")] = 1"},
	{"private-name", "private static name = \"hidden\""},
	{"protected-length", "protected static length = 1"},
	{"private-fields", "private static fields = 1"},
	{"make", "static make = 1"},
}

func FuzzErrorStaticShape(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", errorStaticShapeQuote, errorMemberPriorityQuote, errorStaticInvalidKeyQuote)
	var names []string
	for _, form := range []string{"error", "schema-error", "error-strict", "schema-error-strict"} {
		for _, row := range errorStaticShapeRows {
			names = append(names, form+"/"+row.key)
		}
	}
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		form := "error"
		if strings.HasPrefix(names[i], "schema-error") {
			form = "schema error"
		}
		gap := " "
		if len(data) > 0 && data[len(data)-1]%2 != 0 {
			gap = "\n"
		}
		source := fmt.Sprintf("%s Entry {%s%s%s}\n", form, gap, errorStaticShapeRows[i%len(errorStaticShapeRows)].member, gap)
		config := DefaultConfig
		if strings.Contains(names[i], "-strict/") {
			config = strings.Replace(config, "\"strict\": true,", "\"strict\": true, \"noImplicitOverride\": true,", 1)
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		codes := r4Errors(r.Diagnostics)
		want := 1
		if strings.Contains(names[i], "/parenthesized-prototype") {
			want = 2
			if !slices.Contains(codes, "TS1166") {
				t.Fatalf("lost independent native computed-key diagnostic: %v", codes)
			}
		}
		if len(codes) != want || !slices.Contains(codes, "EK1302") {
			Gap(t, "FuzzErrorStaticShape", "member:"+names[i], "003: %s %s; got %v\n%s", errorStaticShapeQuote, errorMemberPriorityQuote, codes, source)
		}
		ExpectPending(t, "FuzzErrorStaticShape", "member:"+names[i])
		if corpus := corpusFile(t, "FuzzErrorStaticShape"); corpus != "" {
			ExpectPending(t, "FuzzErrorStaticShape", "corpus:"+corpus)
		}
	})
}
