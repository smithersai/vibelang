package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

// Output paths are a static VIP-39 rule. Compare identical .tsx/.vibex inputs;
// neither oracle depends on how the current compiler names .vibex output.
func TestVibexOutputSuffixQuoted(t *testing.T) {
	chapter := SpecText("../vips/0039-vibex.md")
	for _, quote := range []string{
		"`x.vibex` emits `x.jsx` under `\"jsx\": \"preserve\"` and `x.js` otherwise (`react-native` keeps JSX in `x.js`), as `x.tsx` does.",
		"`x.vibex` writes the public `x.d.ts` to `outDir`",
		"`x.js.map`/`x.jsx.map` and `x.d.ts.map` name `x.vibex`",
		"Renaming `x.tsx` to `x.vibex` changes nothing in its JSX",
	} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("VIP-39 output rule changed: %s", quote)
		}
	}
}

func FuzzVibexOutputSuffix(f *testing.F) {
	startShortBudget(f)
	shapes := []string{"plain", "intrinsic", "component", "fragment"}
	modes := []string{"preserve", "react-native", "react"}
	for _, shape := range shapes {
		for _, mode := range modes {
			f.Add(shape, mode, uint8(0))
			f.Add(shape, mode, uint8(7))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape, mode string, variant uint8) {
		TestVibexOutputSuffixQuoted(t)
		if !slices.Contains(shapes, shape) {
			if shape == "" {
				return
			}
			shape = shapes[int(shape[0])%len(shapes)]
		}
		if !slices.Contains(modes, mode) {
			if mode == "" {
				return
			}
			mode = modes[int(mode[0])%len(modes)]
		}
		value := fmt.Sprint(variant)
		expression := value
		switch shape {
		case "intrinsic":
			expression = "<div title={" + value + "}><span /></div>"
		case "component":
			expression = "<Box value={" + value + "} />"
		case "fragment":
			expression = "<><div />{" + value + "}</>"
		}
		source := "declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }\n" +
			"declare function h(...args: any[]): any;\ndeclare function Fragment(...args: any[]): any;\n" +
			"declare function Box(props: { value: number }): any;\nexport const element = " + expression + ";\n"
		stem := "main"
		if variant&1 != 0 {
			stem = "src/nested/main"
		}
		suffix := ".js"
		if mode == "preserve" {
			suffix = ".jsx"
		}
		var nativePreserves bool
		for _, ext := range []string{".tsx", ".vibex"} {
			file := stem + ext
			opts := map[string]any{
				"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
				"strict": true, "types": []string{}, "skipLibCheck": true,
				"jsx": mode, "jsxFactory": "h", "jsxFragmentFactory": "Fragment",
				"rootDir": ".", "outDir": "out", "sourceMap": true,
				"declaration": variant&2 != 0, "declarationMap": variant&2 != 0,
			}
			if variant&6 == 6 {
				opts["declarationDir"] = "types"
			}
			config, err := json.Marshal(map[string]any{"compilerOptions": opts, "files": []string{file}})
			if err != nil {
				t.Fatal(err)
			}
			var result *Result
			within(t, "check vibex output suffix", func() {
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}, Config: string(config)})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if codes := vibexNativeCodes(result); len(codes) != 0 {
				Gap(t, "FuzzVibexOutputSuffix", shape+":"+mode, "VIP-39: valid %s control has errors %v", ext, codes)
			}
			find := func(path string) string {
				for name, text := range result.Outputs {
					if strings.HasSuffix("/"+name, "/"+path) {
						return text
					}
				}
				return ""
			}
			output := find("out/" + stem + suffix)
			if output == "" {
				Gap(t, "FuzzVibexOutputSuffix", shape+":"+mode, "VIP-39: %s requires out/%s%s", file, stem, suffix)
			}
			opposite := ".js"
			if suffix == ".js" {
				opposite = ".jsx"
			}
			if find("out/"+stem+opposite) != "" {
				Gap(t, "FuzzVibexOutputSuffix", shape+":"+mode+":suffix", "%s emitted unexpected %s", file, opposite)
			}
			var sm struct {
				File    string
				Sources []string
			}
			if err := json.Unmarshal([]byte(find("out/"+stem+suffix+".map")), &sm); err != nil {
				Gap(t, "FuzzVibexOutputSuffix", shape+":"+mode+":source-map", "%s: invalid source map: %v", file, err)
			}
			if sm.File != "main"+suffix || !slices.ContainsFunc(sm.Sources, func(s string) bool { return strings.HasSuffix(s, stem+ext) }) {
				Gap(t, "FuzzVibexOutputSuffix", shape+":"+mode+":source-map", "%s: map names wrong output/source: %+v", file, sm)
			}
			preserves := strings.Contains(output, "<div") || strings.Contains(output, "<Box") || strings.Contains(output, "<>")
			if ext == ".tsx" {
				nativePreserves = preserves
			} else if preserves != nativePreserves {
				Gap(t, "FuzzVibexOutputSuffix", shape+":"+mode+":jsx", "VIP-39: JSX preservation differs from native TSX")
			}
			if variant&2 != 0 {
				dir := "out"
				if variant&4 != 0 {
					dir = "types"
				}
				if find(dir+"/"+stem+".d.ts") == "" || find(dir+"/"+stem+".d.ts.map") == "" {
					Gap(t, "FuzzVibexOutputSuffix", shape+":"+mode+":declaration", "%s: missing declaration or declaration map", file)
				}
			}
		}
	})
}
