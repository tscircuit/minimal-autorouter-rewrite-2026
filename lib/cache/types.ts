export interface CacheProvider {
  isSyncCache: boolean
  cacheHits: number
  cacheMisses: number
  cacheHitsByPrefix: Record<string, number>
  cacheMissesByPrefix: Record<string, number>
  getCachedSolutionSync(key: string): any
  getCachedSolution(key: string): Promise<any>
  setCachedSolutionSync(key: string, value: any): void
  setCachedSolution(key: string, value: any): Promise<void>
  getAllCacheKeys(): string[]
  clearCache(): void
}
