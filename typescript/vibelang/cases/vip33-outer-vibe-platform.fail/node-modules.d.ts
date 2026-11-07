// Stands in for @types/node's node:os; the specifier decides what is a platform module.
declare module "node:os" {
  export const EOL: string
}
