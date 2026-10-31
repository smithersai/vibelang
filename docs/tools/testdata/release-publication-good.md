# Release notes

## 0.0.11 (unreleased)

<!-- intro-row -->

### Bugs fixed since 0.0.10

- Editor parsing rejected `for try` `Stream` loops; the tree-sitter grammar now recognizes the loop and its `continue` and `break` statements.

- A tool that reads a `.vibe` file through the TypeScript mapper, such as Oxlint through the Oxc fork's VibeLang hook, reported `TS1338: 'infer' declarations are only permitted in the 'extends' clause of a conditional type` at each `: infer _` return annotation, because the mapper kept it in the TypeScript it returns. The mapper now drops the annotation, and TypeScript infers the return type from the body, as `infer _` means.

- The migrate flow could miss errors and repair notes in compiler output with Windows line endings, or mistake a normal error exit for a compiler crash; they now read those diagnostics and notes correctly.

<!-- injected-row -->

## 0.0.10
