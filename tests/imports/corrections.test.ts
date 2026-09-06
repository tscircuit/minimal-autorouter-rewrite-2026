import {expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {execPath} from "node:process"
import {
  applyVerifiedCircuitJsonImportCorrections,
  applyVerifiedImportCorrections,
  createImportManifest,
  deriveCorrectedRectangle,
  formatImportedJson,
  importSourcePaths,
  sha256,
  verifyOriginalKicadBytes,
} from "../../scripts/imports/applyVerifiedImportCorrections"
import {regenerateVerifiedImportCorrections} from "../../scripts/imports/regenerate"
import manifest from "../../imports/manifest.json"

const root = resolve(import.meta.dir, "../..")
const originalBytes = () => readFile(join(root,"datasets/dataset-srj18/sample016.json"))

test("the derivative changes exactly four proven dimension pairs and preserves every other source value",async()=>{
  const bytes=await originalBytes(), before=new Uint8Array(bytes)
  const original=JSON.parse(bytes.toString()), corrected=applyVerifiedImportCorrections(bytes)
  const changes:Array<{index:number;keys:string[]}>=[]
  for(let index=0;index<original.obstacles.length;index++) {
    const keys=Object.keys(original.obstacles[index]).filter(key=>
      JSON.stringify(original.obstacles[index][key])!==JSON.stringify((corrected.obstacles[index] as any)[key]))
    if(keys.length)changes.push({index,keys})
    const {width:_originalWidth,height:_originalHeight,...source}=original.obstacles[index]
    const {width:_correctedWidth,height:_correctedHeight,...target}=corrected.obstacles[index]!
    expect(target).toEqual(source)
  }
  expect(changes).toEqual([85,86,219,220].map(index=>({index,keys:["width","height"]})))
  for(const {index} of changes)expect(corrected.obstacles[index]).toMatchObject({width:5.3,height:2.5})
  const {obstacles:_sourceObstacles,...source}=original
  const {obstacles:_targetObstacles,...target}=corrected
  expect(target).toEqual(source)
  expect(new Uint8Array(bytes)).toEqual(before)
})

test("regenerated pretty JSON bytes and provenance match the committed derivative and manifest",async()=>{
  const bytes=await originalBytes()
  const regenerated=formatImportedJson(applyVerifiedImportCorrections(bytes))
  expect(regenerated.endsWith("\n")).toBe(true)
  expect(regenerated).toBe(await readFile(join(root,"imports",manifest.corrections[0]!.path),"utf8"))
  expect(sha256(regenerated)).toBe(manifest.corrections[0]!.correctedSrjSha256)
  expect(sha256(bytes)).toBe(manifest.corrections[0]!.originalSrjSha256)
  expect(createImportManifest(regenerated)).toEqual(manifest)
})

test("byte changes, identity edits, and applying the correction twice are rejected",async()=>{
  const bytes=await originalBytes()
  expect(()=>applyVerifiedImportCorrections(bytes.toString()+"\n")).toThrow("original SRJ byte hash")
  for(const mutate of [
    (srj:any)=>{srj.obstacles[85].componentId="different_component"},
    (srj:any)=>{srj.obstacles[85].connectedTo[0]="different_pad"},
    (srj:any)=>{srj.obstacles[85].center.x+=.001},
    (srj:any)=>{srj.obstacles[85].width=99},
    (srj:any)=>{srj.connections=[]},
  ]) {
    const changed=JSON.parse(bytes.toString());mutate(changed)
    expect(()=>applyVerifiedImportCorrections(formatImportedJson(changed))).toThrow("original SRJ byte hash")
  }
  expect(()=>applyVerifiedImportCorrections(formatImportedJson(applyVerifiedImportCorrections(bytes)))).toThrow("original SRJ byte hash")
})

test("dimensions derive from valid quarter turns, never a tapered or unsupported shape",()=>{
  const source={type:"smd",shape:"trapezoid",angle:270,size:[2.5,5.3],rectDelta:[0,0]}
  expect(deriveCorrectedRectangle(source)).toEqual({width:5.3,height:2.5})
  expect(deriveCorrectedRectangle({...source,angle:180})).toEqual({width:2.5,height:5.3})
  expect(deriveCorrectedRectangle({...source,angle:-90})).toEqual({width:5.3,height:2.5})
  for(const changed of [
    {...source,rectDelta:[.1,0]}, {...source,shape:"custom"}, {...source,type:"thru_hole"},
    {...source,angle:45}, {...source,angle:NaN}, {...source,size:[0,5]}, {...source,size:[2,Infinity]},
  ])expect(()=>deriveCorrectedRectangle(changed)).toThrow("Import correction:")
})

test("unknown KiCad and Circuit JSON files cannot provide source proof",()=>{
  expect(()=>verifyOriginalKicadBytes("(kicad_pcb)\n")).toThrow("original KiCad byte hash")
  expect(()=>applyVerifiedCircuitJsonImportCorrections("[]\n")).toThrow("original Circuit JSON byte hash")
})

test("a changed audit file is rejected before its instructions are consumed",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"import-audit-check-"))
  try {
    await mkdir(join(directory,"scripts/imports"),{recursive:true})
    await mkdir(join(directory,"imports"),{recursive:true})
    const modulePath=join(directory,"scripts/imports/applyVerifiedImportCorrections.ts")
    await writeFile(modulePath,await readFile(join(root,"scripts/imports/applyVerifiedImportCorrections.ts")))
    await writeFile(join(directory,"imports/source-rotation-audit.json"),
      await readFile(join(root,"imports/source-rotation-audit.json"),"utf8")+"\n")
    const child=Bun.spawn([execPath,modulePath],{stdout:"pipe",stderr:"pipe"})
    const timeout=setTimeout(()=>child.kill(),10_000)
    try {
      const [code,stderr]=await Promise.all([child.exited,new Response(child.stderr).text()])
      expect(code).not.toBe(0)
      expect(stderr).toContain("rotation audit byte hash changed")
    } finally {clearTimeout(timeout);if(child.exitCode===null){child.kill();await child.exited}}
  } finally {await rm(directory,{recursive:true,force:true})}
},20_000)

