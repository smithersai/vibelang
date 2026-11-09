package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

func multipleRestSpreadKeys() []string {
	var result []string
	for _, key := range variadicSpreadKeys() {
		parts := strings.Split(key, ":")
		if parts[2] != "safe" && parts[2] != "risky" || parts[1] == "other" {
			continue
		}
		for _, position := range []string{"before", "after", "fixed-tail"} {
			result = append(result, key+":"+position)
		}
	}
	return result
}
func multipleRestSpreadSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	base := strings.Join(parts[:3], ":")
	source, library, want := variadicSpreadSource(base, choice)
	array := "args"
	element := parts[2]
	if choice&2 != 0 {
		element = "(" + element + ")"
	}
	if parts[0] == "inline" {
		array = "[" + element + "]"
	}
	if choice&16 != 0 {
		array = "(" + array + ")"
	}
	prefix := ""
	if choice&1 != 0 {
		prefix = "1,"
	}
	callee := "strict"
	if choice&8 != 0 {
		callee = "new Holder"
	}
	args := "..." + array
	switch parts[3] {
	case "before":
		args = "...first," + args
	case "after":
		args += ",...second"
	case "fixed-tail":
		args += ",...([safe] as const)"
	}
	old := callee + "(" + prefix + "..." + array + ")"
	next := callee + "(" + prefix + args + ")"
	if !strings.Contains(source, old) {
		panic("missing callback invocation")
	}
	source = strings.Replace(source, old, next, 1)
	source = strings.Replace(source, "export ", "const first=[safe]\nconst second=[safe]\nexport ", 1)
	return source, library, want
}

const multipleRestSpreadTarget = "FuzzMultipleRestSpreadCallbackContracts"
const multipleRestSpreadQuote = "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything."

func assertMultipleRestSpreadRule(t testing.TB) {
	if !strings.Contains(SpecText(failuresChapter), multipleRestSpreadQuote) {
		t.Fatalf("callback assignability changed: %s", multipleRestSpreadQuote)
	}
}
func TestMultipleRestSpreadCallbackContractsQuoted(t *testing.T) { assertMultipleRestSpreadRule(t) }
func checkMultipleRestSpread(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := multipleRestSpreadSource(key, choice)
	project := Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": "{\"type\":\"module\"}"}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"foreign.d.ts\"]}"}
	result, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var got []int
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got = append(got, int(d.Code()))
		if !IsEK(d) || int(d.Code()) != want {
			Gap(t, multipleRestSpreadTarget, key, "%q: unexpected %s", multipleRestSpreadQuote, describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, multipleRestSpreadTarget, key, "%q: got %v, want EK%04d", multipleRestSpreadQuote, got, want)
	}
}
func TestMultipleRestSpreadCallbackContracts(t *testing.T) {
	assertMultipleRestSpreadRule(t)
	w := NewWorkspace(t)
	for _, key := range multipleRestSpreadKeys() {
		t.Run(key, func(t *testing.T) { checkMultipleRestSpread(t, w, key, 0) })
	}
}
func TestMultipleRestSpreadCallbackContractVariants(t *testing.T) {
	assertMultipleRestSpreadRule(t)
	w := NewWorkspace(t)
	for _, key := range multipleRestSpreadKeys() {
		for _, choice := range []uint8{1, 4, 8, 16, 64} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkMultipleRestSpread(t, w, key, choice) })
		}
	}
}
func FuzzMultipleRestSpreadCallbackContracts(f *testing.F) {
	startShortBudget(f)
	assertMultipleRestSpreadRule(f)
	keys := multipleRestSpreadKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkMultipleRestSpread(t, w, key, choice)
	})
}
