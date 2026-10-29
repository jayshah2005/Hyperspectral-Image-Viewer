import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { normalizedDifference, spectralAngleMap } from '../lib/analysis';
import { covers, nearestBand, nmToCubeUnits } from '../lib/cube';
import { BandSlider } from './BandSlider';

export function AnalysisPanel() {
  const { cube, pins, refPinId, derived, showDerived, set } = useStore(
    useShallow((s) => ({
      cube: s.cube,
      pins: s.pins,
      refPinId: s.refPinId,
      derived: s.derived,
      showDerived: s.showDerived,
      set: s.set,
    })),
  );
  const [busy, setBusy] = useState(false);
  const c = cube!;
  const ndviBands = covers(c, 650, 860) ? [nearestBand(c, nmToCubeUnits(c, 860)), nearestBand(c, nmToCubeUnits(c, 650))] : null;
  const [ndA, setNdA] = useState(ndviBands?.[0] ?? Math.round(c.bands * 0.75));
  const [ndB, setNdB] = useState(ndviBands?.[1] ?? Math.round(c.bands * 0.4));
  const ref = pins.find((p) => p.id === refPinId);

  // Defer heavy work one tick so the busy state paints first.
  const run = (fn: () => void) => {
    setBusy(true);
    setTimeout(() => {
      try {
        fn();
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const sam = () =>
    run(() => {
      const data = spectralAngleMap(c, ref!.spectrum);
      set({ derived: { name: `SAM vs ${ref!.label}`, data, colormap: 'inferno', unit: 'rad' }, showDerived: true });
    });

  const nd = () =>
    run(() => {
      const data = normalizedDifference(c, ndA, ndB);
      set({ derived: { name: `ND(b${ndA + 1}, b${ndB + 1})`, data, colormap: 'rdylgn' }, showDerived: true });
    });

  return (
    <section className="panel">
      <h2>Analysis</h2>

      <h3>Spectral Angle Mapper</h3>
      <p className="note">
        Angle between every pixel and the reference spectrum. Dark = similar material, independent of brightness.
      </p>
      <div className="row">
        <select value={refPinId ?? ''} onChange={(e) => set({ refPinId: Number(e.target.value) })} disabled={!pins.length}>
          {!pins.length && <option value="">Pin a spectrum first</option>}
          {pins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button onClick={sam} disabled={!ref || busy}>
          Compute
        </button>
      </div>

      <h3>Normalized difference</h3>
      <p className="note">(A − B) / (A + B). With A = NIR and B = red this is NDVI.</p>
      <BandSlider label="A" value={ndA} onChange={setNdA} />
      <BandSlider label="B" value={ndB} onChange={setNdB} />
      <div className="row">
        {ndviBands && (
          <button
            onClick={() => {
              setNdA(ndviBands[0]);
              setNdB(ndviBands[1]);
            }}
          >
            NDVI bands
          </button>
        )}
        <button onClick={nd} disabled={busy}>
          Compute
        </button>
      </div>

      {derived && (
        <div className="derived">
          <label className="check">
            <input type="checkbox" checked={showDerived} onChange={(e) => set({ showDerived: e.target.checked })} />
            Show “{derived.name}”
          </label>
          <button className="link" onClick={() => set({ derived: null, showDerived: false })}>
            Discard
          </button>
        </div>
      )}
      {busy && <p className="note">Computing…</p>}
    </section>
  );
}
