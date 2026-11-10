package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const rethrowsAliasTarget = "FuzzRethrowsAliasAdmission"

var rethrowsAliasQuotes = []string{
	"Tags attach to call signatures: each overload and a returned callable's own signature carry their own.",
	"a tag on an alias of a function type does not attach",
}

func assertRethrowsAliasQuotes(t testing.TB) {
	for _, quote := range rethrowsAliasQuotes {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("signature attachment rule changed: %s", quote)
		}
	}
}
func TestRethrowsAliasAdmissionQuoted(t *testing.T) { assertRethrowsAliasQuotes(t) }

type rethrowsAliasShape struct {
	name, declaration string
	admitting         bool
}

var rethrowsAliasShapes = []rethrowsAliasShape{
	{"untagged", "export type Invoke = (cb:()=>number)=>number\nexport declare const invoke:Invoke\n", false},
	{"alias", "/** @rethrows cb */\nexport type Invoke = (cb:()=>number)=>number\nexport declare const invoke:Invoke\n", false},
	{"parenthesized", "/** @rethrows cb */\nexport type Invoke = (((cb:()=>number)=>number))\nexport declare const invoke:Invoke\n", false},
	{"generic", "/** @rethrows cb */\nexport type Invoke = <T>(cb:()=>T)=>T\nexport declare const invoke:Invoke\n", false},
	{"own-never", "/** @throws {never} @rethrows cb */\nexport type Invoke = (cb:()=>number)=>number\nexport declare const invoke:Invoke\n", false},
	{"object-alias", "/** @rethrows cb */\nexport type Invoke = { (cb:()=>number):number }\nexport declare const invoke:Invoke\n", false},
	{"signature", "export type Invoke = {\n/** @throws {never} @rethrows cb */\n(cb:()=>number):number\n}\nexport declare const invoke:Invoke\n", true},
	{"declaration", "/** @throws {never} @rethrows cb */\nexport declare function invoke(cb:()=>number):number\n", true},
}

func rethrowsAliasKeys() []string {
	var keys []string
	for _, shape := range rethrowsAliasShapes {
		for _, site := range []string{"plain", "caught", "wrapped"} {
			keys = append(keys, shape.name+":"+site)
		}
	}
	return keys
}

func rethrowsAliasSource(key string, choice uint8) (string, string, int) {
	name, site, _ := strings.Cut(key, ":")
	var shape rethrowsAliasShape
	for _, candidate := range rethrowsAliasShapes {
		if candidate.name == name {
			shape = candidate
			break
		}
	}
	callback := "risky"
	prefix := ""
	switch choice % 5 {
	case 1:
		callback = "(risky)"
	case 2:
		prefix = "const selected=risky\n"
		callback = "selected"
	case 3:
		callback = "safe"
	case 4:
		callback = "overloaded"
	}
	call := "invoke(" + callback + ")"
	body := "return " + call
	if site == "caught" {
		body = "try{return " + call + "}catch{return 0}"
	}
	if site == "wrapped" {
		body = "return Effect.try(()=>" + call + ")"
	}
	source := "import {Effect} from \"effect\"\nimport {invoke,risky,safe,overloaded} from \"./foreign.js\"\n" + prefix + "export function main(){" + body + "}\n"
	library := "/** @throws {RangeError} */\nexport declare function risky():number\n/** @throws {never} */\nexport declare function safe():number\n/** @throws {RangeError} */\nexport declare function overloaded():number\n/** @throws {RangeError} */\nexport declare function overloaded(value?:number):number\n" + shape.declaration
	want := 0
	if choice%5 != 3 {
		if !shape.admitting {
			want = 402
		} else if site == "plain" {
			want = 401
		}
	}
	return source, library, want
}

func checkRethrowsAliasAdmission(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := rethrowsAliasSource(key, choice)
	extension := "d.ts"
	if choice&8 != 0 {
		extension = "ts"
	}
	files := map[string]string{"main.vibe": source, "foreign." + extension: library, "package.json": "{\"type\":\"module\"}"}
	config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"foreign." + extension + "\"]}"
	result, err := w.Compile(t.Context(), Project{Files: files, Config: config})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var got []int
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got = append(got, int(d.Code()))
		if !IsEK(d) || int(d.Code()) != want {
			Gap(t, rethrowsAliasTarget, key, "%q: unexpected %s", rethrowsAliasQuotes[1], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, rethrowsAliasTarget, key, "%q: got %v, want EK%04d", rethrowsAliasQuotes[0], got, want)
	}
	if choice%5 != 3 {
		ExpectPending(t, rethrowsAliasTarget, key)
	}

}
func TestRethrowsAliasAdmissionVariants(t *testing.T) {
	assertRethrowsAliasQuotes(t)
	w := NewWorkspace(t)
	for _, key := range rethrowsAliasKeys() {
		for choice := uint8(0); choice < 5; choice++ {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkRethrowsAliasAdmission(t, w, key, choice) })
		}
	}
}
func FuzzRethrowsAliasAdmission(f *testing.F) {
	startShortBudget(f)
	assertRethrowsAliasQuotes(f)
	keys := rethrowsAliasKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkRethrowsAliasAdmission(t, w, key, choice)
	})
}
