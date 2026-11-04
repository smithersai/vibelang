package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const classCallbackQuote = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and \x60implements\x60, with \x60service\x60 members as interface members."

var classCallbackSources = []string{"never", "TypeError", "Error", "unknown", "JSON.parse", "decodeURI", "decodeURIComponent", "BigInt"}
var classCallbackBounds = []string{"untagged", "Error", "unknown"}
var classCallbackMembers = []string{"field", "getter", "inherited"}

type classCallbackVariant struct {
	source, bound, member int
	expression, alias     bool
}

func (v classCallbackVariant) name() string {
	syntax, reference := "declaration", "direct"
	if v.expression {
		syntax = "expression"
	}
	if v.alias {
		reference = "alias"
	}
	return fmt.Sprintf("%s/to-%s/%s/%s/%s", classCallbackSources[v.source], classCallbackBounds[v.bound], classCallbackMembers[v.member], syntax, reference)
}
func classCallbackVariants() ([]classCallbackVariant, []string) {
	var variants []classCallbackVariant
	var names []string
	for source := range classCallbackSources {
		for bound := range classCallbackBounds {
			for member := range classCallbackMembers {
				limit := 2
				if source >= 4 {
					limit = 1
				}
				for expression := 0; expression < limit; expression++ {
					for alias := 0; alias < limit; alias++ {
						v := classCallbackVariant{source, bound, member, expression == 1, alias == 1}
						variants = append(variants, v)
						names = append(names, v.name())
					}
				}
			}
		}
	}
	return variants, names
}
func TestClassCallbackContractsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", classCallbackQuote)
}
func TestClassCallbackContractKeys(t *testing.T) {
	_, names := classCallbackVariants()
	if len(names) != 180 {
		t.Fatalf("got %d keys, want 180", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzClassCallbackContracts", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key %s", p)
		}
	}
}
func FuzzClassCallbackContracts(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", classCallbackQuote)
	variants, names := classCallbackVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		bound := ""
		if v.bound != 0 {
			bound = fmt.Sprintf(" /** @throws {%s} */\n", classCallbackBounds[v.bound])
		}
		helpers := "export interface API {\n" + bound + " run(text:string):unknown\n}\n"
		if v.source < 4 {
			tag := fmt.Sprintf("/** @throws {%s} */\n", classCallbackSources[v.source])
			helpers += tag + "export declare function source(text:string):unknown\nexport declare class Base {\n" + tag + "run(text:string):unknown\n}\n"
		} else {
			builtin := classCallbackSources[v.source]
			helpers += "export declare const source:typeof " + builtin + "\nexport declare class Base {run:typeof " + builtin + "}\n"
		}
		value, parent := "source", "Base"
		prefix := ""
		if v.alias {
			if v.member == 2 {
				prefix = "const Parent=Base;\n"
				parent = "Parent"
			} else {
				prefix = "const value=source;\n"
				value = "value"
			}
		}
		body := ""
		switch v.member {
		case 0:
			body = "run=" + value
		case 1:
			body = "get run(){return " + value + "}"
		}
		heritage := "implements API"
		if v.member == 2 {
			heritage = "extends " + parent + " implements API"
		}
		declaration := "export class Box " + heritage + " {" + body + "}\n"
		if v.expression {
			declaration = "export const Box=class " + heritage + " {" + body + "}\n"
		}
		main := "import {source,Base,type API} from \"./helpers.js\"\n" + prefix + declaration
		files := map[string]string{"main.vibe": main, "helpers.d.ts": helpers}
		config := strings.Replace(DefaultConfig, "\"target\": \"ES2022\",", "\"target\": \"ES2022\", \"lib\":[\"esnext\",\"dom\"],", 1)
		config = strings.TrimSuffix(config, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := v.source != 0 && (v.bound == 0 || v.source == 3 && v.bound == 1)
		if len(errs) > 1 || len(errs) == 1 && errs[0] != "EK0402" || (len(errs) == 1) != want {
			Gap(t, "FuzzClassCallbackContracts", "contract:"+v.name(), "003-failures: %s; key %s got %v, want EK0402=%t\n%s", classCallbackQuote, v.name(), errs, want, Archive(files))
		}
	})
}
