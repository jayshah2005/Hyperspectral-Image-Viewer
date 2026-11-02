import { useMemo, useRef } from 'react';
import { useStore } from '../store';
import { regionStats, type RegionStats } from '../lib/mask';

/**
 * Statistics of every region, recalculated when an edit is finished (not during a brush stroke).
 * The panels are covered while the editor is open, so they catch up when it closes.
 */
export function useRegionStats(): Map<number, RegionStats> {
  const cube = useStore((s) => s.cube);
  const labels = useStore((s) => s.labels);
  const regions = useStore((s) => s.regions);
  const statsRev = useStore((s) => s.statsRev);
  const editing = useStore((s) => s.editor !== null);
  const ids = regions.map((r) => r.id).join();
  const last = useRef<{ cube: typeof cube; stats: Map<number, RegionStats> }>({ cube: null, stats: new Map() });
  return useMemo(
    () => {
      if (editing) return last.current.stats;
      const previous = last.current.cube === cube ? last.current.stats : undefined;
      const stats = cube && labels ? regionStats(cube, labels, regions.map((r) => r.id), previous) : new Map<number, RegionStats>();
      last.current = { cube, stats };
      return stats;
    },
    // statsRev marks in-place label edits; renaming a region doesn't change these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cube, labels, statsRev, ids, editing],
  );
}
