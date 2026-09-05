import type {Point} from "../types"

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export function pointSegmentDistanceSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx+dy*dy || 1)))
  return (p.x-a.x-t*dx)**2 + (p.y-a.y-t*dy)**2
}

export function segmentDistanceSquared(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (p: Point, q: Point, r: Point) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)
  const abC = cross(a,b,c), abD = cross(a,b,d), cdA = cross(c,d,a), cdB = cross(c,d,b)
  if (abC * abD <= 0 && cdA * cdB <= 0 &&
    Math.max(a.x,b.x) >= Math.min(c.x,d.x) && Math.max(c.x,d.x) >= Math.min(a.x,b.x) &&
    Math.max(a.y,b.y) >= Math.min(c.y,d.y) && Math.max(c.y,d.y) >= Math.min(a.y,b.y)) return 0
  return Math.min(pointSegmentDistanceSquared(a,c,d),pointSegmentDistanceSquared(b,c,d),
    pointSegmentDistanceSquared(c,a,b),pointSegmentDistanceSquared(d,a,b))
}

/** Squared distance to a rectangle, including its interior. */
export function segmentRectDistanceSquared(a: Point, b: Point, halfWidth: number, halfHeight: number): number {
  if ((Math.abs(a.x) <= halfWidth && Math.abs(a.y) <= halfHeight) ||
      (Math.abs(b.x) <= halfWidth && Math.abs(b.y) <= halfHeight)) return 0
  const p = [{x:-halfWidth,y:-halfHeight},{x:halfWidth,y:-halfHeight},
    {x:halfWidth,y:halfHeight},{x:-halfWidth,y:halfHeight}]
  let result = Infinity
  for (let i=0; i<4; i++) result = Math.min(result,segmentDistanceSquared(a,b,p[i]!,p[(i+1)%4]!))
  return result
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i=0,j=polygon.length-1; i<polygon.length; j=i++) {
    const a=polygon[i]!,b=polygon[j]!
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside
  }
  return inside
}
