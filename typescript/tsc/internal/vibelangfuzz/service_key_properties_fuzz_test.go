package vibelangfuzz

import (
	"context"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceKeyPropertiesTarget = "FuzzServiceKeyProperties"
const serviceKeyPropertiesQuote = "Class statics collide with member names: for a service with a member `name()`, `Users.name` could be `Function.name` or the shorthand."

func TestServiceKeyPropertiesQuoted(t *testing.T) {
	quote := serviceKeyPropertiesQuote
	if !strings.Contains(SpecText("../vips/0010-service-call-shorthand-denied.md"), quote) {
		t.Fatalf("VIP-10 no longer says %q", quote)
	}
}

var serviceKeyProperties = []struct {
	key, member, args, typ string
	code                   int32
}{
	{"key", "key", "", "string", 0},
	{"name", "name", "", "string", 0},
	{"length", "length", "", "number", 0},
	{"toString", "toString", "()", "string", 0},
	{"pipe", "pipe", "()", "typeof Users", 0},
	{"of", "of", "(null as unknown as Api)", "Api", 0},
	{"name-call", "name", "()", "", 2349},
	{"length-call", "length", "()", "", 2349},
	{"key-call", "key", "()", "", 2349},
}

func serviceKeyPropertyProgram(index int, choice uint8, native bool) string {
	form := serviceKeyProperties[index]
	prefix := "interface Api { key: number; name(): number; length(): number; pipe(): number; toString(): number; of(value: Api): number }\n"
	if native {
		prefix = "import { Context } from \"effect\"\n" + prefix + "class Users extends Context.Service<Users, Api>()(\"vip10/native-key\") {}\n"
	} else {
		prefix += "service Users: Api { static readonly key = \"vip10/native-key\" }\n"
	}
	receiver := "Users"
	if choice&1 != 0 {
		prefix += "const Alias = Users\n"
		receiver = "Alias"
	}
	access := receiver + "." + form.member
	switch (choice >> 1) % 4 {
	case 1:
		access = receiver + "[\"" + form.member + "\"]"
	case 2:
		access = "(" + receiver + ")." + form.member
	case 3:
		access = receiver + "?." + form.member
	}
	body := "return " + access + form.args
	if form.typ != "" {
		body = "const value: " + form.typ + " = " + access + form.args + "; return value"
	}
	kind := "effect "
	if native {
		kind = ""
	}
	return prefix + "export " + kind + "function probe() { " + body + " }\n"
}

// Native positive controls independently check each asserted key-property
// type against the pinned Context.Service, using the stock TypeScript compiler.
func TestServiceKeyPropertiesNativeControls(t *testing.T) {
	TestServiceKeyPropertiesQuoted(t)
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	files := map[string]string{}
	for i, form := range serviceKeyProperties {
		if form.code == 0 {
			files["native-"+form.key+".ts"] = serviceKeyPropertyProgram(i, 0, true)
		}
	}
	dir, err := w.writeProject(Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("native key property controls: %v\n%s", err, output)
	}
}

func FuzzServiceKeyProperties(f *testing.F) {
	startShortBudget(f)
	for _, form := range serviceKeyProperties {
		f.Add(form.key, uint8(0))
	}
	for _, choice := range []uint8{1, 2, 4, 6, 7} {
		f.Add("name", choice)
		f.Add("toString", choice)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		TestServiceKeyPropertiesQuoted(t)
		index := slices.IndexFunc(serviceKeyProperties, func(form struct {
			key, member, args, typ string
			code                   int32
		}) bool {
			return form.key == key
		})
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(serviceKeyProperties)
		}
		form := serviceKeyProperties[index]
		source := serviceKeyPropertyProgram(index, choice, false)
		result := toolsCompile(t, w, serviceKeyPropertiesTarget, map[string]string{"main.vibe": source})
		defer result.Remove()
		var codes []int32
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		want := []int32(nil)
		if form.code != 0 {
			want = []int32{form.code}
		}
		if !slices.Equal(codes, want) {
			Gap(t, serviceKeyPropertiesTarget, "native-property:"+form.key, "VIP-10: key properties keep native types; want %v, got %v\n%s\n%v", want, codes, source, result.Diagnostics)
		}
	})
}
