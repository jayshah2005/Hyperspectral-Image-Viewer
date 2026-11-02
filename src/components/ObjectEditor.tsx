import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { countLabel } from '../lib/mask';
import { ImageCanvas, type Viewport } from './ImageCanvas';
import { saveRegionMask } from './saveRegionMask';

const ZOOM_STEP = 1.25;

/** Sliders give the keyboard back as soon as they're let go, or A, D and Ctrl+Z would stop working. */
const release = (e: React.PointerEvent<HTMLInputElement>) => e.currentTarget.blur();

/** A square crop around one highlight, with everything else dimmed. Modelled on Fine-tune in the Segmentation app. */
export function ObjectEditor() {
  const editor = useStore((s) => s.editor)!;
  const region = useStore((s) => s.regions.find((r) => r.id === editor.id));
  const labels = useStore((s) => s.labels);
  const statsRev = useStore((s) => s.statsRev);
  const brushMode = useStore((s) => s.brushMode);
  const brushSize = useStore((s) => s.brushSize);
  const trimValue = useStore((s) => s.trimValue);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const samBusy = useStore((s) => s.samBusy);
  const error = useStore((s) => s.error);
  const { set, closeEditor, undo, redo, renameRegion, trimRegion, resetOutline } = useStore.getState();
  const viewport = useRef<Viewport | null>(null);
  const [zoom, setZoom] = useState(1);
  const pixels = useMemo(() => (labels ? countLabel(labels, editor.id) : 0), [labels, editor.id, statsRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const { x0, y0, w, h } = editor.rect;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useStore.getState().modelNotice) return;
      e.preventDefault();
      e.stopPropagation();
      closeEditor();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeEditor]);

  // Nothing behind the editor should take the keyboard or a screen reader's attention.
  useEffect(() => {
    const behind = document.querySelectorAll('.topbar, .workspace');
    behind.forEach((el) => el.setAttribute('inert', ''));
    return () => behind.forEach((el) => el.removeAttribute('inert'));
  }, []);

  if (!region) return null;

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label={`Fine-tune ${region.name}`}>
      <div className="editor-panel">
        <header className="editor-head">
          <div className="editor-title">
            <h2>Fine-tune</h2>
            <p>Paint with the brush to add or erase. Scroll to zoom, hold Space and drag to move. Esc closes.</p>
          </div>
          <input
            className="editor-name"
            type="text"
            value={region.name}
            aria-label="Highlight name"
            onChange={(e) => renameRegion(region.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span className="editor-pill" data-editor-pixels>
            {pixels.toLocaleString()} px
          </span>
          <span className="editor-pill" data-editor-zoom>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => viewport.current?.zoomBy(ZOOM_STEP)}>Zoom +</button>
          <button onClick={() => viewport.current?.zoomBy(1 / ZOOM_STEP)}>Zoom −</button>
          <button onClick={() => viewport.current?.reset()}>Reset view</button>
          <button className="primary" onClick={closeEditor}>
            Done
          </button>
        </header>

        <div>
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button className="icon" onClick={() => set({ error: null })} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}
        </div>

        {/* A new frame, after resetting the outline, starts a fresh view of it. */}
        <ImageCanvas key={`${x0},${y0},${w},${h}`} focus={editor} viewport={viewport} onZoom={setZoom} />

        <footer className="editor-foot">
          <div className="mode-toggle" role="group" aria-label="Brush mode">
            <button aria-pressed={brushMode === 'add'} onClick={() => set({ brushMode: 'add' })}>
              Add (A)
            </button>
            <button aria-pressed={brushMode === 'erase'} onClick={() => set({ brushMode: 'erase' })}>
              Erase (D)
            </button>
          </div>
          <label className="slider-field" title="[ and ] change it too">
            <span>
              Brush size <strong>{brushSize}</strong> px
            </span>
            <input type="range" min={1} max={60} value={brushSize} onChange={(e) => set({ brushSize: Number(e.target.value) })} onPointerUp={release} />
          </label>
          <div className="tool-group">
            <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
            {(region.points.length > 0 || region.box) && (
              <button disabled={samBusy > 0} onClick={() => void resetOutline(region.id)} title="Discard the edits and outline it again from your clicks">
                Reset to automatic outline
              </button>
            )}
          </div>
          <label className="slider-field" title="Shave the edge, to remove a thin halo of background. Counts from the outline as it was after your last brush stroke.">
            <span>
              Trim edge <strong>{trimValue}</strong> px
            </span>
            <input type="range" min={0} max={50} value={trimValue} disabled={samBusy > 0} onChange={(e) => trimRegion(region.id, Number(e.target.value))} onPointerUp={release} />
          </label>
          <span className="spacer" />
          <button onClick={() => saveRegionMask(region)} title="Download this highlight's mask as a black-and-white PNG">
            Save mask
          </button>
        </footer>
      </div>
    </div>
  );
}
