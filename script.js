const PALETTE_SIZES = [3, 5, 7, 10];
const MAX_SAMPLE_SIZE = 120;
const KMEANS_ITERATIONS = 12;
const KMEANS_RUNS = 3;
const DEDUPE_DISTANCE = 28;
const ALPHA_THRESHOLD = 128;

const form = document.getElementById("palette-form");
const imageInput = document.getElementById("image-input");
const dropZone = document.getElementById("drop-zone");
const fileNameEl = document.getElementById("file-name");
const previewSection = document.getElementById("preview-section");
const previewImage = document.getElementById("preview-image");
const palettesEl = document.getElementById("palettes");
const statusEl = document.getElementById("status");
const downloadAllWrap = document.getElementById("download-all-wrap");
const downloadAllBtn = document.getElementById("download-all");

/** @type {{ size: number, colors: number[][] }[]} */
let currentPalettes = [];
let sourceFileName = "image";
/** @type {string | null} */
let previewObjectUrl = null;
let dragDepth = 0;
let lastProcessKey = "";
let lastProcessAt = 0;

imageInput.addEventListener("change", handleImageChange);
downloadAllBtn.addEventListener("click", async () => {
  if (!currentPalettes.length) return;
  const result = await downloadPaletteImage(
    currentPalettes,
    `${slugify(sourceFileName)}-all-palettes.png`
  );
  announceSaveResult(result, "All palettes saved as an image.");
});

const dragListenerOptions = { capture: true };
window.addEventListener("dragenter", handleWindowDragEnter, dragListenerOptions);
window.addEventListener("dragover", handleWindowDragOver, dragListenerOptions);
window.addEventListener("dragleave", handleWindowDragLeave, dragListenerOptions);
window.addEventListener("drop", handleWindowDrop, dragListenerOptions);

function handleImageChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  processImageFile(file);
}

/**
 * Shared path for file-picker and drag-and-drop input.
 * @param {File} file
 */
async function processImageFile(file) {
  if (!isImageFile(file)) {
    setStatus("Please choose an image file (PNG, JPG, WEBP, or GIF).", true);
    return;
  }

  const processKey = `${file.name}:${file.size}:${file.lastModified}`;
  const now = Date.now();
  if (processKey === lastProcessKey && now - lastProcessAt < 800) return;
  lastProcessKey = processKey;
  lastProcessAt = now;

  syncFileInput(file);
  clearStatus();
  sourceFileName = file.name.replace(/\.[^.]+$/, "") || "image";
  fileNameEl.hidden = false;
  fileNameEl.textContent = `Subject: ${file.name}`;

  try {
    setStatus("Measuring the pigments…");

    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    previewObjectUrl = URL.createObjectURL(file);
    const image = await loadImage(previewObjectUrl);

    previewImage.src = previewObjectUrl;
    previewSection.hidden = false;

    const pixels = samplePixels(image);
    if (pixels.length === 0) {
      throw new Error("No opaque pixels found in this image.");
    }

    renderPalettes(pixels);
    setStatus("Click a swatch to copy · ↓ downloads one row · or save all below.");
  } catch (error) {
    console.error(error);
    currentPalettes = [];
    palettesEl.innerHTML = "";
    downloadAllWrap.hidden = true;
    previewSection.hidden = true;
    previewImage.removeAttribute("src");
    setStatus(error.message || "Could not process that image.", true);
  }
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|tif{1,2})$/i.test(file.name);
}

function syncFileInput(file) {
  if (imageInput.files?.[0] === file) return;
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    imageInput.files = transfer.files;
  } catch {
    // FileList assignment is not available in every browser; the picker still works.
  }
}

function transferTypes(dataTransfer) {
  if (!dataTransfer?.types) return [];
  try {
    return Array.from(dataTransfer.types).map((type) => String(type));
  } catch {
    return [];
  }
}

