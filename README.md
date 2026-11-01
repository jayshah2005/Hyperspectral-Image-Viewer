# Hyperspectral Image Viewer

A browser app for hyperspectral image cubes. Open a file to see it as an RGB image, click any pixel to plot its spectrum, and click a leaf to outline it with SAM 2 and graph its mean spectrum. Correct the outline by hand, export spectra as CSV, and find your highlights there next time you open the image. Everything runs in your browser, so your images are never uploaded.

Built with React 18, TypeScript and Vite. The plot uses uPlot; SAM 2 runs through Transformers.js and ONNX Runtime.

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
- **Navigate:** scroll to zoom, drag to pan (Space-drag while using the Brush or Box), double-click to fit.

### Pixels

With the **Pixel** tool, hover over the image to preview a pixel's spectrum and click to keep it. **Export CSV** saves that pixel's spectrum. **Shift+click** adds single pixels to a set, which then works like any other highlight. Read the graph by hovering over it; drag across it to zoom, double-click to reset.

### Highlighting a leaf

1. Choose **Highlight object** (P) and click a leaf. One click outlines one object; click more leaves to outline them too. Clicking an existing highlight selects it.
2. The graph shows the mean spectrum of every highlight in its own colour.
3. Correct the outline if it isn't quite right:

| To | Do |
| ---- | --- |
| Add a missed part | **Ctrl+click** it |
| Leave a part out | **Right-click** (or **Shift+click**) it |
| Remove a click | Click its dot, or press **Backspace** for the last one |
| Outline with a box | **Box** tool (B), then drag around the object |
| Paint by hand | **Fine-tune** on the highlight's row, or the **Brush** tool on the main view |
| Undo or redo | **Ctrl+Z**, **Ctrl+Shift+Z** |

**Fine-tune** opens a close-up of one highlight with everything else dimmed and its exact edge drawn:

- **A** adds, **D** erases, **[** and **]** change the brush size. Scroll to zoom, hold Space and drag to move, **Esc** or **Done** to return.
- **Shrink 1 px** shaves the edge, to remove a background fringe.
- **Reset to automatic outline** discards the edits and outlines it again from your clicks.
- **Undo** here only goes back to when you opened it, so it can't touch other highlights. Back in the main view, every step can be undone.

Add, leave-out and brush edits apply to the selected highlight. Choose one in the list or with the **Select** tool (V). Re-outlining a highlight you have painted on asks first, because it replaces the brush work. Double-click a name to rename it.

### The outlining model

The first time you highlight something, the app offers to download SAM 2.1: **Base+** by default, or **Tiny** if you'd like a smaller download. You can switch in the toolbar. The download comes from Hugging Face once and is then kept by your browser. It runs on your graphics card where the browser offers WebGPU and on the processor otherwise.

| Model | Download (GPU / processor) | Preparing an image on a processor |
| ------ | ---------------------------- | --------------------------- |
| Base+ | about 327 MB / 108 MB | about 10 s |
| Tiny | about 155 MB / 61 MB | about 5 s |

After that, each click takes a fraction of a second. On a graphics card, preparing an image takes under a second. On the processor the outlines are slightly less exact, because that model is stored at 8-bit precision.

### Saving

Highlights are saved automatically in this browser every time you change them, and come back when you open the same image again. Images are recognised by their contents, so renaming a file keeps its highlights, and a different file that happens to share its name doesn't get them. Identical copies of an image share highlights.

Browser storage belongs to one browser on one computer, and clearing site data erases it. Save masks to keep your work.

### Masks

**Mask** on a row saves one highlight; **Save masks** saves them all as a zip, with an `objects.csv` listing each one's name, file, bounding box, area and centre. **Import masks** brings them back, from PNG files or a zip. You can also drop them on the page.

Each mask is a full-image, single-channel PNG: 0 outside, 255 inside, the same values as the Segmentation app's `_mask.png`. It has one value per image pixel, with the same rows and columns as the file as opened here:

```python
import numpy as np
from PIL import Image
from spectral.io import envi

cube = np.asarray(envi.open('capture.hdr', 'capture.img').load())  # lines, samples, bands
mask = np.array(Image.open('Leaf-A_mask.png')) > 0                 # lines, samples
leaf_pixels = cube[mask]                                           # pixels, bands
mean_spectrum = leaf_pixels.mean(axis=0)
```

If your pipeline rotates captures, as `rot90_cw` cut-outs do, rotate the mask the same way. Data outside the leaf isn't excluded for you: where a file marks no-data with a value, such as `data ignore value = 0`, filter it out as the app does.

When you import:

- **Names and clicks come back.** Masks from this app carry their highlight's name and clicks, so you can keep refining them. A mask made by another program is named after its file (`Leaf_A_mask.png` becomes `Leaf_A`) and can be painted on.
- **Same name, same highlight.** A mask named like an existing highlight replaces it, so importing twice changes nothing. Any other mask becomes a new highlight. One Ctrl+Z undoes the whole import.
- **Masks can't overlap.** A pixel belongs to one highlight, so pixels another highlight already holds are left out, and the app says how many.
- **The image is checked.** A mask from this app that was made for a different image asks before importing. A mask must match the image's size, so a cropped one (the Segmentation app's default) or a rotated one is refused. A mask from another program carries no record of its image, so only its size can be checked.
- **Formats.** Any non-interlaced PNG works: gray, RGB, palette or with alpha, 1 to 16 bits, including masks saved as 0 and 1. Fully transparent pixels count as outside.

### CSV files

The first line of every file is its header, so they open directly in Excel and in `pandas.read_csv`. Bad bands and no-data values are empty cells.

| Button | Columns | Rows |
| ------ | ------- | ---- |
| **Means CSV**, or **CSV** on one highlight | `band`, `wavelength_nm`, then `<name>_mean`, `<name>_std`, `<name>_n` per highlight | one per band |
| **All pixels CSV** | `region`, `x`, `y`, then one column per wavelength | one per highlighted pixel |
| **Export CSV** (selected pixel) | `band`, `wavelength_nm`, `value` | one per band |

`_std` is the sample standard deviation and `_n` the number of valid pixels in that band.

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
