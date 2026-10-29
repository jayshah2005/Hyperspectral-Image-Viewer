# Hyperspectral Image Viewer

A browser app for viewing and analysing hyperspectral image cubes. Open a file, see it as an image, and click any pixel to see its spectrum. Files are decoded locally in a Web Worker, so nothing is uploaded.

Built with React 18, TypeScript and Vite. Plots use uPlot.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

No data at hand? Click **Demo cube** for a synthetic scene (fields, a river, a road, painted panels; 400–2500 nm, 150 bands).

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Dev server with hot reload      |
| `npm run build`     | Type-check + production build into `dist/` |
| `npm run preview`   | Serve the production build      |
| `npm test`          | Unit tests (Vitest)             |

Requires Node 18+. Versions are pinned for Node 18 (Vite 5, Vitest 2, plugin-react 4).

## Supported formats

| Format | Files | Notes |
| ------ | ----- | ----- |
| ENVI | `.hdr` **plus** its data file (`.img`, `.raw`, `.dat`, `.bsq`, `.bil`, `.bip`, or no extension) | Select or drop both files together. BSQ/BIL/BIP, byte order, header offset and data types 1–5 and 12–15 are supported. Uses `wavelength`, `wavelength units`, `bbl` (bad bands), `data ignore value` and `default bands`. Complex data is not supported. |
| MATLAB | `.mat` v5–v7.2 (including compressed) and v7.3 (HDF5) | Lists every 3-D numeric variable. A 1-D variable whose name looks like `wavelength*`/`lambda`/`wl` with one entry per band is used as the wavelength axis. |
| NumPy | `.npy` | 3-D arrays in C or Fortran order, either endianness. |
| HDF5 | `.h5`, `.hdf5`, `.he5`, `.nc` (NetCDF-4) | Lists every 3-D numeric dataset. Wavelengths come from a matching 1-D dataset or a dataset attribute. |
| GeoTIFF | `.tif`, `.tiff` | Multi-sample images, or a multi-page TIFF with one band per page. Uses GDAL no-data and per-band `wavelength` metadata when present. |

**Dimension order.** For `.mat`, `.npy` and `.h5` the app guesses which dimension is spectral:
- if two dimensions are equal (a square image), the third is bands;
- otherwise the smaller of the first and last dimensions is bands.

If the guess is wrong, use **Dataset & axes…** to choose the band dimension or transpose the image. The same dialog switches between several cubes in one file.

## Using it

**Image**
- **Hover:** shows the spectrum under the cursor live, and the pixel value in the status bar.
- **Click:** pins that pixel's spectrum. Pins get a fixed colour order; after 8 pins the colours repeat with dashed lines.
- **Shift+drag** (or the **Draw ROI** tool): pins a rectangle's mean spectrum with a ±1σ band.
- **Drag** pans, the **wheel** zooms, and **Fit** resets the view.

**Spectrum plot**
- **Drag** across it to zoom the wavelength range; **double-click** to reset.
- **Click** it to jump to that band in single-band view.
- Bad bands are shaded and left as gaps.

**Display**
- **Single band** with a colormap, or an **RGB composite**.
- RGB presets: True colour, Colour IR (NIR/red/green), the file's default bands, and Spread.
- Percentile clip and gamma sliders.
- `←` / `→` step through bands; `Shift` steps 10 at a time.

**Analysis**
- **Spectral Angle Mapper (SAM):** the angle between every pixel and a reference pin (pick it with the **ref** radio button). Dark means similar material, whatever the brightness.
- **Normalized difference:** (A − B)/(A + B) for any two bands. **NDVI bands** picks 860 nm / 650 nm when the wavelengths are known.
- **Export CSV:** writes every pinned spectrum, plus ROI standard deviations, against wavelength.

## Limits

The whole cube is held in memory as its native data type. In practice the browser copes with cubes up to about 1–2 GB.

HDF4 (e.g. Hyperion `.hdf`) and NetCDF-3 files are not supported. HDF5 files are copied into an in-memory filesystem (h5wasm), so they briefly use twice their size. The 4 MB HDF5 decoder only loads when you open an HDF5 or v7.3 `.mat` file.

## Project layout

```
src/
  loaders/     format parsers (envi, npy, mat, hdf5, geotiff), axis handling, demo cube, worker client
  worker/      Web Worker that opens files and transfers the decoded cube back
  lib/         cube access, percentile stretch, colormaps, rendering, analysis (ROI, SAM, ND, CSV)
  components/  ImageCanvas, SpectrumPlot, DisplayControls, PinnedList, AnalysisPanel, DatasetPicker, StatusBar
  store.ts     app state (zustand)
```

Every cube is stored band-sequential (`data[b*H*W + y*W + x]`), so a band image is a contiguous slice and a spectrum is a strided read.
