package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestProducerContractCLIRepairQuoted(t *testing.T) {
	producerContractVIP(t)
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("chapter 007 lost %q", migrationDeclarationFixQuote)
	}
}

func FuzzProducerContractCLIRepair(f *testing.F) {
	startShortBudget(f)
	forms := []string{"declaration", "object", "class"}
	contracts := []string{"direct", "readonly", "alias"}
	var keys []string
	for _, form := range forms {
		for _, contract := range contracts {
			key := form + "/" + contract
			keys = append(keys, key)
			f.Add(key, false)
			f.Add(key, true)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, unrelated bool) {
		TestProducerContractCLIRepairQuoted(t)
		const target = "FuzzProducerContractCLIRepair"
		selected := keys[len(key)%len(keys)]
		for _, candidate := range keys {
			if key == candidate {
				selected = key
				break
			}
		}
		key = selected
		parts := strings.Split(key, "/")
		contract := "Stream.Stream<number> & {extra:number}"
		prefix := ""
		if parts[1] == "readonly" {
			contract = "Stream.Stream<number> & {readonly extra:string}"
		}
		if parts[1] == "alias" {
			prefix = "export type Result=Stream.Stream<number> & {extra:number};\n"
			contract = "Result"
		}
		body := "{ /* keep yield */ yield 7 }"
		source := prefix + "export effect function* values(): " + contract + " " + body + "\n"
		if parts[0] == "object" {
			source = prefix + "export const holder={ effect *values(): " + contract + " " + body + " };\n"
		}
		if parts[0] == "class" {
			source = prefix + "export class Holder { effect *values(): " + contract + " " + body + " }\n"
		}
		const other = "export const unrelated:string=1;\n"
		if unrelated {
			source += other
		}
		files := map[string]string{"main.vibe": source}
		countErrors := func(r *Result) int {
			t.Helper()
			count := 0
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if IsEK(d) || d.Code() != 2322 {
					t.Fatalf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
				}
				count++
			}
			return count
		}
		before := toolsCompile(t, w, target, files)
		defer before.Remove()
		extra := 0
		if unrelated {
			extra = 1
		}
		if got := countErrors(before); got != 1+extra {
			t.Fatalf("fixture must require a return-contract repair: got%d want%d", got, 1+extra)
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil || len(result.Refused) != 0 {
			Gap(t, target, key, "repair refused: %v / %v", result.Err, result.Refused)
		}
		files = maps.Clone(files)
		for name, file := range result.Files {
			files[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		fixed := files["main.vibe"]
		if fixed == source || !strings.Contains(fixed, body) || (unrelated && !strings.Contains(fixed, other)) {
			Gap(t, target, key, "missing repair or changed body/independent assignment:\n%s", fixed)
		}
		after := toolsCompile(t, w, target, files)
		defer after.Remove()
		if got := countErrors(after); got != extra {
			Gap(t, target, key, "remaining assignment errors: got%d want%d\n%s", got, extra, fixed)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, target, key, "not a fixed point: %+v", again)
		}
	})
}
