package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestErrorClassMatcherFixQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", nativeErrorClassFixQuote)
	chapterSays(t, "004-match.md", "It returns `[subject]` on a match and `false` otherwise")
}

// Mutate member shape, payload type and generated-import collisions. The
// oracle is the error declaration's own matcher and its original subject,
// together with native class fallback after deleting that own property.
func FuzzErrorClassMatcherFix(f *testing.F) {
	startShortBudget(f)
	keys := []string{"field", "method", "getter", "setter"}
	for _, key := range keys {
		for _, suffix := range []string{"0", "3"} {
			f.Add([]byte(key + ":" + suffix))
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(f, "%v", err)
	}
	defer node.Close()
	f.Fuzz(func(t *testing.T, data []byte) {
		TestErrorClassMatcherFixQuoted(t)
		const target = "FuzzErrorClassMatcherFix"
		defer recoverCompilerPanic(t, target)
		key, suffix, _ := strings.Cut(string(data), ":")
		n := byte(0)
		for _, b := range []byte(suffix) {
			n ^= b
		}
		known := false
		for _, k := range keys {
			if k == key {
				known = true
			}
		}
		if !known {
			if len(data) != 0 {
				n = data[0]
			}
			key = keys[int(n)%len(keys)]
		}
		member := "static meta = 1"
		switch key {
		case "method":
			member = "static meta() { return 1 }"
		case "getter":
			member = "static get meta() { return 1 }"
		case "setter":
			member = "static set meta(value: number) {}"
		}
		prefix, field := "", "string"
		if n&1 != 0 {
			prefix = "const $ErrorTaggedError=1; const $ErrorMatcher=2; const $ErrorMatcher2=3;\n"
		}
		if n&2 != 0 {
			field = "number"
		}
		source := prefix + fmt.Sprintf("export error E { id: %s; %s }\n", field, member)
		before, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		eligible := false
		for _, d := range before.Diagnostics {
			if d.Code() == 1302 {
				eligible = true
			}
		}
		if !eligible {
			Gap(t, target, "diagnostic:"+key, "missing static-member diagnostic: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		text := ""
		for path, file := range fixed.Files {
			if filepath.Base(path.AsString()) == "main.vibe" {
				text = file.Text
			}
		}
		if text == "" {
			Gap(t, target, "rewrite:"+key, "no class repair; refused=%v", fixed.Refused)
		}
		after, err := w.Compile(t.Context(), Single(text+"\n"+errorClassMatcherFixProbe))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if HasError(after.Diagnostics) {
			Gap(t, target, "compile:"+key, "class repair rejected: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
		got := node.Run(after, "out/main.js", "main")
		if got.Kind != "success" || string(got.Value) != "[true,true,true,false,true]" {
			Gap(t, target, "own-matcher:"+key, "class repair lost own matcher, original subject or native fallback: kind=%s value=%s", got.Kind, string(got.Value))
		}
	})
}

const errorClassMatcherFixProbe = "import {Effect} from \"effect\"\nexport function main(){\n const key=(Symbol as any).customMatcher ?? Symbol.for(\"Symbol.customMatcher\")\n const copy:unknown={_tag:\"E\"}\n if(!Object.hasOwn(E,key))return Effect.succeed([\"missing-own\"])\n const method=Reflect.get(E,key)\n const result=Reflect.apply(method,undefined,[copy,{matchType:\"extractor\"}])\n function matches(value:unknown){return match(value){when E:true;default:false;}}\n const before=matches(copy)\n Reflect.deleteProperty(E,key)\n const removed=matches(copy)\n Reflect.defineProperty(E,key,{value:method,writable:true,configurable:true})\n return Effect.succeed([Object.hasOwn(E,key),Array.isArray(result)&&result[0]===copy,before,removed,matches(copy)])\n}\n"
