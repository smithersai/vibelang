declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { div: {} }
}

declare namespace React { function createElement(tag: unknown, props: unknown, ...children: unknown[]): JSX.Element }