test("regeneration refuses destinations within the source checkout or pinned benchmark inputs",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"import-source-check-"))
  try {
    for(const outputDirectory of [join(directory,"derivatives"),join(root,"datasets/dataset-srj18/derivatives")])
      await expect(regenerateVerifiedImportCorrections({sourceDirectory:directory,outputDirectory})).rejects.toThrow("outside pinned source datasets")
  } finally {await rm(directory,{recursive:true,force:true})}
})

test("CLI rejects invalid source files with no generated output",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"import-cli-check-"))
  const source=join(directory,"source"),output=join(directory,"output")
  try {
    for(const path of Object.values(importSourcePaths))await mkdir(resolve(source,path,".."),{recursive:true})
    await writeFile(join(source,importSourcePaths.srj),await originalBytes())
    await writeFile(join(source,importSourcePaths.circuitJson),"[]\n")
    await writeFile(join(source,importSourcePaths.kicad),"(kicad_pcb)\n")
    const child=Bun.spawn([execPath,"scripts/imports/run.ts","--source-dir",source,"--output-dir",output],
      {cwd:root,stdout:"pipe",stderr:"pipe"})
    const timeout=setTimeout(()=>child.kill(),10_000)
    try {
      const [code,stderr]=await Promise.all([child.exited,new Response(child.stderr).text()])
      expect(code).not.toBe(0)
      expect(stderr).toContain("original KiCad byte hash")
      expect(await Bun.file(join(output,"manifest.json")).exists()).toBe(false)
      expect(await readFile(join(source,importSourcePaths.srj))).toEqual(await originalBytes())
    } finally {clearTimeout(timeout);if(child.exitCode===null){child.kill();await child.exited}}
  } finally {await rm(directory,{recursive:true,force:true})}
},20_000)
