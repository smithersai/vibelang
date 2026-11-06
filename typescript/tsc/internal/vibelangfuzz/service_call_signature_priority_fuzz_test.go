package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceCallSignaturePriorityQuoted(t *testing.T) { serviceGenericRecoveryChapter(t) }

func FuzzServiceCallSignaturePriority(f *testing.F) {
	startShortBudget(f)
	chapter := serviceGenericRecoveryChapter(f)
	type probe struct {
		key, annotation string
		generic         bool
		calls           int
	}
	var probes []probe
	for _, shape := range []struct{ key, text string }{{"body", ""}, {"named", ": Shape"}, {"scalar", ": number"}} {
		for _, generic := range []bool{false, true} {
			for _, calls := range []int{1, 2} {
				p := probe{fmt.Sprintf("%s/generic-%t/calls-%d", shape.key, generic, calls), shape.text, generic, calls}
				probes = append(probes, p)
				f.Add([]byte(p.key + "\x00\x00"))
				f.Add([]byte(p.key + "\x00\x07"))
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
		control := "type Shape=number; export service S" + p.annotation + " {static readonly key=\"priority/S\"}; export interface Callable {():number;(value:string):string}; export class Native<T> {constructor(public value:T){}}"
		if got := compile(control); len(got) != 0 {
			Gap(t, "FuzzServiceCallSignaturePriority", "control:"+p.key, "chapter 5: %s; valid control reports %v", serviceKeyRecoveryQuote, got)
			return
		}
		memberCode := servicesRuleDiagnostic(chapter, serviceRejectedMemberQuote)
		if memberCode == 0 {
			t.Fatal("chapter 5 member diagnostic missing")
		}
		want := map[int32]int{memberCode: p.calls, 2322: 1}
		header, key := "", "static readonly key"
		if p.generic {
			header = "<T>"
			want[servicesRuleDiagnostic(chapter, serviceGenericRecoveryQuote)] = 1
		}
		if variant&4 != 0 {
			key = "static key"
			want[servicesRuleDiagnostic(chapter, keyErrorQuote)] = 1
		}
		members := "():number;"
		if p.calls == 2 {
			members += "(value:string):string;"
		}
		source := "type Shape=number; export service S" + header + p.annotation + " {" + key + "=\"priority/S\";" + members + "};export const invalid:number=\"wrong\""
		if variant&1 != 0 {
			source = "// retained trivia\n" + strings.ReplaceAll(source, ";", ";\r\n")
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		got := compile(source)
		matches := len(got) == len(want)
		for code, count := range want {
			matches = matches && got[code] == count
		}
		if !matches {
			Gap(t, "FuzzServiceCallSignaturePriority", "count:"+p.key, "chapter 5: %s; want %v, got %v\n%s", serviceKeyRecoveryQuote, want, got, source)
			return
		}
		ExpectPending(t, "FuzzServiceCallSignaturePriority", "control:"+p.key)
		ExpectPending(t, "FuzzServiceCallSignaturePriority", "count:"+p.key)
		ExpectPending(t, "FuzzServiceCallSignaturePriority", specCorpusKey(t))
	})
}
