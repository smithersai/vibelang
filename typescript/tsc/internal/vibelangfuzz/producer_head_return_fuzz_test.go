package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

const producerHeadReturnTarget = "FuzzProducerHeadReturn"
const producerHeadReturnQuote = "A producer permits bare `return`, but `return value` is `EK2128`"
const producerHeadGapQuote = "ordinary placement and early-error rules still apply"

func TestProducerHeadReturnQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerHeadReturnQuote)
	chapterSays(t, "900-appendices.md", producerHeadGapQuote)
}

// A return in a do expression returns from the function around it, so a
// valued return in a producer is EK2128 in every position a do expression can
// stand, including the definition-time positions the compiler still compiles
// to a function (computed member names, heritage clauses, decorators), where
// it used to report the compiler-gap EK0204 instead. Each input names a host
// function, a position and a jump; its tail picks the returned value. A
// producer host with a valued return reports EK2128 once and no EK0204. A
// bare return, a return owned by a written arrow or an effect block, and
// every host that is no producer report no EK2128.
func FuzzProducerHeadReturn(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", producerHeadReturnQuote)
	chapterSays(f, "900-appendices.md", producerHeadGapQuote)
	hosts := []struct {
		key, text string
		producer  bool
	}{
		{"declaration", "export effect function* host() { $site }", true},
		{"expression", "export const host = effect function* () { $site }", true},
		{"method", "export class Host { effect *host() { $site } }", true},
		{"effect-function", "export effect function host() { $site }", false},
		{"generator", "export function* host() { $site }", false},
		{"async-generator", "export async function* host() { $site }", false},
		{"function", "export function host() { $site }", false},
	}
	heads := []struct{ key, text string }{
		{"method-key", "class C { [$do]() {} }"},
		{"static-method-key", "class C { static [$do]() {} }"},
		{"getter-key", "class C { get [$do]() { return 0 } }"},
		{"setter-key", "class C { set [$do](n: number) {} }"},
		{"field-key", "class C { [$do] = 0 }"},
		{"heritage", "class C extends $do {}"},
		{"class-decorator", "@($do) class C {}"},
		{"method-decorator", "class C { @($do) m() {} }"},
		{"field-decorator", "class C { @($do) n = 0 }"},
		{"getter-decorator", "class C { @($do) get n() { return 0 } }"},
		{"setter-decorator", "class C { @($do) set n(n: number) {} }"},
		{"object-method", "const o = { [$do]() {} }"},
		{"object-getter", "const o = { get [$do]() { return 0 } }"},
		{"object-setter", "const o = { set [$do](n: number) {} }"},
		{"object-key", "const o = { [$do]: 0 }"},
		{"statement", "const v = $do"},
	}
	jumps := []struct {
		key, text string
		valued    bool
	}{
		{"valued", "return $value;", true},
		{"guarded", "if (flag) return $value;", true},
		{"nested", "{ { return $value } }", true},
		{"bare", "if (flag) return;", false},
		{"arrow", "const f = () => { return $value }; f;", false},
		{"effect-block", "const e = effect { return $value }; e;", false},
	}
	values := []string{"\"m\"", "key", "pick()"}
	type site struct{ host, head, jump int }
	var sites []site
	var keys []string
	for h, host := range hosts {
		for d, head := range heads {
			for j, jump := range jumps {
				sites = append(sites, site{h, d, j})
				keys = append(keys, host.key+"-"+head.key+"-"+jump.key)
			}
		}
	}
	// Seeds: every position under a producer declaration, then every host
	// and every jump at one retained and one lowered position.
	for _, head := range heads {
		f.Add([]byte("declaration-" + head.key + "-valued"))
	}
	for _, head := range []string{"method-key", "statement"} {
		for _, host := range hosts[1:] {
			f.Add([]byte(host.key + "-" + head + "-valued"))
		}
		for _, jump := range jumps[1:] {
			f.Add([]byte("declaration-" + head + "-" + jump.key))
		}
	}
	f.Add([]byte("method-heritage-guarded:\x01"))
	f.Add([]byte("expression-class-decorator-nested:\x02"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, tail := keyedChoice(keys, data)
		s := sites[choice]
		host, head, jump := hosts[s.host], heads[s.head], jumps[s.jump]
		value := values[0]
		if len(tail) > 0 {
			value = values[int(tail[0])%len(values)]
		}
		block := "do { " + strings.ReplaceAll(jump.text, "$value", value) + " " + value + " }"
		source := "import { Effect } from \"effect\";\n" +
			"const key = \"m\" as const;\nconst flag = true as boolean;\n" +
			"/** @throws {never} */\nfunction pick() { return \"m\" as const }\n" +
			strings.ReplaceAll(host.text, "$site", strings.ReplaceAll(head.text, "$do", block))
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := map[int32]int{}
		for _, d := range r.Diagnostics {
			if IsEK(d) {
				got[d.Code()]++
			}
		}
		key := "rule:" + keys[choice]
		switch {
		case host.producer && jump.valued:
			if got[2128] != 1 || got[204] != 0 {
				Gap(t, producerHeadReturnTarget, key, "%s; %s; want EK2128 x1 and no EK0204, got EK2128 x%d, EK0204 x%d\n%s\n%v", producerHeadReturnQuote, producerHeadGapQuote, got[2128], got[204], source, Keys(r.Dir, r.Diagnostics))
			}
		case got[2128] != 0:
			Gap(t, producerHeadReturnTarget, key, "%s; no producer returns a value here, got EK2128 x%d\n%s\n%v", producerHeadReturnQuote, got[2128], source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, producerHeadReturnTarget, key)
		ExpectPending(t, producerHeadReturnTarget, specCorpusKey(t))
	})
}
