import { useMemo } from 'react';
import { useStore } from '../store';
import { regionStats, type RegionStats } from '../lib/mask';

/** Statistics of every region, recalculated when an edit is finished (not during a brush stroke). */
export function useRegionStats(): Map<number, RegionStats> {
  const cube = useStore((s) => s.cube);
  const labels = useStore((s) => s.labels);
  const regions = useStore((s) => s.regions);
  const statsRev = useStore((s) => s.statsRev);
  const ids = regions.map((r) => r.id).join();
  return useMemo(
    () => (cube && labels ? regionStats(cube, labels, regions.map((r) => r.id)) : new Map()),
    // statsRev marks in-place label edits; renaming a region doesn't change these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cube, labels, statsRev, ids],
  );
}
