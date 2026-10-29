import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { loadCandidate } from '../loaders/client';

/** Shown when a .mat/.h5 file holds several 3-D arrays: pick the one to view. */
export function DatasetPicker() {
  const { candidates, sourceName, set } = useStore(
    useShallow((s) => ({ candidates: s.candidates, sourceName: s.sourceName, set: s.set })),
  );
  const [id, setId] = useState(candidates[0]?.id);
  const cand = candidates.find((c) => c.id === id) ?? candidates[0];
  if (!cand) return null;

  return (
    <div className="modal-backdrop" onClick={() => set({ pickerOpen: false })}>
      <div className="modal" role="dialog" aria-label="Choose dataset" onClick={(e) => e.stopPropagation()}>
        <h2>Choose a cube in {sourceName}</h2>
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
        <div className="row end">
          <button onClick={() => set({ pickerOpen: false })}>Cancel</button>
          <button className="primary" onClick={() => loadCandidate(cand.id, cand.defaultAxes)}>
            Load
          </button>
        </div>
      </div>
    </div>
  );
}
