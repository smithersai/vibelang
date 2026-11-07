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

const platformHostRestTarget = "FuzzPlatformHostRestBindings"
const platformHostRestQuote = "`EK4402` asks one question of a statically named value: does the symbol it resolves to reach the platform, by doing I/O, starting a timer, or reading or changing host state?"
const platformHostRestShadowQuote = "A local binding, an import or an Effect module in scope (`Option`, `FileSystem`, `Headers`, `Worker`) shadows the global first"

type platformHostRestCase struct {
	Key, Source string
	Spans       []string
}

func TestPlatformHostRestBindingsQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformHostRestQuote)
	chapterSays(t, "005-services.md", platformHostRestShadowQuote)
}

func FuzzPlatformHostRestBindings(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", platformHostRestQuote)
	chapterSays(f, "005-services.md", platformHostRestShadowQuote)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-host-rest-bindings.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []platformHostRestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add(test.Key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		index := slices.IndexFunc(cases, func(c platformHostRestCase) bool { return c.Key == key })
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
				Gap(t, platformHostRestTarget, test.Key, "unexpected diagnostic: %s", d.String())
				return
			}
			spans = append(spans, source[d.Pos():d.End()])
		}
		if !slices.Equal(spans, test.Spans) {
			Gap(t, platformHostRestTarget, test.Key, "%s; mode=%d want spans %q got %q", platformHostRestQuote, mode, test.Spans, spans)
			return
		}
		ExpectPending(t, platformHostRestTarget, test.Key)
		ExpectPending(t, platformHostRestTarget, specCorpusKey(t))
	})
}