function dataTransferHasFiles(event) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return false;
  if (dataTransfer.files?.length) return true;
  if (
    transferTypes(dataTransfer).some(
      (type) => type.toLowerCase() === "files" || type === "application/x-moz-file"
    )
  ) {
    return true;
  }
  return [...(dataTransfer.items || [])].some((item) => item.kind === "file");
}

function isDroppablePayload(event) {
  if (dataTransferHasFiles(event)) return true;
  return transferTypes(event.dataTransfer).some((type) =>
    ["text/uri-list", "text/html", "text/plain", "url"].includes(type.toLowerCase())
  );
}

function getDroppedImageFile(dataTransfer) {
  if (!dataTransfer) return null;

  const files = [...(dataTransfer.files || [])];
  const fromFiles = files.find(isImageFile);
  if (fromFiles) return fromFiles;

  for (const item of dataTransfer.items || []) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (isImageFile(file)) return file;
  }

  return null;
}

async function getDroppedImageFromUri(dataTransfer) {
  if (!dataTransfer) return null;

  const html = dataTransfer.getData("text/html") || "";
  const fromHtml = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  const fromUri = (dataTransfer.getData("text/uri-list") || "")
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith("#"));
  const url = (fromHtml || fromUri || dataTransfer.getData("text/plain") || "").trim();
  if (!url || !/^(https?:|data:image|blob:)/i.test(url)) return null;

  return fileFromImageUrl(url);
}

async function fileFromImageUrl(url) {
  const nameFromUrl = url.split("/").pop()?.split("?")[0] || "dropped-image.png";
  const fileName = /\.[a-z0-9]+$/i.test(nameFromUrl) ? nameFromUrl : "dropped-image.png";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not fetch image.");
    const blob = await response.blob();
    const type = blob.type.startsWith("image/") ? blob.type : "image/png";
    return new File([blob], fileName, { type });
  } catch {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Could not read that image."));
      }, "image/png");
    });
    return new File([blob], fileName.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
  }
}

function setDropActive(active) {
  dropZone.classList.toggle("is-dragover", active);
}

function handleWindowDragEnter(event) {
  event.preventDefault();
  dragDepth += 1;
  setDropActive(true);
}

function handleWindowDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) {
    try {
      event.dataTransfer.dropEffect = "copy";
    } catch {
      // Some browsers reject dropEffect changes during OS file drags.
    }
  }
  setDropActive(true);
}

function handleWindowDragLeave(event) {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0 || !event.relatedTarget) setDropActive(false);
  if (!event.relatedTarget) dragDepth = 0;
}

async function handleWindowDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  dragDepth = 0;
  setDropActive(false);

  try {
    const file =
      getDroppedImageFile(event.dataTransfer) || (await getDroppedImageFromUri(event.dataTransfer));
    if (!file) {
      if (dataTransferHasFiles(event) || isDroppablePayload(event)) {
        setStatus("Please drop an image file (PNG, JPG, WEBP, or GIF).", true);
      }
      return;
    }
    await processImageFile(file);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not use that dropped image.", true);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load the image."));
    image.src = src;
  });
}

function samplePixels(image) {
  const scale = Math.min(1, MAX_SAMPLE_SIZE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const pixels = [];

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_THRESHOLD) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  return pixels;
}

