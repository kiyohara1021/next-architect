import type { AwaitInfo } from "@next-architect/core";

export interface WaterfallCandidate {
  file: string;
  independent: AwaitInfo;
  /** Preceding awaits that do not data-depend into independent. */
  preceding: AwaitInfo[];
  /** Preceding awaits that DO depend (for display). */
  dependentChain: AwaitInfo[];
}

/**
 * Find waterfall candidates: consecutive non-excluded awaits where later
 * does not depend on earlier bindings (D1–D4).
 */
export function findWaterfallCandidates(
  file: string,
  awaits: AwaitInfo[],
): WaterfallCandidate[] {
  const candidates: WaterfallCandidate[] = [];
  const usable = awaits.filter((a) => !a.excluded);
  if (usable.length < 2) return candidates;

  // Track cumulative bindings
  const boundSoFar: string[] = [];
  const preceding: AwaitInfo[] = [];
  const dependentChain: AwaitInfo[] = [];

  for (let i = 0; i < usable.length; i++) {
    const a = usable[i]!;
    const depends = a.referencedNames.some((n) => boundSoFar.includes(n));

    if (i > 0 && !depends && preceding.length > 0) {
      // Independent of all previous — waterfall candidate
      candidates.push({
        file,
        independent: a,
        preceding: [...preceding],
        dependentChain: [...dependentChain],
      });
    }

    if (depends) {
      dependentChain.push(a);
    } else {
      preceding.push(a);
    }
    boundSoFar.push(...a.boundNames);
  }

  return candidates;
}
