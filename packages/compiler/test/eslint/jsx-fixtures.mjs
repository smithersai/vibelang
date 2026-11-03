// JSX-only controls: @typescript-eslint/typescript-estree 8.69.0 / TypeScript 5.9.3.
export const jsxFixtures = {
  selfClosing: 'const el = <Box />;',
  attributes: 'const el = <input disabled data-name="a&amp;b" title=\'é😀 &quot; &#x1f600;\' value={x} {...props} />;',
  elements: 'const el = <UI.Forms.Box><span>Hello &lt;world&gt; &#65; &#x1f600;!</span>{value}</UI.Forms.Box>;',
  fragments: 'const el = <>\n  <Box />\n  text // not a comment /* neither */\n</>;',
  namespaced: 'const el = <svg:path xml:lang="en" foo-bar:baz-qux="x" />;',
  expressions: 'const el = <Box>{/* keep 😀 */}{ }{...children}{/a/.test(s) ? <b/> : null}{`x${n}`}</Box>;',
  generics: 'const el = <UI.Box<Foo<Bar>> value={f<Foo<Bar>>()} />;',
  nestedAttributes: 'const el = <Box child=<b title="x"/> other={<i/>} />;',
  keywords: 'const el = <this.Foo class="x" default={true}><default /></this.Foo>;',
  entities: 'const el = <p a="&apos; &copy; &notin; &madeup; &#0; &#x110000; &amp">&copy; &NotEqualTilde; &madeup; &amp;lt;</p>;',
  whitespace: '// é😀\r\nconst el = <p>  \r\n \ttext\r\n\t </p>;',
  arrow: 'const el = <Box render={<T,>(x: T) => <i>{x}</i>} />;'
}