function renderPalettes(pixels) {
  palettesEl.innerHTML = "";
  currentPalettes = [];

  const sheet = document.createElement("div");
  sheet.className = "palette-sheet";

  for (const size of PALETTE_SIZES) {
    const colors = extractPalette(pixels, size);
    currentPalettes.push({ size, colors });

    const row = document.createElement("article");
    row.className = "palette-row";

    const meta = document.createElement("div");
    meta.className = "palette-row__meta";

    const heading = document.createElement("h2");
    heading.className = "palette-row__label";
    heading.textContent = String(size);
    heading.title =
      colors.length === size
        ? `${size}-color palette`
        : `${size}-color palette (${colors.length} distinct)`;

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "palette-row__download";
    downloadBtn.textContent = "↓";
    downloadBtn.title = `Download ${size}-color palette`;
    downloadBtn.setAttribute("aria-label", `Download ${size}-color palette`);
    downloadBtn.addEventListener("click", async () => {
      const result = await downloadPaletteImage(
        [{ size, colors }],
        `${slugify(sourceFileName)}-${size}-colors.png`
      );
      announceSaveResult(result, `${size}-color palette saved as an image.`);
    });

    meta.append(heading, downloadBtn);

    const swatches = document.createElement("div");
    swatches.className = "swatches";
    swatches.style.setProperty("--swatch-count", String(colors.length));
    swatches.setAttribute("role", "list");
    swatches.setAttribute("aria-label", `${size}-color palette`);

    for (const color of colors) {
      const hex = rgbToHex(color);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.style.backgroundColor = hex;
      button.title = `Copy ${hex}`;
      button.setAttribute("aria-label", `Copy color ${hex}`);
      button.setAttribute("role", "listitem");

      const label = document.createElement("span");
      label.className = "swatch__hex";
      label.textContent = hex;

      button.append(label);
      button.addEventListener("click", () => copyHex(hex, button, label));
      swatches.append(button);
    }

    row.append(meta, swatches);
    sheet.append(row);
  }

  palettesEl.append(sheet);
  downloadAllWrap.hidden = false;
}

async function copyHex(hex, button, label) {
  try {
    await navigator.clipboard.writeText(hex);
    button.classList.add("is-copied");
    label.textContent = "Copied";
    setStatus(`Copied ${hex}`);
    window.setTimeout(() => {
      button.classList.remove("is-copied");
      label.textContent = hex;
    }, 900);
  } catch {
    setStatus(`Could not copy ${hex}. Select and copy it manually.`, true);
  }
}

/**
 * Render one or more palettes onto a parchment-styled canvas and download as PNG.
 * @param {{ size: number, colors: number[][] }[]} palettes
 * @param {string} filename
 * @returns {Promise<"shared" | "opened" | "downloaded" | "cancelled" | "failed">}
 */
async function downloadPaletteImage(palettes, filename) {
  const width = 1000;
  const margin = 48;
  const titleBlock = 110;
  const rowGap = 36;
  const swatchHeight = 92;
  const labelBand = 36;
  const rowHeight = 52 + swatchHeight + labelBand;
  const height = margin * 2 + titleBlock + palettes.length * rowHeight + (palettes.length - 1) * rowGap;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  drawParchmentBackground(ctx, width, height);

  ctx.fillStyle = "#2a2118";
  ctx.font = "italic 42px 'IM Fell English', 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.fillText("Codex of Colour", width / 2, margin + 42);

  ctx.fillStyle = "#8a5a32";
  ctx.font = "600 20px 'Source Sans 3', 'Segoe UI', sans-serif";
  ctx.fillText(`Pigment studies from “${sourceFileName}”`, width / 2, margin + 78);

  drawInkRule(ctx, width / 2, margin + 96, 120);

  let y = margin + titleBlock;

  for (const palette of palettes) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#2a2118";
    ctx.font = "italic 26px 'IM Fell English', 'Times New Roman', serif";
    ctx.fillText(`Study of ${palette.size} hues`, margin, y + 28);

    const innerWidth = width - margin * 2;
    const swatchWidth = innerWidth / palette.colors.length;
    const swatchY = y + 44;
    const frameX = margin - 6;
    const frameY = swatchY - 6;
    const frameW = innerWidth + 12;
    const frameH = swatchHeight + labelBand + 12;

    ctx.strokeStyle = "rgba(42, 33, 24, 0.35)";
    ctx.lineWidth = 1;
    strokeRoundRect(ctx, frameX, frameY, frameW, frameH, 12);

    palette.colors.forEach((color, index) => {
      const x = margin + index * swatchWidth;
      const hex = rgbToHex(color);
      const isFirst = index === 0;
      const isLast = index === palette.colors.length - 1;
      const radii = {
        tl: isFirst ? 8 : 0,
        tr: isLast ? 8 : 0,
        br: isLast ? 8 : 0,
        bl: isFirst ? 8 : 0,
      };

      ctx.save();
      pathRoundRectCorners(ctx, x, swatchY, swatchWidth, swatchHeight, radii);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#2a2118";
      ctx.font = "700 16px 'Source Sans 3', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(hex, x + swatchWidth / 2, swatchY + swatchHeight + 26);
    });

    y += rowHeight + rowGap;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#6b4e32";
  ctx.font = "600 15px 'Source Sans 3', 'Segoe UI', sans-serif";
  ctx.fillText("Extracted by k-means · folio of the browser studio", width / 2, height - 20);

  try {
    return await savePngFromCanvas(canvas, filename);
  } catch (error) {
    console.error(error);
    return "failed";
  }
}

