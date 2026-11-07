package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const platformHostNestedTarget = "FuzzPlatformHostNestedBindings"
const platformHostNestedQuote = "`EK4402` asks one question of a statically named value: does the symbol it resolves to reach the platform, by doing I/O, starting a timer, or reading or changing host state?"
const platformHostNestedShadowQuote = "A local binding, an import or an Effect module in scope (`Option`, `FileSystem`, `Headers`, `Worker`) shadows the global first"

const platformHostNestedSelectionQuote = "Statically named means an identifier, `.name`, `?.name`, `[\"name\"]`, a template with no substitutions, or a destructured property with such a key, and an alias keeps the symbol it copies."

type platformHostNestedCase struct {
	Key, Source string
	Spans       []string
}

func TestPlatformHostNestedBindingsQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformHostNestedQuote)
	chapterSays(t, "005-services.md", platformHostNestedShadowQuote)
	chapterSays(t, "005-services.md", platformHostNestedSelectionQuote)
}

func FuzzPlatformHostNestedBindings(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", platformHostNestedQuote)
	chapterSays(f, "005-services.md", platformHostNestedShadowQuote)
	chapterSays(f, "005-services.md", platformHostNestedSelectionQuote)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-host-nested-bindings.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []platformHostNestedCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add(test.Key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		index := slices.IndexFunc(cases, func(c platformHostNestedCase) bool { return c.Key == key })
		if index < 0 {
			index = len(key) % len(cases)
		}
		test := cases[index]
		source := strings.Repeat("// host alias\n", int(mode%3)) + test.Source
		if mode&4 != 0 {
			source = "namespace Group {\n" + source + "}\nexport {}\n"
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		file := "main.vibe"
		if mode&16 != 0 {
			file = "main.vibex"
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"jsx":"preserve","types":[]},"files":[%q]}`, file)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var spans []string
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 4402 {
				Gap(t, platformHostNestedTarget, test.Key, "unexpected diagnostic: %s", d.String())
				return
			}
			spans = append(spans, source[d.Pos():d.End()])
		}
		if !slices.Equal(spans, test.Spans) {
			Gap(t, platformHostNestedTarget, test.Key, "%s; mode=%d want spans %q got %q", platformHostNestedQuote, mode, test.Spans, spans)
			return
		}
		ExpectPending(t, platformHostNestedTarget, test.Key)
		ExpectPending(t, platformHostNestedTarget, specCorpusKey(t))
	})
}
