import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { spectralAxis } from '../lib/cube';
import { spectraToCsv } from '../lib/analysis';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PinnedList() {
  const { cube, pins, refPinId, updatePin, removePin, clearPins, set } = useStore(
    useShallow((s) => ({
      cube: s.cube,
      pins: s.pins,
      refPinId: s.refPinId,
      updatePin: s.updatePin,
      removePin: s.removePin,
      clearPins: s.clearPins,
      set: s.set,
    })),
  );

  const exportCsv = () => {
    const axis = spectralAxis(cube!);
    const csv = spectraToCsv(
      axis,
      pins.map((p) => ({ label: p.label, values: p.spectrum, std: p.std })),
    );
    download(`${cube!.name.replace(/[^\w.-]+/g, '_')}_spectra.csv`, csv);
  };

  return (
    <section className="panel">
      <h2>
        Pinned spectra <span className="count">{pins.length}</span>
      </h2>
      {pins.length === 0 ? (
        <p className="note">Click the image to pin a pixel's spectrum, or Shift+drag to pin the mean of a region.</p>
      ) : (
        <ul className="pins">
          {pins.map((p) => (
            <li key={p.id} className={p.visible ? '' : 'hidden'}>
              <button
                className={`swatch-btn${p.dashed ? ' dashed' : ''}`}
                style={{ borderColor: p.color, background: p.visible ? p.color : 'transparent' }}
                onClick={() => updatePin(p.id, { visible: !p.visible })}
                title={p.visible ? 'Hide' : 'Show'}
                aria-label={`${p.visible ? 'Hide' : 'Show'} ${p.label}`}
              />
              <div className="pin-main">
                <input className="pin-label" value={p.label} onChange={(e) => updatePin(p.id, { label: e.target.value })} />
                <span className="pin-meta">
                  {p.rect
                    ? `ROI ${p.rect.x1 - p.rect.x0}×${p.rect.y1 - p.rect.y0} at (${p.rect.x0}, ${p.rect.y0}) · n=${p.count}`
                    : `x ${p.x}, y ${p.y}`}
                </span>
              </div>
              <label className="ref" title="Reference spectrum for the SAM map">
                <input type="radio" name="ref" checked={refPinId === p.id} onChange={() => set({ refPinId: p.id })} />
                ref
              </label>
              <button className="icon" onClick={() => removePin(p.id)} aria-label={`Remove ${p.label}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button onClick={exportCsv} disabled={!pins.length}>
          Export CSV
        </button>
        <button onClick={clearPins} disabled={!pins.length}>
          Clear all
        </button>
      </div>
    </section>
  );
}
