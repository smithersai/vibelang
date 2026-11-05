package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const nestedDataCoverageQuote = "when every other property it tests is a bare key or a `let` or `const` binding that the member declares as required"

func TestNestedDataMatchCoverageQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), nestedDataCoverageQuote) {
		t.Fatal("nested data coverage quote changed")
	}
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatal("declaration-preserving repair quote changed")
	}
}

// Refutable payload tests do not cover their containing data variant.
// Required bare keys and irrefutable captures do, at any nesting depth.
func FuzzNestedDataMatchCoverage(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("004-match.md"), nestedDataCoverageQuote) {
		f.Fatal("nested data coverage quote changed")
	}
	keys := []string{"nested", "all-leaves", "capture", "bare-key", "tag-only", "independent-cover"}
	for _, key := range keys {
		for depth := uint8(0); depth < 3; depth++ {
			f.Add(key, depth, depth)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, nesting, shape uint8) {
		if !strings.Contains("|"+strings.Join(keys, "|")+"|", "|"+key+"|") {
			key = keys[int(shape)%len(keys)]
		}
		depth := int(nesting%3) + 1
		source := "data Leaf { One; Two }\n"
		typ := "Leaf"
		one, two := `{_tag:"One"}`, `{_tag:"Two"}`
		for i := 0; i < depth; i++ {
			name := fmt.Sprintf("Wrap%d", i)
			source += fmt.Sprintf("data %s { Box { value: %s } }\n", name, typ)
			typ = name
			one = `{_tag:"Box",value:` + one + "}"
			two = `{_tag:"Box",value:` + two + "}"
		}
		arms, want := "when "+one+":1;", 1
		switch key {
		case "all-leaves":
			arms += "when " + two + ":2;"
		case "capture":
			arms, want = `when {_tag:"Box",value:let payload}:1;`, 0
		case "bare-key":
			arms, want = `when {_tag:"Box",value}:1;`, 0
		case "tag-only":
			arms, want = `when {_tag:"Box"}:1;`, 0
		case "independent-cover":
			arms += `when {_tag:"Box",value:const payload}:2;`
			want = 0
		}
		modifier := ""
		if shape&1 != 0 {
			modifier = "effect "
		}
		source += fmt.Sprintf("export %sfunction check(value:%s){return match(value){%s}}", modifier, typ, arms)
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"outDir":"out"},"files":["main.vibe"]}`
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if diagnosticKey(d) != "EK4701" {
				Gap(t, "FuzzNestedDataMatchCoverage", "coverage:"+key+":unexpected", "unexpected %s\n%s", specDiagnosticText(d), source)
			}
			count++
		}
		if count != want {
			Gap(t, "FuzzNestedDataMatchCoverage", "coverage:"+key, "%s: want %d EK4701, got %d\n%s", nestedDataCoverageQuote, want, count, source)
		}
		if want == 1 {
			var fixed *vibelang.FixResult
			within(t, "fix", func() {
				fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), result.Program.CommandLine(), vibelang.FixOptions{})
			})
			if fixed.Err != nil {
				t.Fatal(fixed.Err)
			}
			after, repaired := source, 0
			for _, file := range fixed.Files {
				after = file.Text
				repaired += file.Counts[4701]
			}
			if repaired != 1 || len(fixed.Refused) != 0 {
				Gap(t, "FuzzNestedDataMatchCoverage", "repair:"+key, "missing preserving repair: count=%d refused=%v\n%s", repaired, fixed.Refused, source)
			}
			checked, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": after}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer checked.Remove()
			if HasError(checked.Diagnostics) {
				Gap(t, "FuzzNestedDataMatchCoverage", "fixed-errors:"+key, "repaired source reports %v\n%s", SortedKeys(Keys(checked.Dir, checked.Diagnostics)), after)
			}
			beforeDts, beforeExists := result.Outputs["out/main.d.ts"]
			afterDts, afterExists := checked.Outputs["out/main.d.ts"]
			if !beforeExists || !afterExists || beforeDts != afterDts {
				Gap(t, "FuzzNestedDataMatchCoverage", "fixed-api:"+key, "%s\nbefore:\n%s\nafter:\n%s", migrationDeclarationFixQuote, beforeDts, afterDts)
			}
		}
	})
}
