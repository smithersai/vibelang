// Precision times recall of label sets. Repeated names count once.
export const exactly = (want, got) => {
  const expected = new Set(want), observed = new Set(got)
  if (expected.size === 0 || observed.size === 0) return Number(expected.size === observed.size)
  const right = [...expected].filter(label => observed.has(label)).length
  return (right / expected.size) * (right / observed.size)
}

// A duration comparison also grades each expected target's timeout count.
export const regressionScore = (want, got) => {
  const labels = Object.keys(want), observed = Object.keys(got)
  if (labels.length === 0 || observed.length === 0) return Number(labels.length === observed.length)
  const timeouts = labels.filter(label => got[label] === want[label]).length / labels.length
  return exactly(labels, observed) * timeouts
}

