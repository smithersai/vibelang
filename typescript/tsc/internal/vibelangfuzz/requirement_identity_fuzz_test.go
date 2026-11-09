package vibelangfuzz

import (
	"fmt"
	"strings"
)

const requirementIdentityTarget = "FuzzRequirementIdentity"

var requirementIdentityKeys = []string{"alias", "namespace", "collision", "two-services", "private", "generic", "local"}

// Mutate import style, exported/local names, same-name collisions, module
// specifiers, callable syntax and trivia. The oracle writes the source's bound
// service identity, not the compiler's context-free diagnostic display name.
func requirementIdentityProject(key string, data []byte) (map[string]string, string) {
	b := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	exported := []string{"Input", "Port", "Flags", "Café"}[int(b(0))%4]
	alias := []string{"Renamed", "Chosen", "Selected", "ServiceKey"}[int(b(1))%4]
	ext := []string{".js", ".vibe"}[int(b(2))%2]
	head := fmt.Sprintf("import {%s as %s} from \"./dep%s\";\n", exported, alias, ext)
	body, requirement := "(try "+alias+").value", alias
	// Stable written keys keep unrelated key-freezing passes out of this oracle.
	declaration := func(visibility, role string) string {
		return fmt.Sprintf("%sservice %s { static readonly key = %q; value: number }\n", visibility, exported, "requirements/"+role)
	}
	files := map[string]string{"dep.vibe": declaration("export ", "dep")}
	switch key {
	case "namespace":
		head = fmt.Sprintf("import * as %s from \"./dep%s\";\ntype %s = any;\n", alias, ext, exported)
		requirement = alias + "." + exported
		body = "(try " + requirement + ").value"
	case "collision":
		head += "type " + exported + " = " + []string{"any", "unknown", "object"}[int(b(3))%3] + ";\n"
	case "two-services":
		files["other.vibe"] = declaration("export ", "other")
		head += fmt.Sprintf("import {%s as Second} from \"./other%s\";\ntype %s = any;\n", exported, ext, exported)
		body += " + (try Second).value"
		requirement = "(" + alias + " | Second)"
	case "private":
		files["dep.vibe"] = declaration("", "dep") + "export const read = effect () => (try " + exported + ").value\n"
		head = fmt.Sprintf("import {read} from \"./dep%s\";\ntype %s = any;\n", ext, exported)
		body, requirement = "try read()", ""
	case "generic":
		head, body, requirement = "", "try p", "R"
	case "local":
		head, body, requirement = declaration("", "local"), "(try "+exported+").value", exported
	}
	params, generics := "", ""
	if key == "generic" {
		params, generics = "p: number!never!R", "<R>"
	}
	signature := "export effect function f" + generics + "(" + params + "): number!never"
	if b(4)%2 != 0 {
		signature = "export const f = effect " + generics + "(" + params + "): number!never =>"
	}
	source := head + signature + " { return " + body + " }\n"
	if b(5)%2 != 0 {
		source = "const café = \"😀\"; /* keep */\n" + source
	}
	// Keep both source and runtime specifier mutations valid while emitting.
	files["tsconfig.json"] = strings.Replace(DefaultConfig, `"sourceMap": true,`, `"sourceMap": true, "rewriteRelativeImportExtensions": true,`, 1)
	files["main.vibe"] = source
	want := ""
	if requirement != "" {
		want = strings.Replace(source, "): number!never", "): number!never!"+requirement, 1)
	}
	return files, want
}
