package vibelang

import (
	"strings"
	"testing"
)

func TestFixRelicTypedTry(t *testing.T) {
	source := "error Missing\neffect function work(): number!Missing { throw new Missing() }\nexport effect function main() { try { return try work() } catch(e: Missing) { return 7 } }"
	result, name, _ := fixOnce(t, source)
	fixed := result.Files[name]
	if result.Err != nil || len(result.Refused) > 0 || fixed == nil || !strings.Contains(fixed.Text, "catch effect") || strings.Contains(fixed.Text, "try {") {
		t.Fatalf("missing Effect catch migration: %+v fixed %+v", result, fixed)
	}
}

func TestFixRelicFinallyExit(t *testing.T) {
	source := "export effect function main() { const events: string[]=[]; try { events.push(\"body\") } finally (observed) { events.push(observed._tag) }; return events }"
	result, name, _ := fixOnce(t, source)
	fixed := result.Files[name]
	if result.Err != nil || len(result.Refused) > 0 || fixed == nil || !strings.Contains(fixed.Text, "onExit") || strings.Contains(fixed.Text, "finally (") {
		t.Fatalf("missing onExit migration: %+v fixed %+v", result, fixed)
	}
}

func TestFixRelicTryRefusesBoundaryChanges(t *testing.T) {
	for _, source := range []string{
		"error Missing; export effect function main(){ try { return 7 } catch(e:Missing){ return 8 }; return 9 }",
		"export effect function main(){ try { return 7 } finally(exit) { return 8 } }",
		"export function main(){try{return 7}catch(e){return 8}}",
		"export effect function main(){const Effect={onExit:0};try{return 7}finally(exit){const tag=exit._tag}}",
	} {
		result, name, _ := fixOnce(t, source)
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		text := source
		if file := result.Files[name]; file != nil {
			text = file.Text
		}
		if strings.Contains(text, "catch effect") || strings.Contains(text, "Effect.onExit((") {
			t.Fatalf("moved an unsupported boundary: %s -> %s", source, text)
		}
	}
}
func TestFixRelicFinallyImportBoundaries(t *testing.T) {
	for _, prefix := range []string{"", "\ufeff", "#!/usr/bin/env vibelang\n"} {
		source := prefix + "\"use client\";\n/** keep docs */\nexport effect function main(){try{return 7}finally(observed){const tag=observed._tag}}"
		result, name, _ := fixOnce(t, source)
		fixed := result.Files[name]
		if result.Err != nil || len(result.Refused) > 0 || fixed == nil {
			t.Fatalf("missing migration: %+v", result)
		}
		if !strings.HasPrefix(strings.TrimPrefix(fixed.Text, "\ufeff"), strings.TrimPrefix(prefix, "\ufeff")+"\"use client\";") || !strings.Contains(fixed.Text, "/** keep docs */\nexport effect function main") {
			t.Fatalf("directive or declaration JSDoc moved: %s", fixed.Text)
		}
	}
	source := "export effect function one(){try{return 1}finally(exit){const tag=exit._tag}}\nexport effect function two(){try{return 2}finally(exit){const tag=exit._tag}}"
	result, name, _ := fixOnce(t, source)
	if result.Err != nil || len(result.Refused) > 0 || result.Files[name] == nil {
		t.Fatalf("multiple finalizers did not migrate safely: %+v", result)
	}
	source = "// @ts-nocheck\nexport effect function main(){try{return 7}finally(exit){}}"
	result, _, _ = fixOnce(t, source)
	if result.Err != nil || len(result.Files) > 0 {
		t.Fatalf("file directive moved: %+v", result)
	}
}

// The old try's discarded body result and a catch expression's success type
// differ here. A preserving codemod must refuse the inferred API change.
func TestFixRelicTryPreservesDeclarationBytes(t *testing.T) {
	source := "error Missing\nexport effect function main(flag:boolean){try{if(flag)throw new Missing()}catch(e:Missing){return 7}}"
	result, name, _ := fixOnce(t, source)
	if result.Err != nil || len(result.Refused) != 1 || !strings.Contains(result.Refused[0].Error, "declaration output changes") || result.Files[name] != nil {
		t.Fatalf("unsafe inferred API migration was offered: %+v fixed %+v", result, result.Files[name])
	}
}

func TestRelicTryMigrationLeavesNativeClauses(t *testing.T) {
	for _, source := range []string{
		"export effect function main(){try{return 7}catch(e){return 8}}",
		"export effect function main(){try{return 7}finally{const value=8}}",
	} {
		program, file, _, _ := editorProgram(t, source)
		proposed := relicTryStatementFixes(t.Context(), program, file, map[string]bool{})
		if len(proposed.fixes) != 0 {
			t.Fatalf("ordinary native statement claimed by retired-clause migration: %s", source)
		}
	}
}
