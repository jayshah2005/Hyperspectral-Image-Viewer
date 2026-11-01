import { useStore, type Tool } from '../store';
import { SAM_MODELS, type SamModelKey } from '../lib/samModels';

const TOOLS: { tool: Tool; label: string; title: string }[] = [
  { tool: 'pixel', label: 'Pixel', title: 'Inspect pixels (Esc)' },
  { tool: 'point', label: 'Highlight object', title: 'Click an object to outline it (P)' },
  { tool: 'box', label: 'Box', title: 'Drag a box around an object to outline it (B)' },
  { tool: 'select', label: 'Select', title: 'Click a highlight to select it (V)' },
  { tool: 'brush', label: 'Brush', title: 'Paint to correct a highlight (A add, D erase)' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const brushMode = useStore((s) => s.brushMode);
  const brushSize = useStore((s) => s.brushSize);
  const samModel = useStore((s) => s.samModel);
  const samBackend = useStore((s) => s.samBackend);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const activeRegion = useStore((s) => s.activeRegion);
  const samBusy = useStore((s) => s.samBusy);
  const { set, setTool, undo, redo, chooseModel, openEditor } = useStore.getState();

  return (
    <div className="canvas-tools">
      <div className="tool-group" role="group" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.tool} className={tool === t.tool ? 'primary' : undefined} title={t.title} aria-pressed={tool === t.tool} onClick={() => setTool(t.tool)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tool-group">
        <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>
      {(tool === 'point' || tool === 'box') && (
        <label className="tool-chip" title="The outlining model. Base+ is more precise; Tiny is a smaller download.">
          <span>Model</span>
          <select value={samModel} onChange={(e) => chooseModel(e.target.value as SamModelKey)}>
            {Object.entries(SAM_MODELS).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
          {samBackend && <span data-backend={samBackend}>{samBackend === 'webgpu' ? 'on GPU' : 'on CPU'}</span>}
        </label>
      )}
      {tool === 'brush' && (
        <div className="tool-chip">
          <button className={brushMode === 'add' ? 'primary' : undefined} onClick={() => set({ brushMode: 'add' })} title="Add (A)">
            Add
          </button>
          <button className={brushMode === 'erase' ? 'primary' : undefined} onClick={() => set({ brushMode: 'erase' })} title="Erase (D)">
            Erase
          </button>
          <label className="brush-size" title="Brush size ([ and ])">
            <span>{brushSize} px</span>
            <input type="range" min={1} max={60} value={brushSize} onChange={(e) => set({ brushSize: Number(e.target.value) })} />
          </label>
          <button disabled={!activeRegion || samBusy > 0} onClick={() => openEditor(activeRegion)} title="Zoom in on the selected highlight and correct it there">
            Fine-tune
          </button>
        </div>
      )}
    </div>
  );
}
