const LOW_TOP1_THRESHOLD = 0.72;
const LOW_MIN_HIT_SCORE = 0.6;
const LOW_MIN_HIT_COUNT = 2;

export function isHybridSearchLowCoverage(
  hits: Array<{ score: number }>
): boolean {
  const top1 = hits[0]?.score ?? 0;
  const strongHits = hits.filter((h) => h.score >= LOW_MIN_HIT_SCORE).length;
  return top1 < LOW_TOP1_THRESHOLD || strongHits < LOW_MIN_HIT_COUNT;
}
