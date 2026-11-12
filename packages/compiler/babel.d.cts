declare function vibelang(): { plugins: [() => vibelang.Plugin] }
declare namespace vibelang {
  interface ParserOptions {
    sourceFileName?: string
    plugins?: readonly unknown[]
    [key: string]: unknown
  }
  interface Plugin {
    name: "vibelang"
    parserOverride<Ast>(code: string, parserOpts: ParserOptions, parse: (code: string, options: ParserOptions) => Ast): Ast | undefined
  }
}
export = vibelang
