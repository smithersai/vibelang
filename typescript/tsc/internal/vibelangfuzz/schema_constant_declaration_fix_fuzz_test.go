package vibelangfuzz

import (
	"strings"
)

// Each seed is export:own:use:scope. Every value of each dimension appears,
// and every reference the declaration file prints meets a private constant.
var schemaConstantDeclarationSeeds = []string{
	"private:none:query:module",
	"private:none:helper:module",
	"private:none:value:module",
	"private:none:inferred:module",
	"private:none:local:module",
	"private:none:none:module",
	"private:alias:query:module",
	"private:none:query:namespace",
	"list:none:none:module",
	"renamed:none:value:module",
	"default:none:none:module",
	"exported:none:none:module",
	"exported:alias:helper:namespace",
	"list:alias:query:module",
}

var (
	schemaDeclExports = []string{"private", "exported", "list", "renamed", "default"}
	schemaDeclOwns    = []string{"none", "alias"}
	schemaDeclUses    = []string{"none", "value", "query", "helper", "inferred", "local"}
	schemaDeclScopes  = []string{"module", "namespace"}
)

type schemaConstantDeclaration struct{ export, own, use, scope string }

func (s schemaConstantDeclaration) key() string {
	return "schema-decl:" + s.export + ":" + s.own + ":" + s.use + ":" + s.scope
}

// module prints the module: a Schema.Struct constant Item, its own type, a
// reference to it and its export, at the top level or in namespace N.
func (s schemaConstantDeclaration) module() string {
	var lines []string
	constant := "const Item = Schema.Struct({ id: Schema.String })"
	alias := "type Item = typeof Item.Type"
	if s.export == "exported" {
		constant, alias = "export "+constant, "export "+alias
	}
	lines = append(lines, constant)
	if s.own == "alias" {
		lines = append(lines, alias)
	}
	switch s.use {
	case "value":
		lines = append(lines, "export const decodeItem = Schema.decodeUnknownSync(Item)")
	case "query":
		lines = append(lines, "export type ItemInput = typeof Item.Type")
	case "helper":
		lines = append(lines, "export interface Shape { readonly item?: Schema.Schema.Type<typeof Item> }")
	case "inferred":
		lines = append(lines, "export const Wrapped = Schema.Struct({ item: Item })")
	case "local":
		lines = append(lines, "export function itemId() {\n  type T = typeof Item.Type\n  const t: T = { id: \"a\" }\n  return t.id\n}")
	}
	switch s.export {
	case "list":
		lines = append(lines, "export { Item }")
	case "renamed":
		lines = append(lines, "export { Item as PublicItem }")
	case "default":
		lines = append(lines, "export default Item")
	}
	if s.use == "none" && s.export == "private" {
		lines = append(lines, "export const marker = 1")
	}
	body := strings.Join(lines, "\n") + "\n"
	if s.scope == "namespace" {
		body = "export namespace N {\n" + body + "}\n"
	}
	return body
}
