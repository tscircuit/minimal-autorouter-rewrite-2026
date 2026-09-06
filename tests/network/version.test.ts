import {expect, test} from "bun:test"
import manifest from "../../package.json"
import {AUTOROUTER_VERSION} from "../../lib/network/types"
import {createBoardInput, networkCacheKey} from "../../lib/network/boardContract"
import {createHdCache2Service} from "../../scripts/network-server"

test("package and service version agree and isolate pre-clearance cache entries", async () => {
  expect(AUTOROUTER_VERSION).toBe(manifest.version)
  expect(AUTOROUTER_VERSION).not.toBe("0.1.0")
  const input = await createBoardInput({
    srj:{layerCount:2,minTraceWidth:0.1,bounds:{minX:0,maxX:10,minY:0,maxY:10},obstacles:[],connections:[]},
    tasks:[],fixedTraces:[],viaDiameter:0.3,viaHoleDiameter:0.15,obstacleMargin:0.1,effort:1,
  })
  expect(await networkCacheKey(AUTOROUTER_VERSION,"same-namespace",input))
    .not.toBe(await networkCacheKey("0.1.0","same-namespace",input))
  const service = createHdCache2Service()
  try {
    const health = await (await fetch(new URL("health",service.server.url))).json()
    expect(health.autorouterVersion).toBe(manifest.version)
    const rejected = await fetch(new URL("solve",service.server.url),{method:"POST",
      headers:{"content-type":"application/json"},body:JSON.stringify({autorouterVersion:"0.1.0",input})})
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ok:false,message:"Unsupported autorouter version"})
    expect(service.stats.solverRuns).toBe(0)
  } finally {service.server.stop(true)}
})
