export interface FormattedSource {
  text: string
  sourceLength: number
}
export interface PrettierOptions {
  filepath?: string
  singleQuote?: boolean
  printWidth?: number
}
export const languages: Array<{
  name: string
  parsers: string[]
  extensions: string[]
  vscodeLanguageIds: string[]
}>
export const parsers: {
  vibelang: {
    parse(text: string, options: PrettierOptions): FormattedSource
    astFormat: "vibelang-formatted"
    locStart(): number
    locEnd(node: FormattedSource): number
  }
}
export const printers: {
  "vibelang-formatted": {
    print(path: { getValue(): FormattedSource }): string
    massageAstNode(node: FormattedSource, copy: Partial<FormattedSource>): void
  }
}
