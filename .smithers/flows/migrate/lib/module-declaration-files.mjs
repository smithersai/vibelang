import { basename, dirname, join } from "node:path"

/** Declaration outputs owned by the named bodies in a source being reverted. */
export function moduleDeclarationFiles(ts, file, text, sidecar) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const directories = new Set([dirname(file), ...(sidecar ? [dirname(sidecar)] : [])])
  return source.statements.filter(node => ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.body
    && !(node.flags & ts.NodeFlags.Namespace) && !node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword))
    .flatMap(node => {
      const name = [...node.name.text].map(c => /^[a-z0-9_]$/.test(c) ? c : "-" + c.codePointAt(0).toString(16) + "-").join("")
      return [...directories].map(directory => join(directory, basename(file) + "." + name + ".d.ts"))
    })
}
