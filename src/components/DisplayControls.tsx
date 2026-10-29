import { useShallow } from 'zustand/react/shallow';
import { useStore, trueColorBands, falseColorBands, spreadBands } from '../store';
import { COLORMAPS, colormapGradient, type ColormapName } from '../lib/colormaps';
import { BandSlider } from './BandSlider';

export function DisplayControls() {
  const s = useStore(
    useShallow((st) => ({
      cube: st.cube,
      mode: st.mode,
      band: st.band,
      rgb: st.rgb,
      colormap: st.colormap,
      lowPct: st.lowPct,
      highPct: st.highPct,
      gamma: st.gamma,
      derived: st.derived,
      showDerived: st.showDerived,
      set: st.set,
    })),
  );
  const cube = s.cube!;
  const presets: { label: string; bands: [number, number, number] | null | undefined }[] = [
    { label: 'True colour', bands: trueColorBands(cube) },
    { label: 'Colour IR', bands: falseColorBands(cube) },
    { label: 'File default', bands: cube.defaultBands },
    { label: 'Spread', bands: spreadBands(cube) },
  ];

  return (
    <section className="panel">
      <h2>Display</h2>
      {s.showDerived && s.derived && (
        <p className="note">
          Showing analysis layer “{s.derived.name}”.{' '}
          <button className="link" onClick={() => s.set({ showDerived: false })}>
            Back to cube
          </button>
        </p>
      )}
      <div className="seg full" role="group" aria-label="Display mode">
        <button className={s.mode === 'single' ? 'on' : ''} onClick={() => s.set({ mode: 'single', showDerived: false })}>
          Single band
        </button>
        <button className={s.mode === 'rgb' ? 'on' : ''} onClick={() => s.set({ mode: 'rgb', showDerived: false })} disabled={cube.bands < 3}>
          RGB composite
        </button>
      </div>

      {s.mode === 'single' ? (
        <>
          <BandSlider label="Band" value={s.band} onChange={(band) => s.set({ band, showDerived: false })} />
          <div className="field">
            <span>Colormap</span>
            <div className="colormaps">
              {COLORMAPS.map((c: ColormapName) => (
                <button
                  key={c}
                  className={`cmap${s.colormap === c ? ' on' : ''}`}
                  style={{ background: colormapGradient(c) }}
                  onClick={() => s.set({ colormap: c })}
                  title={c}
                  aria-label={`Colormap ${c}`}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="presets">
            {presets.map(
              (p) =>
                p.bands && (
                  <button key={p.label} onClick={() => s.set({ rgb: p.bands!, showDerived: false })}>
                    {p.label}
                  </button>
                ),
            )}
          </div>
          {(['Red', 'Green', 'Blue'] as const).map((name, i) => (
            <BandSlider
              key={name}
              label={name}
              accent={['#ff6b6b', '#5fd27a', '#6ea0ff'][i]}
              value={s.rgb[i]}
              onChange={(b) => {
                const rgb = [...s.rgb] as [number, number, number];
                rgb[i] = b;
                s.set({ rgb, showDerived: false });
              }}
            />
          ))}
        </>
      )}

      <div className="stretch">
        <label>
          <span>
            Low clip <b>{s.lowPct}%</b>
          </span>
          <input type="range" min={0} max={20} step={0.5} value={s.lowPct} onChange={(e) => s.set({ lowPct: Number(e.target.value) })} />
        </label>
        <label>
          <span>
            High clip <b>{s.highPct}%</b>
          </span>
          <input type="range" min={80} max={100} step={0.5} value={s.highPct} onChange={(e) => s.set({ highPct: Number(e.target.value) })} />
        </label>
        <label>
          <span>
            Gamma <b>{s.gamma.toFixed(2)}</b>
          </span>
          <input type="range" min={0.3} max={3} step={0.05} value={s.gamma} onChange={(e) => s.set({ gamma: Number(e.target.value) })} />
        </label>
      </div>
    </section>
  );
}
