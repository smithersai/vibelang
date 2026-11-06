#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadRows } from "./generate-grammar-admission.mjs"

export const wholeShapeProduction = 'ServiceStart TypeParameters? ":" Type "{" (ServiceMember Separator)* "}"'
const wholeShapeHook = "parser/vibelang_service_type.go:Parser.parseServiceShapeDeclaration"

// VIP-9's accepted whole-shape amendment and Appendix A grant this form.
// A census may retain separate recovery gaps without denying that authority.
export function checkAdoptedServiceShape(rows, appendix) {
  const problems = []
  if (!appendix.includes(wholeShapeProduction))
    problems.push("ServiceDeclaration's whole-shape production changed; review its census authority.")
  const shape = rows.find(row => row.hook === wholeShapeHook)
  if (!shape) problems.push("The whole-shape service parser has no census row.")
  else {
    const authority = shape.authority.split(",").map(ref => ref.trim())
    if (!authority.some(ref => ref === "900-appendices.md#ServiceDeclaration" || /^005-services\.md(?:#[\w-]+)?$/.test(ref)) ||
        !["admitted", "support"].includes(shape.status))
      problems.push(wholeShapeHook + ": accepted whole-shape services need ServiceDeclaration authority and admitted or support status.")
  }
  for (const row of rows) {
    if (/VIP-9 admits member body only|not service Name: Shape|custom shape branches remain pending/.test(row.reason))
      problems.push(row.hook + ": the census reason denies the accepted whole-shape service form.")
  }
  return problems
}

export function check(root) {
  return checkAdoptedServiceShape(loadRows(root), readFileSync(join(root, "docs/design/src/900-appendices.md"), "utf8"))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  for (const problem of check(root)) {
    console.error(problem)
    process.exitCode = 1
  }
}
