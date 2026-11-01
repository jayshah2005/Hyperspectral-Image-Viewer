import { useStore } from '../store';
import { downloadBlob } from '../lib/download';
import type { Region } from '../lib/highlights';
import { encodeMaskPng, maskMeta, singleMaskFilename } from '../lib/maskFile';

/** Download one highlight's mask. The file name includes the image, since it lands in a shared Downloads folder. */
export function saveRegionMask(r: Region) {
  const { cube, labels, fingerprint } = useStore.getState();
  if (!cube || !labels) return;
  const png = encodeMaskPng(labels, r.id, cube.width, cube.height, maskMeta(cube.name, fingerprint, r));
  downloadBlob(singleMaskFilename(cube.name, r), [png], 'image/png');
}
