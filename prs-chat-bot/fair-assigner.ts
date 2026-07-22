export type AssignerState = {
  userCounts: Record<string, number>;
};

/** Canonical sort key for a reviewer pair — shared by assigner and callers. */
export function canonicalPair(a: string, b: string): string {
  return [a, b].map(x => x.toLowerCase()).sort().join('|');
}

export class FairPairAssigner {
  private reviewers: string[];
  private userCounts: Record<string, number>;
  private runStartCounts: Record<string, number>;

  constructor(reviewers: string[], _seed?: number, restored?: AssignerState) {
    this.reviewers = reviewers.slice();
    this.userCounts = {};

    if (restored && restored.userCounts) {
      const restoredByLower = new Map<string, number>();
      for (const [name, value] of Object.entries(restored.userCounts)) {
        restoredByLower.set(name.toLowerCase(), value);
      }
      for (const r of this.reviewers) {
        const v = restoredByLower.get(r.toLowerCase());
        this.userCounts[r] = typeof v === "number" ? v : 0;
      }
    } else {
      for (const r of this.reviewers) {
        this.userCounts[r] = 0;
      }
    }

    this.runStartCounts = { ...this.userCounts };
  }

  private getCount(name: string): number {
    return this.userCounts[name] ?? 0;
  }

  private setCount(name: string, value: number) {
    this.userCounts[name] = value;
  }

  peekNextPair(excluded: Set<string>, avoidPairKey?: string | null): [string, string] {
    const excludedLower = new Set<string>();
    for (const x of excluded) excludedLower.add(x.toLowerCase());

    let candidates = this.reviewers.filter(
      r => !excludedLower.has(r.toLowerCase()),
    );

    if (candidates.length < 2) {
      if (candidates.length === 0) {
        candidates = this.reviewers.slice();
      } else {
        const rest = this.reviewers.filter(
          r => r.toLowerCase() !== candidates[0]!.toLowerCase(),
        );
        rest.sort((a, b) => this.getCount(a) - this.getCount(b));
        if (rest.length > 0) candidates = [...candidates, rest[0]!];
      }
    }

    candidates.sort((a, b) => {
      const ca = this.getCount(a);
      const cb = this.getCount(b);
      if (ca !== cb) return ca - cb;
      const sa = this.runStartCounts[a] ?? 0;
      const sb = this.runStartCounts[b] ?? 0;
      if (sa !== sb) return sa - sb;
      const da = ca - sa;
      const db = cb - sb;
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });

    const a = candidates[0]!;
    let b = candidates[1]!;

    // Avoid repeating the last assigned pair when a third candidate is available
    if (avoidPairKey && candidates.length > 2) {
      if (canonicalPair(a, b) === avoidPairKey) {
        b = candidates[2]!;
      }
    }

    return [a, b];
  }

  commitPick(a: string, b: string): void {
    this.setCount(a, this.getCount(a) + 1);
    this.setCount(b, this.getCount(b) + 1);
  }

  resetCounts(preserve?: [string, string]): void {
    for (const r of this.reviewers) {
      this.userCounts[r] = 0;
    }
    if (preserve) {
      const [a, b] = preserve;
      if (a in this.userCounts) this.userCounts[a] = 1;
      if (b in this.userCounts) this.userCounts[b] = 1;
    }
  }

  saveState(): AssignerState {
    return {
      userCounts: { ...this.userCounts },
    };
  }

  getScores(): Record<string, number> {
    return { ...this.userCounts };
  }
}
