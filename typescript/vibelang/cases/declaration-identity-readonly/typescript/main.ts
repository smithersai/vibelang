export type Info = Readonly<{
  path: ReadonlyArray<string>
  label?: string
  [key: string]: unknown
}>

export type Nested = Readonly<{ inner: { count: number } }>

export type Pair = Readonly<{ left: number; right: number }>
