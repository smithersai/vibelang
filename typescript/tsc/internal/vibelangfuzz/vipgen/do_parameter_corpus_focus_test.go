package vipgen

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// An unterminated named key becomes an index seed, which can silently change
// its focus when the enabled registry changes. Check the actual corpus bytes.
func TestDoParameterNamedCorpusFocus(t *testing.T) {
	for _, home := range []string{"function", "arrow", "method"} {
		for _, form := range []string{"direct", "nested"} {
			t.Run(home+"/"+form, func(t *testing.T) {
				name := "r15-do-parameter-" + home + "-" + form
				data, err := os.ReadFile(filepath.Join("..", "testdata", "fuzz", "FuzzVIPDifferential", name))
				if err != nil {
					t.Fatal(err)
				}
				lines := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)
				if len(lines) != 2 || lines[0] != "go test fuzz v1" {
					t.Fatal("invalid corpus header")
				}
				value, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
				if err != nil {
					t.Fatal(err)
				}
				want := "vip02.do-parameter-return-" + home + "-" + form + "-plain"
				key, rest, named := NamedInput([]byte(value))
				if !named || key != want || len(rest) != 0 {
					t.Fatalf("want terminated key %s with no payload, got %q", want, value)
				}
				for _, leaveOut := range []map[string]bool{nil, {"vip01.effect-function": true}} {
					p := Generate([]byte(value), leaveOut)
					if p == nil || p.Focus != want {
						t.Fatalf("want focus %s, got %v", want, p)
					}
				}
			})
		}
	}
}
