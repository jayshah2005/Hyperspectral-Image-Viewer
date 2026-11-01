import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { countLabel } from '../lib/mask';
import { ImageCanvas, type Viewport } from './ImageCanvas';
import { saveRegionMask } from './saveRegionMask';

const ZOOM_STEP = 1.25;

/** A close-up of one highlight with everything else dimmed, like Fine-tune in the Segmentation app. */
export function ObjectEditor() {
  const editor = useStore((s) => s.editor)!;
  const region = useStore((s) => s.regions.find((r) => r.id === editor.id));
  const labels = useStore((s) => s.labels);
  const statsRev = useStore((s) => s.statsRev);
  const brushMode = useStore((s) => s.brushMode);
  const brushSize = useStore((s) => s.brushSize);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const samBusy = useStore((s) => s.samBusy);
  const error = useStore((s) => s.error);
  const { set, closeEditor, undo, redo, renameRegion, shrinkRegion, resetOutline } = useStore.getState();
  const viewport = useRef<Viewport | null>(null);
  const [zoom, setZoom] = useState(1);
  const pixels = useMemo(() => (labels ? countLabel(labels, editor.id) : 0), [labels, editor.id, statsRev]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <header className="editor-bar">
        <div className="editor-title">
          <h2>Fine-tune</h2>
          <input
            type="text"
            value={region.name}
            aria-label="Highlight name"
            onChange={(e) => renameRegion(region.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span className="editor-stat" data-editor-pixels>
            {pixels.toLocaleString()} px
          </span>
        </div>
        <span className="editor-stat">{Math.round(zoom * 100)}%</span>
        <button onClick={() => viewport.current?.zoomBy(ZOOM_STEP)}>Zoom +</button>
        <button onClick={() => viewport.current?.zoomBy(1 / ZOOM_STEP)}>Zoom −</button>
        <button onClick={() => viewport.current?.reset()}>Reset view</button>
        <button className="primary" onClick={closeEditor}>
          Done
        </button>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button className="icon" onClick={() => set({ error: null })} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <ImageCanvas focus={editor} viewport={viewport} onZoom={setZoom} />

      <footer className="editor-bar bottom">
        <div className="tool-group" role="group" aria-label="Brush mode">
          <button className={brushMode === 'add' ? 'primary' : undefined} aria-pressed={brushMode === 'add'} onClick={() => set({ brushMode: 'add' })}>
            Add (A)
          </button>
          <button className={brushMode === 'erase' ? 'primary' : undefined} aria-pressed={brushMode === 'erase'} onClick={() => set({ brushMode: 'erase' })}>
            Erase (D)
          </button>
        </div>
        <label className="brush-size" title="Brush size ([ and ])">
          <span>{brushSize} px</span>
          <input type="range" min={1} max={60} value={brushSize} onChange={(e) => set({ brushSize: Number(e.target.value) })} />
        </label>
        <div className="tool-group">
          <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>
        <button disabled={samBusy > 0} onClick={() => shrinkRegion(region.id)} title="Shave 1 pixel off the edge, to remove a background fringe">
          Shrink 1 px
        </button>
        {(region.points.length > 0 || region.box) && (
          <button disabled={samBusy > 0} onClick={() => void resetOutline(region.id)} title="Discard the edits and outline it again from your clicks">
            Reset to automatic outline
          </button>
        )}
        <span className="spacer" />
        <button onClick={() => saveRegionMask(region)} title="Download this highlight's mask as a black-and-white PNG">
          Save mask
        </button>
      </footer>
    </div>
  );
}
