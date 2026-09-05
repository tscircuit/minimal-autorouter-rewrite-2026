import type {CacheProvider} from "./types"

export class InMemoryCache implements CacheProvider {
  readonly isSyncCache = true
  readonly cache = new Map<string, unknown>()
  cacheHits = 0
  cacheMisses = 0
  cacheHitsByPrefix: Record<string, number> = {}
  cacheMissesByPrefix: Record<string, number> = {}

  getCachedSolutionSync(key: string): any {
    const found = this.cache.has(key)
    const prefix = key.split(":", 1)[0]!
    const counters = found ? this.cacheHitsByPrefix : this.cacheMissesByPrefix
    counters[prefix] = (counters[prefix] ?? 0) + 1
    if (found) this.cacheHits++; else this.cacheMisses++
    return found ? structuredClone(this.cache.get(key)) : undefined
  }
  async getCachedSolution(key: string): Promise<any> { return this.getCachedSolutionSync(key) }
  setCachedSolutionSync(key: string, value: any): void { this.cache.set(key, structuredClone(value)) }
  async setCachedSolution(key: string, value: any): Promise<void> { this.setCachedSolutionSync(key, value) }
  getAllCacheKeys(): string[] { return [...this.cache.keys()] }
  clearCache(): void {
    this.cache.clear()
    this.cacheHits = this.cacheMisses = 0
    this.cacheHitsByPrefix = {}
    this.cacheMissesByPrefix = {}
  }
}
