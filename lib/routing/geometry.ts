import type {Point} from "../types"

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export function pointSegmentDistanceSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx+dy*dy || 1)))
  return (p.x-a.x-t*dx)**2 + (p.y-a.y-t*dy)**2
}

export function segmentDistanceSquared(a: Point, b: Point, c: Point, d: Point): number {
  if(a.x===b.x&&a.y===b.y) return pointSegmentDistanceSquared(a,c,d)
  if(c.x===d.x&&c.y===d.y) return pointSegmentDistanceSquared(c,a,b)
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
  const pointDistance=(p: Point)=>Math.max(0,Math.abs(p.x)-halfWidth)**2+Math.max(0,Math.abs(p.y)-halfHeight)**2
  if(a.x===b.x&&a.y===b.y) return pointDistance(a)
  let lower=0,upper=1
  for(const [position,delta,half] of [[a.x,b.x-a.x,halfWidth],[a.y,b.y-a.y,halfHeight]]) {
    if(Math.abs(delta!)<1e-15) {
      if(Math.abs(position!)>half!) {upper=-1;break}
    } else {
      const t1=(-half!-position!)/delta!,t2=(half!-position!)/delta!
      lower=Math.max(lower,Math.min(t1,t2));upper=Math.min(upper,Math.max(t1,t2))
    }
  }
  if(lower<=upper) return 0
  return Math.min(pointDistance(a),pointDistance(b),
    pointSegmentDistanceSquared({x:-halfWidth,y:-halfHeight},a,b),
    pointSegmentDistanceSquared({x:halfWidth,y:-halfHeight},a,b),
    pointSegmentDistanceSquared({x:halfWidth,y:halfHeight},a,b),
    pointSegmentDistanceSquared({x:-halfWidth,y:halfHeight},a,b))
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i=0,j=polygon.length-1; i<polygon.length; j=i++) {
    const a=polygon[i]!,b=polygon[j]!
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside
  }
  return inside
}
