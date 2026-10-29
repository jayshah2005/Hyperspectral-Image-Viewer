import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { loadCandidate } from '../loaders/client';
import type { Axes } from '../types';

/** Choose which array in a .mat/.h5 file to view, and how its dimensions map to rows/columns/bands. */
export function DatasetPicker() {
  const { candidates, current, sourceName, set } = useStore(
    useShallow((s) => ({ candidates: s.candidates, current: s.current, sourceName: s.sourceName, set: s.set })),
  );
  const [id, setId] = useState(current?.id ?? candidates[0]?.id);
  const cand = candidates.find((c) => c.id === id) ?? candidates[0];
  const dims = cand ? cand.shape.map((n, i) => ({ n, i })).filter((d) => d.n !== 1) : [];
  const initial = (current?.id === cand?.id ? current?.axes : null) ?? cand?.defaultAxes ?? null;
  const [bandAxis, setBandAxis] = useState(initial?.b ?? 2);
  const [swap, setSwap] = useState(initial ? initial.y > initial.x : false);

  useEffect(() => {
    const a = (current?.id === cand?.id ? current?.axes : null) ?? cand?.defaultAxes;
    if (a) {
      setBandAxis(a.b);
      setSwap(a.y > a.x);
    }
  }, [cand, current]);

  if (!cand) return null;
  const spatial = [0, 1, 2].filter((i) => i !== bandAxis);
  const axes: Axes = swap ? { y: spatial[1], x: spatial[0], b: bandAxis } : { y: spatial[0], x: spatial[1], b: bandAxis };
  const squeezed = dims.map((d) => d.n);

  return (
    <div className="modal-backdrop" onClick={() => set({ pickerOpen: false })}>
      <div className="modal" role="dialog" aria-label="Choose dataset" onClick={(e) => e.stopPropagation()}>
        <h2>Choose a cube in {sourceName}</h2>
        {candidates.length > 1 && (
          <ul className="candidates">
            {candidates.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="radio" name="cand" checked={c.id === cand.id} onChange={() => setId(c.id)} />
                  <code>{c.label}</code>
                  <span className="muted">
                    {c.shape.join(' × ')} {c.dtype && `· ${c.dtype}`}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {cand.defaultAxes ? (
          <div className="axes">
            <h3>Dimension order</h3>
            <p className="note">Shape {squeezed.join(' × ')}. Pick which dimension holds the spectral bands.</p>
            <div className="seg">
              {squeezed.map((n, i) => (
                <button key={i} className={bandAxis === i ? 'on' : ''} onClick={() => setBandAxis(i)}>
                  dim {i} ({n})
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
              Transpose image (swap rows and columns)
            </label>
            <p className="muted">
              Result: {squeezed[axes.x]} wide × {squeezed[axes.y]} tall, {squeezed[axes.b]} bands
            </p>
          </div>
        ) : (
          <p className="note">This format defines its own layout.</p>
        )}

        <div className="row end">
          <button onClick={() => set({ pickerOpen: false })}>Cancel</button>
          <button className="primary" onClick={() => loadCandidate(cand.id, cand.defaultAxes ? axes : null)}>
            Load
          </button>
        </div>
      </div>
    </div>
  );
}
