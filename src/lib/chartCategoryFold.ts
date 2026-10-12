// =================================================================
// chartCategoryFold — cap categorical cardinality (LOOM-140)
// =================================================================

export const DEFAULT_MAX_CATEGORIES = 11;
export const OTHER_CATEGORY_LABEL = "Other";

/** Map raw category keys to indices; overflow keys share `otherIndex`. */
export function foldCategoryKeys(
  keysInOrder: string[],
  maxDistinct: number = DEFAULT_MAX_CATEGORIES,
): { indexByKey: Map<string, number>; otherIndex: number; folded: boolean } {
  const cap = Math.max(2, maxDistinct);
  const otherIndex = cap - 1;
  const indexByKey = new Map<string, number>();
  let next = 0;
  let folded = false;
  for (const k of keysInOrder) {
    if (indexByKey.has(k)) continue;
    if (next < otherIndex) {
      indexByKey.set(k, next++);
    } else {
      indexByKey.set(k, otherIndex);
      folded = true;
    }
  }
  return { indexByKey, otherIndex, folded };
}
