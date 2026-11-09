package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const experimentalNameAdviceTarget = "FuzzExperimentalNameAdvice"
const experimentalNameAdviceQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."
const experimentalNameServiceQuote = "There is no `Users.find(id)` shorthand"

func experimentalNameAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", experimentalNameAdviceQuote)
	chapterSays(t, "005-services.md", experimentalNameServiceQuote)
	chapterSays(t, "005-services.md", "Platform access is only through injected Effect services")
}
func TestExperimentalNameAdviceQuoted(t *testing.T) { experimentalNameAdviceQuoted(t) }

// The expected examples are source fixtures, independent of the diagnostic
// table. Mutate trivia and source extension while keeping the missing binding,
// and retain local/property/native-module controls that must get no such note.
func FuzzExperimentalNameAdvice(f *testing.F) {
	startShortBudget(f)
	experimentalNameAdviceQuoted(f)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/experimental-name-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	var rows []struct {
		Key, Source, Advice string
		Want                int
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		for mode := byte(0); mode < 4; mode++ {
			f.Add([]byte(row.Key + "\x00" + string([]byte{mode})))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		i := slices.IndexFunc(rows, func(row struct {
			Key, Source, Advice string
			Want                int
		}) bool {
			return row.Key == parts[0]
		})
		if i < 0 {
			i = len(data) % len(rows)
		}
		row := rows[i]
		mode := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			mode = parts[1][0]
		}
		file := "main.vibe"
		if mode&1 != 0 {
			file = "main.vibex"
		}
		source := row.Source
		if mode&2 != 0 {
			source = "// retained é\r\n" + strings.ReplaceAll(source, " = ", " /* retained */ = ")
		}
		config := `{"compilerOptions":{"strict":true,"target":"ESNext","lib":["ESNext"],"module":"NodeNext","noEmit":true,"skipLibCheck":true,"jsx":"preserve","types":[]},"vibe":{"effectGlobals":false,"effectModules":false},"files":["` + file + `"]}`
		result, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{file: source, "package.json": `{"type":"module"}`}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			text := layerMergeAdviceText(d)
			if strings.Contains(text, "VibeLang\u0027s experimental") {
				count++
				if d.Source() != "" || (d.Code() != 2304 && d.Code() != 2552) {
					t.Fatalf("lost native diagnostic identity: %s", d.String())
				}
				if !strings.Contains(text, row.Advice) || strings.Contains(row.Advice, "try (try") && !strings.Contains(text, "Provide it in main with") {
					Gap(t, experimentalNameAdviceTarget, row.Key, "%s: want runnable advice %q with its provider in %s", experimentalNameAdviceQuote, row.Advice, text)
					return
				}
			} else if d.Code() != 2304 && d.Code() != 2552 {
				t.Fatalf("invalid fixture %s: %s", row.Key, d.String())
			}
		}
		if count != row.Want {
			Gap(t, experimentalNameAdviceTarget, row.Key, "want %d experimental notes, got %d", row.Want, count)
			return
		}
		ExpectPending(t, experimentalNameAdviceTarget, row.Key)
		ExpectPending(t, experimentalNameAdviceTarget, specCorpusKey(t))
	})
}
