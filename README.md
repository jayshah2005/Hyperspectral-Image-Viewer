# Hyperspectral Image Viewer

A minimal browser app for hyperspectral image cubes. Open a file to see it as an RGB image, then click any pixel to plot its spectrum. Files are decoded locally in a Web Worker, so nothing is uploaded.

Built with React 18, TypeScript and Vite. The plot uses uPlot.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

No data at hand? Click **Demo cube** to load a real Specim IQ capture of a vine row with a white reference panel (397–1004 nm, 204 bands). It is the full 512 × 512 px cube, rotated upright, stored in `public/demo/` as an ENVI file in two gzipped halves (about 65 MB to download).

| Command           | What it does                               |
| ----------------- | ------------------------------------------ |
| `npm run dev`     | Dev server with hot reload                 |
| `npm run build`   | Type-check + production build into `dist/` |
| `npm run preview` | Serve the production build                 |
| `npm test`        | Unit tests (Vitest)                        |

Requires Node 18+.

## Using it

- **Open:** use **Open files…** or drag files onto the page. For ENVI, select the `.hdr` together with its data file.
- **Image:** shown as an RGB composite. The bands come from the file's `default bands` if it has them, otherwise 640/550/470 nm when the wavelengths cover the visible range, otherwise bands spread across the cube.
- **Pixel spectrum:** hover over the image to preview each pixel's spectrum; click a pixel to keep its spectrum. Hover the plot to read the exact wavelength and value. Drag across the plot to zoom; double-click it to reset.
- **Navigate:** drag the image to pan, scroll to zoom, double-click to fit.

## Supported formats

| Format  | Files | Notes |
| ------- | ----- | ----- |
| ENVI    | `.hdr` + data file (`.img`, `.raw`, `.dat`, `.bsq`, `.bil`, `.bip`, or no extension) | BSQ/BIL/BIP, both byte orders, header offset, data types 1–5 and 12–15. Uses `wavelength`, `bbl`, `data ignore value` and `reflectance scale factor`. |
| MATLAB  | `.mat` v5–v7.3 | If the file has several 3-D arrays, you pick one. A `wavelength*`/`lambda`/`wl` vector is used as the x-axis. |
| NumPy   | `.npy` | 3-D arrays, C or Fortran order. |
| HDF5    | `.h5`, `.hdf5`, `.he5`, `.nc` (NetCDF-4) | Same array picking and wavelength detection as MATLAB. |
| GeoTIFF | `.tif`, `.tiff` | Multi-band images or a multi-page band stack. |

For `.mat`, `.npy` and `.h5` the spectral dimension is guessed:
- if two dimensions are equal (a square image), the third is bands;
- otherwise the smaller of the first and last dimensions is bands.

HDF4 and NetCDF-3 files are not supported.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds the app and publishes `dist/` on every push to `main`. In the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. With "Deploy from a branch", Pages serves the unbuilt source and the page is blank.
