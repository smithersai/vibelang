package vibelang

import (
	"fmt"
	"testing"
)

// A pattern binding adds cells to the loop head, preserving the source const
// declaration's native checks through each BindingElement (VIP-7).
func TestForHeadConstDestructuring(t *testing.T) {
	for _, row := range []struct{ key, pattern, value, binding string }{
		{"object", "{n}", "{n:1}", "n"},
		{"array", "[n]", "[1]", "n"},
		{"renamed", "{a:n}", "{a:1}", "n"},
		{"nested", "{a:{n}}", "{a:{n:1}}", "n"},
		{"rest", "{...rest}", "{n:1}", "rest"},
	} {
		writes := []string{row.binding + "=2", row.binding + "+=2", row.binding + "++"}
		if row.key == "rest" {
			writes = []string{"rest={n:2}"}
		}
		for _, write := range writes {
			for _, word := range []string{"const", "let"} {
				for _, home := range []string{"test", "update", "init"} {
					t.Run(row.key+"/"+write+"/"+word+"/"+home, func(t *testing.T) {
						init, test, update := word+" "+row.pattern+"="+row.value, "(1 is let cell)", ""
						if home == "update" {
							test, update = "true", "(1 is let cell)"
						}
						if home == "init" {
							init += ",ready=(1 is let cell)"
							test = "ready"
						}
						source := fmt.Sprintf("export function f(){for(%s;%s;%s){%s;return %s}}", init, test, update, write, row.binding)
						ds := errorsOf(t, source)
						expected := 0
						if word == "const" {
							expected = 1
						}
						if len(ds) != expected || expected == 1 && ds[0].Code() != 2588 {
							t.Fatalf("want %d TS2588, got %v\\n%s", expected, ds, source)
						}
					})
				}
			}
		}
	}
	for _, source := range []string{
		"export function f(){for(const {item}={item:{n:1}};(1 is let cell);){item.n=2;return item.n}}",
		"export function f(){for(const {n}={n:1};(1 is let cell);){let n=1;n=2;return n}}",
		"export function f(){for(const {n}={n:1};(1 is let cell);){return ((n:number)=>{n=2;return n})(1)}}",
	} {
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Fatalf("control: %v\\n%s", ds, source)
		}
	}
}
