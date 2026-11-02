package vibelangfmt

import (
	"strings"
	"testing"
)

// Chapter 007's format-preservation rule and EmptyStatement's empty completion:
// inserting an ASI prefix must not alter the lowered do's completion writes.
func TestSameProgramDoEmptyCompletion(t *testing.T) {
	for _, source := range []string{
		"function f() { return do { read(); /*tail*/ [1] } }",
		"function f() { return do { read = 1; /*tail*/ [1] } }",
		"function f() { return do { var x = 1; read = x; /*tail*/ [1] } }",
		"function f() { for (const x of do { read = () => x; /*tail*/ [1] }) {} }",
		"function f() { for (let [x] of do { read = () => x; /*tail*/ [[1]] }) {} }",
		"function f() { for (const x in do { read = () => x; /*tail*/ ({ key: 1 }) }) {} }",
	} {
		for _, prefix := range []string{";", ";;", "; ; ;"} {
			after := strings.Replace(source, "/*tail*/", prefix+"/*tail*/", 1)
			if err := SameProgram(source, after); err != nil {
				t.Errorf("%s\n%s\n%v", source, after, err)
			}
		}
	}
	before := "function f() { return do { read = 1; [1] } }"
	after := strings.Replace(before, "read = 1", "read = 2", 1)
	if err := SameProgram(before, after); err == nil {
		t.Fatal("a real assignment change must still be refused")
	}
}
