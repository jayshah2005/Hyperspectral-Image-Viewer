import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { SAM_MODELS } from '../lib/samModels';

/** Shown once per model, before anything large is downloaded. */
export function ModelNotice() {
  const samModel = useStore((s) => s.samModel);
  const { set, chooseModel, acceptModel } = useStore.getState();
  const [gpu, setGpu] = useState<boolean | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
    (nav.gpu ? nav.gpu.requestAdapter().catch(() => null) : Promise.resolve(null)).then((a) => setGpu(Boolean(a)));
  }, []);

  const m = SAM_MODELS[samModel];
  const size = (key: keyof typeof SAM_MODELS) => (gpu ? SAM_MODELS[key].gpuMB : SAM_MODELS[key].cpuMB);
  const close = () => {
    set({ modelNotice: false, tool: 'pixel' });
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-label="Download the outlining model" onClick={(e) => e.stopPropagation()}>
        <h2>Download the outlining model?</h2>
        <p>
          Highlighting uses SAM 2 {m.label}, which runs inside your browser. It is a one-time download of about{' '}
          <strong>{gpu === null ? '…' : `${size(samModel)} MB`}</strong> from Hugging Face, kept by your browser for next time.
        </p>
        <p className="muted">
          Your images are not uploaded.{' '}
          {gpu === false && 'No usable graphics card was found, so it will run on the processor: about 10 seconds per image.'}
        </p>
        <div className="row end">
          <button onClick={close}>Cancel</button>
          {samModel !== 'tiny' && (
            <button
              disabled={gpu === null}
              onClick={() => {
                chooseModel('tiny');
                useStore.getState().acceptModel();
              }}
            >
              Use smaller model ({gpu === null ? '…' : size('tiny')} MB)
            </button>
          )}
          <button className="primary" disabled={gpu === null} onClick={acceptModel}>
            Download {m.label}
          </button>
        </div>
      </div>
    </div>
  );
}
