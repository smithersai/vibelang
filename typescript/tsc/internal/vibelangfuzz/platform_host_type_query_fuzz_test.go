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

const platformHostTypeQueryTarget = "FuzzPlatformHostTypeQuery"
const platformHostTypeQueryQuote = "Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is."

type platformHostTypeQueryCase struct {
	Key, Source string
	Spans       []string
}

func TestPlatformHostTypeQueryQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformHostTypeQueryQuote)
}

func FuzzPlatformHostTypeQuery(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", platformHostTypeQueryQuote)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-host-type-query.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []platformHostTypeQueryCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add(test.Key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		index := slices.IndexFunc(cases, func(c platformHostTypeQueryCase) bool { return c.Key == key })
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
				Gap(t, platformHostTypeQueryTarget, test.Key, "unexpected diagnostic: %s", d.String())
				return
			}
			spans = append(spans, source[d.Pos():d.End()])
		}
		if !slices.Equal(spans, test.Spans) {
			Gap(t, platformHostTypeQueryTarget, test.Key, "%s; mode=%d want spans %q got %q", platformHostTypeQueryQuote, mode, test.Spans, spans)
			return
		}
		ExpectPending(t, platformHostTypeQueryTarget, test.Key)
		ExpectPending(t, platformHostTypeQueryTarget, specCorpusKey(t))
	})
}
