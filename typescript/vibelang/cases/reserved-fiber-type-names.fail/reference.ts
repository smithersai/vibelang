// TypeScript rejects the corresponding await names in async code.
export async function aliases() {
  type await = number
  interface await { value: number }
}
export async function enums() {
  enum await { A }
  const enum await { A }
}
export async function parameters() {
  type Value<await> = await
  class Box<await> { value!: await }
}
export async function enclosing() {
  async function generic<await>() {}
  class Example { async method<await>() {} }
}
