// Precision times recall for sets of distinct labels.
export const exactly = (want, got) => {
  if (want.length === 0 || got.length === 0) return Number(want.length === got.length)
  const right = want.filter(label => got.includes(label)).length
  return (right / want.length) * (right / got.length)
}

// A duration comparison also grades each expected target's timeout count.
export const regressionScore = (want, got) => {
  const labels = Object.keys(want), observed = Object.keys(got)
  if (labels.length === 0 || observed.length === 0) return Number(labels.length === observed.length)
  const timeouts = labels.filter(label => got[label] === want[label]).length / labels.length
  return exactly(labels, observed) * timeouts
}

