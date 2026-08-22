/** @module @throws {never} */
const React = {
  /**
   * @param {(props: { value: string }) => string} component
   * @param {{ value: string }} props
   */
  createElement(component, props) {
    return component(props)
  },
}

/** @param {{ value: string }} props */
function Box(props) {
  return props.value
}

/** @throws {never} */
export function jsxValue() {
  return <Box value="jsx" />
}
