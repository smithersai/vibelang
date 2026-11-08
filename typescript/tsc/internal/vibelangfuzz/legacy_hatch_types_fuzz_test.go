package vibelangfuzz

import (
	"fmt"
	"maps"
	"strings"
)

func legacyHatchTypesProgram(key string, value int) (map[string]string, map[string]string) {
	parts := strings.Split(key, "/")
	name, shape := parts[0], parts[1]
	query := "typeof /* keep */ " + name
	call := fmt.Sprintf("run(%d)", value)
	if name == "callback" {
		call = fmt.Sprintf("run<number>((resume) => resume(%d))", value)
	}
	head := "import * as R from \"vibelang-runtime\"\n"
	binding := "const run: " + query + " = R[\"" + name + "\"]; "
	files := map[string]string{}
	switch shape {
	case "alias":
		binding = "type Run = " + query + "; const run: Run = R[\"" + name + "\"]; "
	case "parameter":
		binding = "export function use(run: " + query + ") { return " + call + " }"
		call = ""
	case "property":
		binding = "const box: { run: " + query + " } = { run: R[\"" + name + "\"] }; "
		call = strings.Replace(call, "run(", "box.run(", 1)
		call = strings.Replace(call, "run<number>", "box.run<number>", 1)
	case "factory":
		binding = "function factory(): " + query + " { return R[\"" + name + "\"] }; const run = factory(); "
	case "arrow-factory":
		binding = "const factory = (): " + query + " => R[\"" + name + "\"]; const run = factory(); "
	case "cross-file":
		files["api.vibe"] = head + "export type Run = " + query + "; export const run: Run = R[\"" + name + "\"];\n"
		head = "import { run } from \"./api.js\"\n"
		binding = ""
	case "instantiation":
		args := "<number, [number]>"
		call = fmt.Sprintf("run((n) => n + 1, %d)", value)
		if name == "callback" {
			args = "<number, never, [], never>"
			call = fmt.Sprintf("run((resume) => resume(%d))", value)
		}
		binding = "type Run = " + query + args + "; const run: Run = R[\"" + name + "\"]" + args + "; "
	}
	tail := ""
	if call != "" {
		tail = "export const value = " + call
	}
	files["main.vibe"] = head + binding + tail + "\n"
	reference := maps.Clone(files)
	for path, text := range reference {
		reference[path] = strings.ReplaceAll(text, query, "typeof /* keep */ import(\"vibelang-runtime\")."+name)
	}
	return files, reference
}
