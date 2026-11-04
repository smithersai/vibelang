export type News = { title: string }
export type MaybeNews = News | undefined
export function isResolved(news: News | undefined): news is News {
  if (news?.title === "throw") throw news
  return news !== undefined
}
export function accepts(news: unknown): news is MaybeNews {
  return news === undefined || typeof news === "object"
}
