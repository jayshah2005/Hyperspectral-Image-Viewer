import { useRef, useState } from 'react';
import { useStore } from '../store';
import { regionCss } from '../lib/colors';
import { meansCsv, pixelsCsvBytes, pixelsCsvParts, safeFilename } from '../lib/csv';
import { downloadBlob } from '../lib/download';
import type { Region } from '../lib/highlights';
import { masksZip } from '../lib/maskFile';
import { importMaskFiles } from '../loaders/client';
import { saveRegionMask } from './saveRegionMask';
import { useRegionStats } from './useRegionStats';

const MB = 1e6;
const LARGE_EXPORT = 200 * MB;

/**
 * Plain text until double-clicked. An always-on text box would take the keyboard as soon as a row
 * is clicked, so pressing A for the brush would type into the name instead.
 */
function RegionName({ id, name }: { id: number; name: string }) {
  const [editing, setEditing] = useState(false);
  const { renameRegion } = useStore.getState();
  if (!editing) {
    return (
      <span
        className="region-name"
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {name}
      </span>
    );
  }
  return (
    <input
      className="region-name"
      autoFocus
      value={name}
      aria-label="Highlight name"
      onChange={(e) => renameRegion(id, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.stopPropagation();
          setEditing(false);
        }
      }}
    />
  );
}

/** The highlights in this image: choose, name, correct, delete and export them. */
export function RegionsPanel() {
  const cube = useStore((s) => s.cube)!;
  const regions = useStore((s) => s.regions);
  const activeRegion = useStore((s) => s.activeRegion);
  const stats = useRegionStats();
  const fileRef = useRef<HTMLInputElement>(null);
  const samBusy = useStore((s) => s.samBusy);
  const { set, openEditor, deleteRegion, clearHighlights } = useStore.getState();
  const base = safeFilename(cube.name);

  const exportMeans = (list: Region[]) => {
    const rows = list.flatMap((r) => {
      const s = stats.get(r.id);
      return s ? [{ name: r.name, stats: s }] : [];
    });
    const tag = list.length === 1 ? safeFilename(list[0].name) : 'all';
    downloadBlob(`${base}-means-${tag}.csv`, [meansCsv(cube, rows)], 'text/csv;charset=utf-8');
  };

  const exportPixels = () => {
    const pixels = regions.reduce((n, r) => n + (stats.get(r.id)?.count ?? 0), 0);
    const size = pixelsCsvBytes(pixels, cube.bands);
    if (size > LARGE_EXPORT && !window.confirm(`This file will be about ${Math.round(size / MB)} MB (${pixels.toLocaleString()} pixels). Continue?`)) return;
    const labels = useStore.getState().labels!;
    downloadBlob(`${base}-pixels.csv`, pixelsCsvParts(cube, labels, regions), 'text/csv;charset=utf-8');
  };

  const saveMasks = () => {
    const s = useStore.getState();
    downloadBlob(`${base}_masks.zip`, [masksZip(cube, s.fingerprint, s.labels!, s.regions)], 'application/zip');
  };

  return (
    <section className="regions" aria-label="Highlights">
      <div className="regions-head">
        <h2>Highlights {regions.length > 0 && <span className="muted">({regions.length})</span>}</h2>
        <span className="spacer" />
        <button disabled={!regions.length} onClick={() => exportMeans(regions)} title="One table: the mean spectrum of each highlight">
          Means CSV
        </button>
        <button disabled={!regions.length} onClick={exportPixels} title="One table: every highlighted pixel's spectrum">
          All pixels CSV
        </button>
        <button disabled={!regions.length} onClick={saveMasks} title="A zip with one black-and-white PNG per highlight, to import later or use in your own scripts">
          Save masks
        </button>
        <button onClick={() => fileRef.current?.click()} title="Bring back saved masks: PNG files or a zip of them. You can also drop them on the page.">
          Import masks
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".png,.zip,image/png,application/zip"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void importMaskFiles(files);
          }}
        />
      </div>

      {regions.length === 0 ? (
        <p className="muted regions-empty">
          None yet. Choose <strong>Highlight object</strong> and click a leaf. Highlights are saved automatically in this browser.
        </p>
      ) : (
        <ul className="region-list">
          {regions.map((r) => (
            <li key={r.id} className={r.id === activeRegion ? 'region active' : 'region'} onClick={() => set({ activeRegion: r.id })}>
              <span className="swatch" style={{ background: regionCss(r.id - 1) }} aria-hidden />
              <RegionName id={r.id} name={r.name} />
              <span className="region-count">{(stats.get(r.id)?.count ?? 0).toLocaleString()} px</span>
              <button
                disabled={samBusy > 0}
                title="Zoom in and correct this highlight with the brush"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditor(r.id);
                }}
              >
                Fine-tune
              </button>
              <button
                title="This highlight's mean spectrum as CSV"
                onClick={(e) => {
                  e.stopPropagation();
                  exportMeans([r]);
                }}
              >
                CSV
              </button>
              <button
                title="This highlight's mask as a black-and-white PNG"
                onClick={(e) => {
                  e.stopPropagation();
                  saveRegionMask(r);
                }}
              >
                Mask
              </button>
              <button
                className="icon"
                aria-label={`Delete ${r.name}`}
                title="Delete (undo with Ctrl+Z)"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteRegion(r.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {regions.length > 1 && (
        <button
          className="clear-all"
          onClick={() => {
            if (window.confirm(`Remove all ${regions.length} highlights from this image? You can undo this.`)) clearHighlights();
          }}
        >
          Clear all
        </button>
      )}
    </section>
  );
}
