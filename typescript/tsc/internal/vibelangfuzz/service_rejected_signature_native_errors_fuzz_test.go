package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"slices"
	"strings"
	"testing"
)

const serviceSignatureNativeQuote = "Native lexical, syntax and static errors keep their " +
	"\x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."
const serviceSignatureMemberQuote = "a body, an initializer, a modifier"

func serviceSignatureNativeChapter(t testing.TB) string {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), serviceSignatureMemberQuote) || !strings.Contains(string(tooling), serviceSignatureNativeQuote) {
		t.Fatal("service signature diagnostic rules changed")
	}
	return string(chapter)
}
func TestServiceRejectedSignatureNativeErrorsQuoted(t *testing.T) { serviceSignatureNativeChapter(t) }

func FuzzServiceRejectedSignatureNativeErrors(f *testing.F) {
	startShortBudget(f)
	chapter := serviceSignatureNativeChapter(f)
	code := servicesRuleDiagnostic(chapter, serviceSignatureMemberQuote)
	rows := []struct {
		key    string
		whole  bool
		member string
		native int32
	}{
		{"call/body/parameter", false, "(value: Missing): number", 2304},
		{"call/body/return", false, "(): Missing", 2304},
		{"call/body/constraint", false, "<T extends Missing>(value:T): T", 2304},
		{"call/body/nested-type", false, "(): {value:Missing}", 2304},
		{"call/body/header", false, "(): number", 0},
		{"construct/body/parameter", false, "new(value: Missing): number", 2304},
		{"construct/body/return", false, "new(): Missing", 2304},
		{"construct/body/constraint", false, "new<T extends Missing>(value:T): T", 2304},
		{"construct/body/nested-type", false, "new(): {value:Missing}", 2304},
		{"construct/body/header", false, "new(): number", 0},
		{"constructor/body/body-name", false, "constructor() { Missing }", 2304},
		{"constructor/body/parameter", false, "constructor(value:Missing) {}", 2304},
		{"constructor/body/body-property", false, "constructor() { ({}).missing }", 2339},
		{"constructor/body/body-call", false, "constructor() { ((n:number)=>n)(\"bad\") }", 2345},
		{"constructor/body/header", false, "constructor() {}", 0},
		{"constructor/whole/body-name", true, "constructor() { Missing }", 2304},
		{"constructor/whole/parameter", true, "constructor(value:Missing) {}", 2304},
		{"constructor/whole/body-property", true, "constructor() { ({}).missing }", 2339},
		{"constructor/whole/body-call", true, "constructor() { ((n:number)=>n)(\"bad\") }", 2345},
		{"constructor/whole/header", true, "constructor() {}", 0},
		{"index/body/return", false, "[key:string]: Missing", 2304},
		{"index/body/parameter", false, "[key:Missing]: number", 2304},
		{"index/body/nested-type", false, "[key:string]: {value:Missing}", 2304},
		{"index/body/static-return", false, "static [key:string]: Missing", 2304},
		{"index/body/header", false, "[key:string]: number", 0},
		{"index/whole/return", true, "[key:string]: Missing", 2304},
		{"index/whole/parameter", true, "[key:Missing]: number", 2304},
		{"index/whole/nested-type", true, "[key:string]: {value:Missing}", 2304},
		{"index/whole/static-return", true, "static [key:string]: Missing", 2304},
		{"index/whole/header", true, "[key:string]: number", 0},
		{"index/body/nested-index", false, "static [key:string]: { [key:string]: string; field:number }", 2411},
		{"index/whole/nested-index", true, "static [key:string]: { [key:string]: string; field:number }", 2411},
		{"call/body/untyped-header", false, "()", 0},
		{"construct/body/untyped-header", false, "new()", 0},
		{"call/body/nested-untyped", false, "(): { () }", 7020},
		{"construct/body/nested-untyped", false, "new(): { () }", 7020},
	}
	keys := []string{}
	for _, row := range rows {
		keys = append(keys, row.key)
		f.Add([]byte(row.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		row := rows[slices.Index(keys, key)]
		shape := ""
		if row.whole {
			shape = ": {value:number}"
		}
		source := "export service S" + shape + " { static readonly key = \"native/S\"; " + row.member + " }"
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) != 0 {
			variant = parts[1][0]
		}
		if variant&1 != 0 {
			source = strings.ReplaceAll(source, "Missing", "Absent")
		}
		if variant&2 != 0 {
			source = "function local() { " + strings.TrimPrefix(source, "export ") + " }"
		}
		r, err := w.Compile(t.Context(), Project{Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}", Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		rejection, native, total := 0, 0, 0
		for _, d := range r.Diagnostics {
			if d.Code() == 2307 {
				t.Fatalf("required fixture dependency: %s", d.String())
			}
			if d.Category() == diagnostics.CategoryError {
				total++
			}
			if d.Source() == "EK" && d.Code() == code {
				rejection++
			}
			if row.native != 0 && d.Code() == row.native {
				native++
			}
		}
		want := 0
		if row.native != 0 {
			want = 1
		}
		if rejection != 1 || native != want || row.native == 0 && total != 1 {
			Gap(t, "FuzzServiceRejectedSignatureNativeErrors", key, "%s; want one EK%04d and %d TS%d, got %d and %d (%d total errors)", serviceSignatureNativeQuote, code, want, row.native, rejection, native, total)
			return
		}
		ExpectPending(t, "FuzzServiceRejectedSignatureNativeErrors", key)
		ExpectPending(t, "FuzzServiceRejectedSignatureNativeErrors", specCorpusKey(t))
	})
}
