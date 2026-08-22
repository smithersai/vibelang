/** @module @throws {never} */
namespace JSX {
  export type Element = string
}

const React = {
  createElement<Props>(component: (props: Props) => string, props: Props): string {
    return component(props)
  },
}

function Box(props: { readonly value: string }): string {
  return props.value
}

/** @throws {never} */
export function tsxValue(): string {
  return <Box value="tsx" />
}