/**
 * iPad/iPhone Safari ignores <a download>. Share the PNG when possible;
 * otherwise open it in a new tab so it can be saved with tap-and-hold.
 * Desktop keeps a normal file download.
 * @returns {Promise<"shared" | "opened" | "downloaded" | "cancelled" | "failed">}
 */
async function savePngFromCanvas(canvas, filename) {
  const dataUrl = canvas.toDataURL("image/png");
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], filename, { type: "image/png" });

  if (isAppleTouchDevice()) {
    if (canShareFiles(file)) {
      try {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      } catch (error) {
        if (error?.name === "AbortError") return "cancelled";
      }
    }

    const link = document.createElement("a");
    link.href = dataUrl;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return "opened";
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  return "downloaded";
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "image/png" });
}

function isAppleTouchDevice() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as Macintosh with a touch screen.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function canShareFiles(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

function announceSaveResult(result, downloadedMessage) {
  if (result === "cancelled") return;
  if (result === "shared") {
    setStatus("Use the share sheet to save the palette image.");
    return;
  }
  if (result === "opened") {
    setStatus("Image opened in a new tab — tap and hold to save it.");
    return;
  }
  if (result === "failed") {
    setStatus("Could not save the palette image.", true);
    return;
  }
  setStatus(downloadedMessage);
}

function drawParchmentBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f0e4cc");
  gradient.addColorStop(0.45, "#e8dcc4");
  gradient.addColorStop(1, "#d9c7a5");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const stainA = ctx.createRadialGradient(width * 0.15, height * 0.1, 10, width * 0.15, height * 0.1, width * 0.4);
  stainA.addColorStop(0, "rgba(255, 248, 230, 0.45)");
  stainA.addColorStop(1, "transparent");
  ctx.fillStyle = stainA;
  ctx.fillRect(0, 0, width, height);

  const stainB = ctx.createRadialGradient(width * 0.85, height * 0.9, 10, width * 0.85, height * 0.9, width * 0.35);
  stainB.addColorStop(0, "rgba(160, 120, 70, 0.18)");
  stainB.addColorStop(1, "transparent");
  ctx.fillStyle = stainB;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(42, 33, 24, 0.2)";
  ctx.lineWidth = 1;
  strokeRoundRect(ctx, 18, 18, width - 36, height - 36, 18);
  strokeRoundRect(ctx, 24, 24, width - 48, height - 48, 14);
}

