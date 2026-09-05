import type {BaseSolver, PendingEffect} from "./BaseSolver"
export function getPendingEffectsFromSolverTree(solver: BaseSolver): PendingEffect[] {
  let current: BaseSolver | null | undefined = solver
  let pending: PendingEffect[] = []
  while (current) {
    if (current.pendingEffects?.length) pending = current.pendingEffects
    current = current.activeSubSolver
  }
  return pending
}
