package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceGenericRecoveryQuote = "service Repo<T>"

func serviceGenericRecoveryChapter(t testing.TB) string {
	t.Helper()
	chapter := serviceKeyRecoveryChapter(t)
	if !strings.Contains(chapter, serviceGenericRecoveryQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceGenericRecoveryQuote)
	}
	return chapter
}

func TestServiceGenericRecoveryQuoted(t *testing.T) { serviceGenericRecoveryChapter(t) }

func FuzzServiceGenericWithRejectedMembers(f *testing.F) {
	startShortBudget(f)
	chapter := serviceGenericRecoveryChapter(f)
	type probe struct {
		key, source string
		wantKey     int
	}
	var probes []probe
	for _, shape := range []struct{ key, annotation string }{
		{"body", ""}, {"named", ": Shape"}, {"scalar", ": number"},
	} {
		for _, member := range []struct{ key, text string }{
			{"index", "[x: string]: unknown"}, {"constructor", "constructor() {}"},
			{"call", "(): number"}, {"getter", "get n() { return 1 }"}, {"method", "read() { return 1 }"},
		} {
			for _, mutable := range []bool{false, true} {
				key, label, wantKey := "static readonly key = \"generic/S\"", "literal", 0
				if mutable {
					key, label, wantKey = "static key = \"generic/S\"", "mutable", 1
				}
				name := shape.key + "/" + member.key + "/" + label
				source := "type Shape = number; export service S<T>" + shape.annotation + " { " + key + "; " + member.text + " }\n" +
					"export class Native<T> { static key = 7; constructor(public n: number) {}; get value() { return this.n } }\n" +
					"export const invalid: number = \"wrong\"\n"
				probes = append(probes, probe{name, source, wantKey})
				f.Add([]byte(name))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(probes)
		}
		for i, p := range probes {
			if string(data) == p.key {
				selected = i
				break
			}
		}
		p := probes[selected]
		source := p.source
		if len(data) > 1 && data[1]%2 == 1 {
			source = strings.ReplaceAll(source, "; ", ";\r\n")
		}
		if len(data) > 2 && data[2]%2 == 1 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		if len(data) > 3 && data[3]%2 == 1 {
			source = strings.ReplaceAll(source, "S<T>", "S<T = string>")
		}
		r, err := w.Compile(t.Context(), Project{
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		genericCode := servicesRuleDiagnostic(chapter, serviceGenericRecoveryQuote)
		memberCode := servicesRuleDiagnostic(chapter, serviceRejectedMemberQuote)
		keyCode := servicesRuleDiagnostic(chapter, keyErrorQuote)
		if genericCode == 0 || memberCode == 0 || keyCode == 0 {
			t.Fatal("chapter 5 service codes are missing")
		}
		got := map[int32]int{}
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && (d.Code() == genericCode || d.Code() == memberCode || d.Code() == keyCode) || !IsEK(d) && d.Code() == 2322 {
				got[d.Code()]++
			} else {
				t.Fatalf("%s: unexpected %s\n%s", p.key, d.String(), source)
			}
		}
		wantKinds := 3
		if p.wantKey != 0 {
			wantKinds++
		}
		if len(got) != wantKinds || got[genericCode] != 1 || got[memberCode] != 1 || got[keyCode] != p.wantKey || got[2322] != 1 {
			t.Fatalf("%s: want EK%04d, EK%04d, %d EK%04d and TS2322; got %v\n%s", p.key, genericCode, memberCode, p.wantKey, keyCode, got, source)
		}
	})
}
