import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { loadDemo, openFiles } from './loaders/client';
import { ImageCanvas } from './components/ImageCanvas';
import { SpectrumPlot } from './components/SpectrumPlot';
import { DisplayControls } from './components/DisplayControls';
import { PinnedList } from './components/PinnedList';
import { AnalysisPanel } from './components/AnalysisPanel';
import { StatusBar } from './components/StatusBar';
import { DatasetPicker } from './components/DatasetPicker';

const FORMATS = [
  ['ENVI', '.hdr + .img / .raw / .dat / .bsq / .bil / .bip — select both files'],
  ['MATLAB', '.mat (v5 – v7.3), e.g. Indian Pines, Pavia, Salinas'],
  ['NumPy', '.npy (3-D array)'],
  ['HDF5', '.h5 / .hdf5 / .he5 / .nc (NetCDF-4)'],
  ['GeoTIFF', 'multi-band .tif / .tiff, or a multi-page band stack'],
];

function useGlobalDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) openFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}

/** ←/→ step through bands (switching to single-band view). */
function useBandKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const s = useStore.getState();
      if (!s.cube) return;
      const step = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      s.set({ mode: 'single', showDerived: false, band: Math.min(s.cube.bands - 1, Math.max(0, s.band + step)) });
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const cube = useStore((s) => s.cube);
  const cubeId = useStore((s) => s.cubeId);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const pickerOpen = useStore((s) => s.pickerOpen);
  const candidates = useStore((s) => s.candidates);
  const set = useStore((s) => s.set);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragOver = useGlobalDrop();
  useBandKeys();

  const canReorient = candidates.length > 1 || candidates.some((c) => c.defaultAxes);
  const pick = () => inputRef.current?.click();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#1d2433" />
            <path d="M4 24 C10 6, 14 6, 18 18 S26 22, 28 8" stroke="#3987e5" strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
          <span>Hyperspectral Viewer</span>
        </div>
        {cube && <span className="cube-name" title={cube.name}>{cube.name}</span>}
        <span className="spacer" />
        {cube && canReorient && <button onClick={() => set({ pickerOpen: true })}>Dataset & axes…</button>}
        <button onClick={loadDemo}>Demo cube</button>
        <button className="primary" onClick={pick}>
          Open files…
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) openFiles(files);
          }}
        />
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button className="icon" onClick={() => set({ error: null })} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {cube ? (
        <main className="workspace" key={cubeId}>
          <ImageCanvas />
          <aside className="sidebar">
            <section className="panel spectrum-panel">
              <h2>Spectrum</h2>
              <SpectrumPlot />
            </section>
            <div className="sidebar-scroll">
              <PinnedList />
              <DisplayControls />
              <AnalysisPanel />
            </div>
          </aside>
        </main>
      ) : (
        <main className="empty">
          <div className="dropzone" onClick={pick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && pick()}>
            <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
              <path d="M6 36 C14 8, 20 8, 26 26 S38 32, 42 10" stroke="#3987e5" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            </svg>
            <h1>Drop a hyperspectral image here</h1>
            <p>or click to choose files. Everything runs locally in your browser; nothing is uploaded.</p>
            <dl className="formats">
              {FORMATS.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <button
            className="demo-link"
            onClick={(e) => {
              e.stopPropagation();
              loadDemo();
            }}
          >
            No data at hand? Load a synthetic demo cube →
          </button>
        </main>
      )}

      <StatusBar />

      {pickerOpen && <DatasetPicker />}
      {dragOver && <div className="drop-overlay">Drop to open</div>}
      {loading && (
        <div className="loading" role="status">
          <span className="spinner" /> {loading}
        </div>
      )}
    </div>
  );
}
