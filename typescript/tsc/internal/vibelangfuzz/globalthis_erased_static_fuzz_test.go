package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const globalThisErasedKeysTarget = "FuzzGlobalThisErasedStaticAccess"
const globalThisErasedKeysQuote = "a member of an allowlisted global that reaches the host: `AbortSignal.timeout`, `URL.createObjectURL` and `URL.revokeObjectURL`."

type globalThisErasedKeyCase struct {
	Key, Source, Host, Member, Kind string
	Codes                           []string
	JSXSafe                         bool
}

func globalThisErasedKeysQuoted(t testing.TB) {
	chapterSays(t, "005-services.md", globalThisErasedKeysQuote)
	chapterSays(t, "005-services.md", "A property on an unrelated object, such as `client.fetch` or `client.timeout`, is a different symbol.")
	chapterSays(t, "005-services.md", "A key that is not statically known stays unchecked; this is not a sandbox.")
	chapterSays(t, "005-services.md", "Statically named means an identifier, `.name`, `?.name`, `[\"name\"]`, a template with no substitutions, or a destructured property with such a key, and an alias keeps the symbol it copies.")
}
func TestGlobalThisErasedStaticAccessQuoted(t *testing.T) { globalThisErasedKeysQuoted(t) }
func globalThisErasedKeyCases(t testing.TB) []globalThisErasedKeyCase {
	t.Helper()
	data, err := os.ReadFile("testdata/globalthis-erased-static.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []globalThisErasedKeyCase
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	return cases
}
func FuzzGlobalThisErasedStaticAccess(f *testing.F) {
	startShortBudget(f)
	globalThisErasedKeysQuoted(f)
	cases := globalThisErasedKeyCases(f)
	for _, test := range cases {
		for _, mode := range []byte{0, 3, 7} {
			f.Add(test.Key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		at := slices.IndexFunc(cases, func(c globalThisErasedKeyCase) bool { return c.Key == key })
		if at < 0 {
			at = len(key) % len(cases)
		}
		test := cases[at]
		key = test.Key
		source := test.Source
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "held", "capturé")
			source = "// retained key trivia\n" + source + "\n"
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		extension := "vibe"
		if mode&4 != 0 && test.JSXSafe {
			extension = "vibex"
		}
		for _, ext := range []string{"ts", extension} {
			file := "main." + ext
			config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"lib":["ES2022","DOM"],"jsx":"preserve","noEmit":true},"vibe":{"effectGlobals":false,"effectModules":false},"files":[%q]}`, file)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var codes []string
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				origin := d.Source()
				if origin == "" {
					origin = "TS"
				}
				codes = append(codes, fmt.Sprintf("%s%04d", origin, d.Code()))
			}
			slices.Sort(codes)
			want := test.Codes
			if ext == "ts" {
				want = nil
			}
			if !slices.Equal(codes, want) {
				Gap(t, globalThisErasedKeysTarget, key+":"+ext, "%s; want%v got%v; source=%s", globalThisErasedKeysQuote, want, codes, source)
				return
			}
		}
		ExpectPending(t, globalThisErasedKeysTarget, key)
		ExpectPending(t, globalThisErasedKeysTarget, specCorpusKey(t))
	})
}
