package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const geolocationInjectionQuote = "Platform access is only through injected Effect services"

func geolocationServiceAdviceQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("005-services.md")
	for _, quote := range []string{geolocationInjectionQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter005 no longer says %q", quote)
		}
	}
}
func TestGeolocationServiceAdviceQuoted(t *testing.T) { geolocationServiceAdviceQuoted(t) }
func FuzzGeolocationServiceAdvice(f *testing.F) {
	startShortBudget(f)
	geolocationServiceAdviceQuoted(f)
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/geolocation-service-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		f.Add([]byte(row.Key + "\x00\x00"))
		f.Add([]byte(row.Key + "\x00\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		geolocationServiceAdviceQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		i := slices.IndexFunc(rows, func(row struct{ Key, Source, Advice string }) bool { return row.Key == parts[0] })
		if i < 0 {
			i = len(data) % len(rows)
		}
		row := rows[i]
		source := row.Source
		if len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// retain namespace lookup through trivia\n" + strings.ReplaceAll(source, "Native", "Nâtive")
		}
		r, err := w.Compile(t.Context(), Project{Config: "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"types\":[],\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"main.vibe\",\"node.d.ts\",\"node_modules/@types/node/index.d.ts\"]}", Files: map[string]string{"main.vibe": source, "node.d.ts": "", "node_modules/@types/node/index.d.ts": "", "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`, "package.json": `{"type":"module"}`}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() != "EK" || d.Code() != 4402 {
				continue
			}
			count++
			if !strings.Contains(layerMergeAdviceText(d), row.Advice) {
				Gap(t, "FuzzGeolocationServiceAdvice", row.Key, "%s: want %q, got %s", geolocationInjectionQuote, row.Advice, layerMergeAdviceText(d))
				return
			}
		}
		if count != 1 {
			Gap(t, "FuzzGeolocationServiceAdvice", row.Key, "want one EK4402, got %d", count)
			return
		}
		ExpectPending(t, "FuzzGeolocationServiceAdvice", row.Key)
		ExpectPending(t, "FuzzGeolocationServiceAdvice", specCorpusKey(t))
	})
}
