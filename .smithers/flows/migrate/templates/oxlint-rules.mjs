/*
MIT License

Copyright (c) 2024-present VoidZero Inc. & Contributors
Copyright (c) 2023 Boshen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// ESLint counterpart of Oxlint's oxc/no-accumulating-spread (oxlint 1.60).
// Contract: https://oxc.rs/docs/guide/usage/linter/rules/oxc/no-accumulating-spread
// Uses source scopes rather than generated TypeScript so locations and bindings
// remain those of the .vibe file. Covered against upstream Oxlint by properties.
const functions = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"])
const loops = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"])
const contains = (outer, inner) => outer.range[0] <= inner.range[0] && outer.range[1] >= inner.range[1]
const inner = node => ["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "ChainExpression"].includes(node?.type) ? inner(node.expression) : node
const parents = function* (node) { for (let parent = node.parent; parent; parent = parent.parent) yield parent }
export default {
  rules: {
    "no-accumulating-spread": {
      meta: { type: "problem", schema: [], messages: { reduce: "Do not spread accumulators in Array.prototype.reduce()", loop: "Do not spread accumulators in loops" } },
      create(context) {
        return {
          SpreadElement(node) {
            if (node.argument.type !== "Identifier") return
            let scope = context.sourceCode.getScope(node.argument)
            let variable
            while (scope && !variable) { variable = scope.variables.find(variable => variable.name === node.argument.name); scope = scope.upper }
            const def = variable?.defs[0]
            if (!def) return
            if (def.type === "Parameter") {
              const fn = def.node
              const first = fn.params[0]?.type === "AssignmentPattern" ? fn.params[0].left : fn.params[0]
              if (fn.params.length !== 2 || first !== def.name) return
              // A spread in another callback is not an accumulation by this callback.
              for (const parent of parents(node)) {
                if (parent === fn) break
                if (functions.has(parent.type)) return
              }
              for (const parent of parents(fn)) {
                if (parent.type !== "CallExpression" || parent.arguments.length < 1 || parent.arguments.length > 2) continue
                const callee = inner(parent.callee)
                if (callee?.type !== "MemberExpression") continue
                const method = callee.computed ? callee.property.value : callee.property.name
                if (method === "reduce" || method === "reduceRight") { context.report({ node, messageId: "reduce" }); return }
              }
            }
            if (def.type !== "Variable" || def.parent.kind !== "let") return
            // Oxlint uses the first non-initializing write of the binding.
            const write = variable.references.find(reference => reference.isWrite() && !reference.init)
            const assignment = write?.identifier.parent
            if (assignment?.type !== "AssignmentExpression" || assignment.left !== write.identifier) return
            const right = inner(assignment.right)
            if (!["ArrayExpression", "ObjectExpression"].includes(right?.type) || !contains(right, node)) return
            for (const parent of parents(node)) {
              if (loops.has(parent.type) && !contains(parent, def.parent)) {
                context.report({ node: def.name, messageId: "loop" })
                return
              }
            }
          }
        }
      }
    }
  }
}
