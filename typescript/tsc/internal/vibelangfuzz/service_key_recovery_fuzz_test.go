package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceKeyRecoveryQuote = "A member gets one diagnostic: the first row below that names it."
const serviceRejectedMemberQuote = "any member that is not a \x60PropertySignature\x60, a \x60MethodSignature\x60"

func serviceKeyRecoveryChapter(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	chapter := string(text)
	for _, quote := range []string{keyErrorQuote, serviceKeyRecoveryQuote, serviceRejectedMemberQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return chapter
}

func TestServiceKeyRecoveryQuoted(t *testing.T) { serviceKeyRecoveryChapter(t) }

func FuzzServiceKeyWithRejectedMembers(f *testing.F) {
	startShortBudget(f)
	chapter := serviceKeyRecoveryChapter(f)
	shapes := []struct{ key, annotation string }{
		{"body", ""}, {"named", ": Shape"}, {"scalar", ": number"},
	}
	members := []struct{ key, text string }{
		{"index", "[x: string]: unknown"},
		{"constructor", "constructor() {}"},
		{"call", "(): number"}, {"construct", "new(): number"},
		{"getter", "get n() { return 1 }"},
		{"method", "read() { return 1 }"},
	}
	keys := []struct{ key, text string }{
		{"mutable", "static key = \"recovery/S\""},
		{"number", "static readonly key = 7"},
		{"template", "static readonly key = \x60recovery/S\x60"},
		{"valid", "static readonly key = \"recovery/S\""},
	}
	type probe struct {
		key, source string
		wantKey     int
	}
	var probes []probe
	for _, shape := range shapes {
		for _, member := range members {
			for _, key := range keys {
				wantKey := 1
				if key.key == "valid" {
					wantKey = 0
				}
				name := shape.key + "/" + member.key + "/" + key.key
				source := "type Shape = number; export service S" + shape.annotation + " { " + key.text + "; " + member.text + " }\n" +
					"export class Native { static key = 7; constructor(public n: number) {}; get value() { return this.n } }"
				probes = append(probes, probe{name, source, wantKey})
				f.Add([]byte(name))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % len(probes)
		}
		for i, p := range probes {
			if string(data) == p.key {
				index = i
				break
			}
		}
		p := probes[index]
		source := p.source
		if len(data) > 1 && data[1]%2 == 1 {
			source = strings.ReplaceAll(source, "; ", ";\r\n")
		}
		if len(data) > 2 && data[2]%2 == 1 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		result, err := w.Compile(t.Context(), Project{
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
		})
		if err != nil {
			Gap(t, "FuzzServiceKeyWithRejectedMembers", p.key, "compile: %v", err)
			return
		}
		defer result.Remove()
		keyCode := servicesRuleDiagnostic(chapter, keyErrorQuote)
		memberCode := servicesRuleDiagnostic(chapter, serviceRejectedMemberQuote)
		if keyCode == 0 || memberCode == 0 {
			t.Fatal("chapter 5 member codes are missing")
		}
		gotKey, gotMember := 0, 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == keyCode {
				gotKey++
				continue
			}
			if IsEK(d) && d.Code() == memberCode {
				gotMember++
				continue
			}
			Gap(t, "FuzzServiceKeyWithRejectedMembers", p.key, "unexpected %s\n%s", d.String(), source)
			return
		}
		if gotKey != p.wantKey || gotMember != 1 {
			Gap(t, "FuzzServiceKeyWithRejectedMembers", p.key, "want %d EK%04d and one EK%04d, got %d and %d\n%s", p.wantKey, keyCode, memberCode, gotKey, gotMember, source)
			return
		}
		ExpectPending(t, "FuzzServiceKeyWithRejectedMembers", p.key)
		ExpectPending(t, "FuzzServiceKeyWithRejectedMembers", specCorpusKey(t))
	})
}
