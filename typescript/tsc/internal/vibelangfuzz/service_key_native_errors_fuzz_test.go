package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceKeyNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func serviceKeyNativeChapter(t testing.TB) {
	t.Helper()
	keyErrorAuthorityChapter(t)
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), serviceKeyNativeQuote) {
		t.Fatalf("chapter 7 no longer says %q", serviceKeyNativeQuote)
	}
}

func TestServiceKeyNativeErrorsQuoted(t *testing.T) { serviceKeyNativeChapter(t) }

func FuzzServiceKeyNativeErrors(f *testing.F) {
	startShortBudget(f)
	serviceKeyNativeChapter(f)
	rules := []struct {
		key, member string
		native      int32
	}{
		{"name", "static readonly key = Missing", 2304},
		{"type", "static key: Missing = \"native/S\"", 2304},
		{"assignment", "static readonly key: string = 7", 2322},
		{"property", "static readonly key = ({}).missing", 2339},
		{"argument", "static readonly key = ((n: number) => n)(\"bad\")", 2345},
		{"assertion", "static readonly key = 7 as Missing", 2304},
		{"private", "private static readonly key = Missing", 2304},
		{"protected", "protected static readonly key: string = 7", 2322},
	}
	for _, shape := range []string{"body", "scalar"} {
		for _, rule := range rules {
			f.Add([]byte(shape + "/" + rule.key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		si, ri := 0, 0
		if len(data) > 0 {
			si = int(data[0]) % 2
		}
		if len(data) > 1 {
			ri = int(data[1]) % len(rules)
		}
		for s, shape := range []string{"body", "scalar"} {
			for i, rule := range rules {
				if string(data) == shape+"/"+rule.key {
					si, ri = s, i
				}
			}
		}
		annotation := ""
		shape := "body"
		if si == 1 {
			annotation = ": number"
			shape = "scalar"
		}
		rule := rules[ri]
		key := shape + "/" + rule.key
		source := "export service S" + annotation + " { " + rule.member + " }"
		if len(data) > 2 && data[2]%2 == 1 {
			source = strings.ReplaceAll(source, " = ", " /* key */ = ")
		}
		if len(data) > 3 && data[3]%2 == 1 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		result, err := w.Compile(t.Context(), Project{
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
		})
		if err != nil {
			Gap(t, "FuzzServiceKeyNativeErrors", key, "compile: %v", err)
			return
		}
		defer result.Remove()
		native, keyErrors := 0, 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 901 {
				keyErrors++
				continue
			}
			if !IsEK(d) && d.Code() == rule.native {
				native++
				continue
			}
			Gap(t, "FuzzServiceKeyNativeErrors", key, "unexpected %s\\n%s", d.String(), source)
			return
		}
		if native != 1 || keyErrors != 1 {
			Gap(t, "FuzzServiceKeyNativeErrors", key, "want EK0901 and independent TS%d, got %d and %d\\n%s", rule.native, keyErrors, native, source)
			return
		}
		ExpectPending(t, "FuzzServiceKeyNativeErrors", key)
		ExpectPending(t, "FuzzServiceKeyNativeErrors", specCorpusKey(t))
	})
}
