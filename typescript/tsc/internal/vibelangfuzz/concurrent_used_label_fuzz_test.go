package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

const concurrentUsedLabelQuote = "Its names and jumps mean what they mean in the source, as ECMAScript defines them:"

func TestConcurrentUsedLabelQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentUsedLabelQuote)
}

func FuzzConcurrentUsedLabel(f *testing.F) {
	startShortBudget(f)
	variants := []struct {
		key, body string
		chain     bool
		unused    int
	}{
		{"direct", "if(x===1)continue LABEL;void x", false, 0},
		{"native-loop", "for(const y of [1]){if(x===1)continue LABEL;void y}", false, 0},
		{"switch", "switch(x){case 1:continue LABEL;default:break}", false, 0},
		{"mask", "uninterruptible{if(x===1)continue LABEL}", false, 0},
		{"do", "const v=do {if(x===1)continue LABEL;7};void v", false, 0},
		{"match", "const v=match(x){when 1:do {continue LABEL};default:7;};void v", false, 0},
		{"local-loop", "local:for(const y of [1]){continue local};if(x===1)continue LABEL", false, 0},
		{"unused", "void x", false, 1},
		{"written-function", "function f(){LABEL:for(const y of [1]){continue LABEL}}", false, 1},
		{"chain-both", "if(x===1)continue LABEL;if(x===2)continue ALIAS", true, 0},
		{"chain-first", "if(x===1)continue LABEL", true, 1},
		{"chain-second", "if(x===1)continue ALIAS", true, 1},
		{"chain-neither", "void x", true, 2},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte("key:" + v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestConcurrentUsedLabelQuoted(t)
		v := variants[r3Pick(data, keys)]
		n := 0
		if len(data) > 0 {
			n = int(data[len(data)-1])
		}
		label := []string{"item", "next", "loop"}[n%3]
		alias := "extra"
		labels := label + ":"
		if v.chain {
			labels += alias + ":"
		}
		limit := []string{"", "(1)", "(2)", "(\"unbounded\")"}[(n/3)%4]
		body := strings.NewReplacer("LABEL", label, "ALIAS", alias).Replace(v.body)
		source := fmt.Sprintf("export effect function main(){%s for concurrent%s(const x of [1,2,3]){%s};return 7}", labels, limit, body)
		var config map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		config["compilerOptions"].(map[string]any)["allowUnusedLabels"] = false
		config["files"] = []string{"main.vibe"}
		raw, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		project := Single(source)
		project.Config = string(raw)
		r, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := r3Errors(r.Diagnostics)
		want := make([]string, v.unused)
		for i := range want {
			want[i] = "TS7028"
		}
		if !slices.Equal(got, want) {
			Gap(t, "FuzzConcurrentUsedLabel", "usage:"+v.key, "chapter 2 says %q; with allowUnusedLabels false expected %v, got %v\n%s", concurrentUsedLabelQuote, want, got, source)
		}
	})
}
