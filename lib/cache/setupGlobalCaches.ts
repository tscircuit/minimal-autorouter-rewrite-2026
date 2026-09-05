import {InMemoryCache} from "./InMemoryCache"
let memoryCache: InMemoryCache | undefined
export function getGlobalInMemoryCache(): InMemoryCache { return memoryCache ??= new InMemoryCache() }
