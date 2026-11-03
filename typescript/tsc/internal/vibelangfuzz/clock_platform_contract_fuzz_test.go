package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const clockPlatformTarget = "FuzzClockPlatformContract"
const clockPlatformQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."

func clockPlatformQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("005-services.md"), clockPlatformQuote) {
		t.Fatalf("chapter 005 no longer says %q", clockPlatformQuote)
	}
}
func TestClockPlatformContractQuoted(t *testing.T) { clockPlatformQuoted(t) }
func FuzzClockPlatformContract(f *testing.F) {
	startShortBudget(f)
	clockPlatformQuoted(f)
	var rows []struct {
		Key, Source, Severity string
		Banned                bool
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/clock-platform-contract.json"))
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
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.IndexFunc(rows, func(row struct {
			Key, Source, Severity string
			Banned                bool
		}) bool {
			return row.Key == parts[0]
		})
		if index < 0 {
			index = len(data) % len(rows)
		}
		row := rows[index]
		source := row.Source
		if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// host identity survives trivia\n" + strings.ReplaceAll(source, "value", "résultat")
		}
		config := `{"compilerOptions":{"strict":true,"skipLibCheck":true,"target":"ESNext","module":"NodeNext","types":[]},"files":["main.vibe"]}`
		if row.Severity != "default" {
			config = strings.TrimSuffix(config, "}") + fmt.Sprintf(`,"vibelang":{"diagnostics":{"EK4403":%q}}}`, strings.TrimPrefix(row.Severity, "legacy-"))
		}
		result, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		banned, retired, controlError := false, false, false
		for _, d := range result.Diagnostics {
			banned = banned || (IsEK(d) && d.Code() == 4402 && d.Category() == diagnostics.CategoryError)
			retired = retired || (IsEK(d) && d.Code() == 4403)
			controlError = controlError || (!row.Banned && d.Category() == diagnostics.CategoryError)
		}
		if banned != row.Banned || retired || controlError {
			Gap(t, clockPlatformTarget, row.Key, "%s; expected host error=%t without retired4403, got %v", clockPlatformQuote, row.Banned, SortedKeys(Keys(result.Dir, result.Diagnostics)))
			return
		}
		ExpectPending(t, clockPlatformTarget, row.Key)
		ExpectPending(t, clockPlatformTarget, specCorpusKey(t))
	})
}
