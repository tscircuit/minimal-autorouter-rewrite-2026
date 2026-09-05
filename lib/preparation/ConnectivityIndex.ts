/** Named electrical equivalence is distinct from already-routed copper. */
export class ConnectivityIndex {
  private parent = new Map<string, string>()

  getNetConnectedToId(id: string): string {
    const parent = this.parent.get(id)
    if (parent === undefined) {
      this.parent.set(id, id)
      return id
    }
    if (parent === id) return id
    const root = this.getNetConnectedToId(parent)
    this.parent.set(id, root)
    return root
  }

  addConnections(groups: string[][]): void {
    for (const group of groups) {
      if (group.length === 0) continue
      const root = this.getNetConnectedToId(group[0]!)
      for (const id of group.slice(1)) this.parent.set(this.getNetConnectedToId(id), root)
    }
  }

  areIdsConnected(left: string, right: string): boolean {
    return this.getNetConnectedToId(left) === this.getNetConnectedToId(right)
  }

  getIdsConnectedToNet(id: string): string[] {
    const root = this.getNetConnectedToId(id)
    return [...this.parent.keys()].filter((key) => this.getNetConnectedToId(key) === root)
  }

  toObject(): Record<string, string[]> {
    const groups: Record<string, string[]> = {}
    for (const id of this.parent.keys()) {
      const root = this.getNetConnectedToId(id)
      ;(groups[root] ??= []).push(id)
    }
    return groups
  }
}
