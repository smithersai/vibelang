package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestIsDollarBindingNames(t *testing.T) {
	for _, name := range []string{"$id", "$$id", "$match1", "$is1", "$extracted2", `$\u0069d`} {
		for _, binding := range []string{"let", "const"} {
			for _, form := range []string{"if", "return", "arrow", "shorthand"} {
				t.Run(name+"/"+binding+"/"+form, func(t *testing.T) {
					written := strings.ReplaceAll(name, `\u0069`, "i")
					pattern := "{id:" + binding + " " + name + "}"
					subject := "({id:7})"
					if form == "shorthand" {
						pattern = "{" + binding + " " + name + "}"
						subject = "({" + name + ":7})"
					}
					body := "if (" + subject + " is " + pattern + ") return " + written + "; return 0"
					source := "export function f():unknown { " + body + " }"
					if form == "return" {
						source = "export function f():boolean { return " + subject + " is " + pattern + " }"
					}
					if form == "arrow" {
						source = "export const f = ():boolean => " + subject + " is " + pattern
					}
					if ds := errorsOf(t, source); len(ds) != 0 {
						t.Fatalf("source reports %v\n%s", ds, source)
					}
				})
			}
		}
	}
}

func TestIsDollarBindingConst(t *testing.T) {
	for _, binding := range []string{"let", "const"} {
		source := fmt.Sprintf("export function f(x:unknown):unknown { if (x is {id:%s $id}) { $id=2; return $id }; return 0 }", binding)
		ds := errorsOf(t, source)
		if binding == "const" {
			found := false
			for _, d := range ds {
				if d.Code() == 2588 {
					found = true
				} else {
					t.Errorf("unexpected const diagnostic: %s", d.String())
				}
			}
			if !found {
				t.Fatalf("const assignment: %v", ds)
			}
		} else if len(ds) != 0 {
			t.Fatalf("let assignment: %v", ds)
		}
	}
}