function strokeRoundRect(ctx, x, y, w, h, r) {
  pathRoundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

function pathRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function pathRoundRectCorners(ctx, x, y, w, h, radii) {
  const tl = Math.min(radii.tl || 0, w / 2, h / 2);
  const tr = Math.min(radii.tr || 0, w / 2, h / 2);
  const br = Math.min(radii.br || 0, w / 2, h / 2);
  const bl = Math.min(radii.bl || 0, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function drawInkRule(ctx, cx, y, halfWidth) {
  ctx.strokeStyle = "rgba(42, 33, 24, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, y);
  ctx.lineTo(cx - 8, y);
  ctx.moveTo(cx + 8, y);
  ctx.lineTo(cx + halfWidth, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, y, 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "palette";
}

function extractPalette(pixels, k) {
  const target = Math.min(k, pixels.length);
  const centers = bestKMeans(pixels, target);
  const deduped = dedupeColors(centers, DEDUPE_DISTANCE);
  const palette = deduped.length >= Math.min(target, 2) ? deduped : centers;
  return sortByLuminance(palette.slice(0, target));
}

function bestKMeans(pixels, k) {
  let bestCenters = null;
  let bestError = Infinity;

  for (let run = 0; run < KMEANS_RUNS; run++) {
    const { centers, error } = kMeans(pixels, k, KMEANS_ITERATIONS);
    if (error < bestError) {
      bestError = error;
      bestCenters = centers;
    }
  }

  return bestCenters;
}

function kMeans(pixels, k, iterations) {
  const count = Math.min(k, pixels.length);
  let centers = initCenters(pixels, count);

  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array.from({ length: count }, () => [0, 0, 0]);
    const sizes = new Array(count).fill(0);

    for (const pixel of pixels) {
      const index = nearestCenterIndex(pixel, centers);
      sums[index][0] += pixel[0];
      sums[index][1] += pixel[1];
      sums[index][2] += pixel[2];
      sizes[index] += 1;
    }

    const nextCenters = centers.map((center, index) => {
      if (sizes[index] === 0) {
        return center;
      }
      return [
        sums[index][0] / sizes[index],
        sums[index][1] / sizes[index],
        sums[index][2] / sizes[index],
      ];
    });

    if (centersConverged(centers, nextCenters)) {
      centers = nextCenters;
      break;
    }

    centers = nextCenters;
  }

  const rounded = centers.map(roundColor);
  const error = totalError(pixels, rounded);
  return { centers: rounded, error };
}

function initCenters(pixels, k) {
  const centers = [];
  const first = pixels[Math.floor(Math.random() * pixels.length)];
  centers.push([...first]);

  while (centers.length < k) {
    let bestPixel = pixels[0];
    let bestDistance = -1;

    for (const pixel of pixels) {
      const distance = Math.min(...centers.map((center) => colorDistanceSq(pixel, center)));
      if (distance > bestDistance) {
        bestDistance = distance;
        bestPixel = pixel;
      }
    }

    centers.push([...bestPixel]);
  }

  return centers;
}

function nearestCenterIndex(pixel, centers) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < centers.length; i++) {
    const distance = colorDistanceSq(pixel, centers[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function centersConverged(a, b, epsilon = 0.5) {
  const threshold = epsilon * epsilon;
  return a.every((center, i) => colorDistanceSq(center, b[i]) < threshold);
}

function totalError(pixels, centers) {
  let error = 0;
  for (const pixel of pixels) {
    error += colorDistanceSq(pixel, centers[nearestCenterIndex(pixel, centers)]);
  }
  return error;
}

function colorDistanceSq(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function luminance(color) {
  return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
}

function sortByLuminance(colors) {
  return [...colors].sort((a, b) => luminance(a) - luminance(b));
}

function dedupeColors(colors, threshold) {
  const unique = [];
  const thresholdSq = threshold * threshold;

  for (const color of colors) {
    if (!unique.some((existing) => colorDistanceSq(existing, color) < thresholdSq)) {
      unique.push(color);
    }
  }

  return unique;
}

function roundColor(color) {
  return [
    Math.min(255, Math.max(0, Math.round(color[0]))),
    Math.min(255, Math.max(0, Math.round(color[1]))),
    Math.min(255, Math.max(0, Math.round(color[2]))),
  ];
}

function rgbToHex([r, g, b]) {
  return (
    "#" +
    [r, g, b]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.classList.remove("is-error");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
});
