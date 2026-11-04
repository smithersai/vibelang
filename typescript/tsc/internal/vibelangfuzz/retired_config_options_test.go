package vibelangfuzz

import (
	stdjson "encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

var retiredConfigQuotes = []string{
	"root `vibelang.declarationImportStyle` and `compilerOptions.vibelang.declarationImportStyle` are ignored with nonfatal deprecation warning `EK3011` for every value, including invalid values",
	"The retired `trustedPackages` key is ignored in `vibe` and supported legacy sections, with warning `EK3010`: remove it.",
	"Npm functions follow the same foreign-callable contract as local TypeScript, including `unknown` without `@throws`; use a signature contract or an explicit `Effect.try` bridge",
}

func TestRetiredConfigOptionsQuoted(t *testing.T) {
	for _, quote := range retiredConfigQuotes {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatal(quote)
		}
	}
}

// Static VIP-30/VIP-4 oracle: generate arbitrary JSON values, both legacy
// paths, every config filename and inheritance. No compiler output defines
// the oracle: the quoted rules require warning-only, absent effective state.
func FuzzRetiredConfigOptions(f *testing.F) {
	startShortBudget(f)
	for i, value := range []string{`42`, `".js"`, `".ts"`, `"extensionless"`, `"bad"`, `null`, `false`, `[]`, `{}`, `["@scope/*"]`, `[false,"["]`, `{"nested":[null,42]}`} {
		f.Add("both", value, uint8(i))
	}
	f.Add("declarationImportStyle", `42`, uint8(0))
	f.Add("trustedPackages", `42`, uint8(1))
	f.Add("trustedPackages", `42`, uint8(64))
	f.Fuzz(func(t *testing.T, key, value string, variant uint8) {
		TestRetiredConfigOptionsQuoted(t)
		if len(value) > 4096 || !stdjson.Valid([]byte(value)) {
			return
		}
		keys := []string{key}
		if key != "declarationImportStyle" && key != "trustedPackages" {
			keys = []string{"declarationImportStyle", "trustedPackages"}
			key = "both"
		}
		var settings []string
		for _, k := range keys {
			settings = append(settings, fmt.Sprintf("%q:%s", k, value))
		}
		section := `"vibelang":{` + strings.Join(settings, ",") + `}`
		if variant&1 != 0 {
			section = `"compilerOptions":{` + section + `}`
		}
		name := []string{"tsconfig.json", "jsconfig.json", "vibe.config.json"}[int(variant>>1)%3]
		origin := "/p/" + name
		section += `,"vibe":{"effectGlobals":false}`
		if key == "trustedPackages" && variant&64 != 0 {
			section = `"vibe":{"trustedPackages":` + value + `,"effectGlobals":false}`
		}
		files := map[string]string{origin: `{` + section + `,"files":["main.ts"]}`, "/p/main.ts": "export const n=1"}
		if variant&8 != 0 {
			files["/p/base.json"] = files[origin]
			files[origin] = `{"extends":"./base.json","files":["main.ts"]}`
			origin = "/p/base.json"
		}
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, vfstest.FromMap(files, tspath.CaseSensitive), nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		ds := parsed.GetConfigFileParsingDiagnostics()
		if len(ds) != len(keys) {
			Gap(t, "FuzzRetiredConfigOptions", key, "VIP-30/VIP-4: want %d retirement warnings, got %v", len(keys), ds)
			return
		}
		for i, d := range ds {
			if d.Category() != diagnostics.CategoryWarning || !strings.Contains(d.String(), keys[i]) || !strings.Contains(d.String(), "ignored") || d.File() == nil || string(d.File().FileName()) != origin {
				Gap(t, "FuzzRetiredConfigOptions", key, "VIP-30/VIP-4: wrong warning: %s", d.String())
			}
		}
		o := parsed.CompilerOptions().VibeLang
		if o == nil || o.DeclarationImportStyle != "" || len(o.TrustedPackages) != 0 || !o.EffectGlobals.IsFalse() {
			Gap(t, "FuzzRetiredConfigOptions", key, "VIP-30/VIP-4: retired state retained or independent switch lost: %+v", o)
		}
		shown, err := json.Marshal(tsoptions.ConvertToTSConfig(parsed, tspath.RootedFilePath("/p/"+name)))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(shown), "declarationImportStyle") || strings.Contains(string(shown), "trustedPackages") {
			Gap(t, "FuzzRetiredConfigOptions", key, "VIP-30/VIP-4: retired keys serialized: %s", shown)
		}
	})
}

// The retired setting must never remove the foreign-call boundary or be offered
// as its repair. Vary package names, every supported section and malformed values.
func FuzzRetiredPackageTrustNotes(f *testing.F) {
	startShortBudget(f)
	sections := []string{"vibelang", "compilerOptions-vibelang", "vibe"}
	values := []string{"exact", "glob", "number", "null", "boolean", "string"}
	var keys []string
	for _, section := range sections {
		for _, value := range values {
			key := section + "-" + value
			keys = append(keys, key)
			f.Add(key, uint8(len(keys)-1))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestRetiredConfigOptionsQuoted(t)
		i := -1
		for index, candidate := range keys {
			if candidate == key {
				i = index
				break
			}
		}
		if i < 0 {
			i = int(variant) % len(keys)
			if key != "" {
				i = int(key[0]) % len(keys)
			}
		}
		key = keys[i]
		pkg := []string{"foreign", "@scope/foreign", "other-package", "@another/tool"}[int(variant>>3)%4]
		value := []any{[]string{pkg}, []string{"@scope/*", "*"}, 42, nil, false, "invalid"}[i%6]
		var config map[string]any
		if err := stdjson.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		options := config["compilerOptions"].(map[string]any)
		options["noEmit"] = true
		settings := map[string]any{"trustedPackages": value}
		switch i / 6 {
		case 0:
			config["vibelang"] = settings
		case 1:
			options["vibelang"] = settings
		case 2:
			config["vibe"] = settings
		}
		text, err := stdjson.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		r, err := w.Compile(t.Context(), Project{Config: string(text), Files: map[string]string{
			"main.vibe":                             fmt.Sprintf("import { risky } from %q; export effect function use() { return risky() }", pkg),
			"node_modules/" + pkg + "/package.json": fmt.Sprintf(`{"name":%q,"type":"module","types":"index.d.ts"}`, pkg),
			"node_modules/" + pkg + "/index.d.ts":   "export declare function risky(): number;",
		}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Code() == 403 {
				count++
				for _, note := range d.MessageChain() {
					if strings.Contains(note.String(), "trustedPackages") {
						Gap(t, "FuzzRetiredPackageTrustNotes", "note:"+key, "retired setting recommended as repair: %s", note.String())
					}
				}
			} else if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzRetiredPackageTrustNotes", "control:"+key, "unexpected diagnostic: %v", d)
			}
		}
		if count != 1 {
			Gap(t, "FuzzRetiredPackageTrustNotes", "boundary:"+key, "%q: want one EK0403 boundary, got %d: %v", retiredConfigQuotes[1], count, r.Diagnostics)
		}
		for _, kind := range []string{"note:", "control:", "boundary:"} {
			ExpectPending(t, "FuzzRetiredPackageTrustNotes", kind+key)
		}
		ExpectPending(t, "FuzzRetiredPackageTrustNotes", specCorpusKey(t))
	})
}
