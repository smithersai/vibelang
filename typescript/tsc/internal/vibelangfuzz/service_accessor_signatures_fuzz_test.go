package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceAccessorQuote = "a \x60get\x60 or \x60set\x60 accessor"

func serviceAccessorChapter(t testing.TB) string {
	t.Helper()
	chapter := serviceKeyRecoveryChapter(t)
	if !strings.Contains(chapter, serviceAccessorQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceAccessorQuote)
	}
	return chapter
}

func TestServiceAccessorSignaturesQuoted(t *testing.T) { serviceAccessorChapter(t) }

// FuzzServiceAccessorSignatures checks chapter 5's member table for bodyless
// accessors: each is one rejected member, with any class modifier, in a
// body-only service and under a written whole shape, and an independent error
// beside the service still reports.
func FuzzServiceAccessorSignatures(f *testing.F) {
	startShortBudget(f)
	chapter := serviceAccessorChapter(f)
	type probe struct {
		key, annotation, members string
		count                    int
	}
	var probes []probe
	for _, shape := range []struct{ key, text string }{{"body", ""}, {"named", ": Shape"}} {
		for _, modifier := range []struct{ key, text string }{{"plain", ""}, {"abstract", "abstract "}, {"private", "private "}, {"override", "override "}} {
			for _, accessor := range []struct {
				key     string
				members []string
			}{
				{"get", []string{"get value():number;"}},
				{"set", []string{"set value(next:number);"}},
				{"pair", []string{"get value():number;", "set value(next:number);"}},
			} {
				members := ""
				for _, member := range accessor.members {
					members += modifier.text + member
				}
				p := probe{shape.key + "/" + modifier.key + "/" + accessor.key, shape.text, members, len(accessor.members)}
				probes = append(probes, p)
				f.Add([]byte(p.key + "\x00\x00"))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(probes)
		}
		parts := strings.SplitN(string(data), "\x00", 2)
		for i, p := range probes {
			if parts[0] == p.key {
				selected = i
				break
			}
		}
		p := probes[selected]
		var variant byte
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		compile := func(source string) map[int32]int {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			got := map[int32]int{}
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
				}
			}
			return got
		}
		contracts := ""
		if p.annotation == "" {
			contracts = ";readonly value:number;get:number;set(next:number):void"
		}
		control := "type Shape={value:number}; export service S" + p.annotation + " {static readonly key=\"accessor/S\"" + contracts + "}; export interface Accessors {get value():number;set value(next:number)}; export abstract class Native {abstract get value():number; get other():number{return 1}}"
		if got := compile(control); len(got) != 0 {
			Gap(t, "FuzzServiceAccessorSignatures", "control:"+p.key, "chapter 5: %s; valid control reports %v", serviceAccessorQuote, got)
			return
		}
		memberCode := servicesRuleDiagnostic(chapter, serviceAccessorQuote)
		if memberCode == 0 {
			t.Fatal("chapter 5 member diagnostic missing")
		}
		want := map[int32]int{memberCode: p.count, 2322: 1}
		members := p.members
		if variant&8 != 0 {
			// Members are separated as in an interface: a comma ends one too.
			members = strings.ReplaceAll(members, ";", ",")
		}
		source := "type Shape={value:number}; export service S" + p.annotation + " {static readonly key=\"accessor/S\";" + members + "};export const invalid:number=\"wrong\""
		if variant&1 != 0 {
			source = "// retained trivia\n" + strings.ReplaceAll(source, ";", ";\r\n")
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		if variant&4 != 0 {
			source = strings.ReplaceAll(source, "value(", "value /* name */ (")
		}
		got := compile(source)
		matches := len(got) == len(want)
		for code, count := range want {
			matches = matches && got[code] == count
		}
		if !matches {
			Gap(t, "FuzzServiceAccessorSignatures", "count:"+p.key, "chapter 5: %s; %s; want %v, got %v\n%s", serviceAccessorQuote, serviceKeyRecoveryQuote, want, got, source)
			return
		}
		ExpectPending(t, "FuzzServiceAccessorSignatures", "control:"+p.key)
		ExpectPending(t, "FuzzServiceAccessorSignatures", "count:"+p.key)
		ExpectPending(t, "FuzzServiceAccessorSignatures", specCorpusKey(t))
	})
}
