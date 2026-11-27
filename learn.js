/**
 * "How it works" — interactive figures for the five steps of the studio.
 * Reuses the studio's own functions from script.js (samplePixels, initCenters,
 * nearestCenterIndex, kMeans, bestKMeans, totalError, luminance, rgbToHex…)
 * so every figure shows exactly what the tool does.
 */
(() => {
  const panel = document.getElementById("panel-learn");
  if (!panel) return;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const INK = "#241b13";
  const AXES = [
    { dir: [1, 0, 0], color: "#a8452b", label: "R" },
    { dir: [0, 1, 0], color: "#2f8a80", label: "G" },
    { dir: [0, 0, 1], color: "#34507a", label: "B" },
  ];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const toHex = (c) => rgbToHex(c.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
  const css = (c, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : ms));
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });

  function subsample(list, max) {
    if (list.length <= max) return list.slice();
    const out = [];
    const step = list.length / max;
    for (let i = 0; i < max; i++) out.push(list[Math.floor(i * step + Math.random() * step)]);
    return out;
  }

  /* -------------------------------------------------------------- source */

  function makeDemoImage() {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 150;
    const x = c.getContext("2d");
    const sky = x.createLinearGradient(0, 0, 0, 95);
    sky.addColorStop(0, "#2c2a6b");
    sky.addColorStop(0.5, "#a3466a");
    sky.addColorStop(1, "#f08a4b");
    x.fillStyle = sky;
    x.fillRect(0, 0, 240, 95);
    x.fillStyle = "#ffd36b";
    x.beginPath();
    x.arc(165, 78, 22, 0, Math.PI * 2);
    x.fill();
    const sea = x.createLinearGradient(0, 95, 0, 150);
    sea.addColorStop(0, "#2f7f86");
    sea.addColorStop(1, "#16404f");
    x.fillStyle = sea;
    x.fillRect(0, 95, 240, 55);
    x.fillStyle = "rgba(255, 211, 107, 0.6)";
    for (let i = 0; i < 9; i++) x.fillRect(150 + Math.sin(i) * 8, 99 + i * 5, 30 - i * 2, 2);
    x.fillStyle = "#1d3324";
    x.beginPath();
    x.moveTo(0, 96);
    x.lineTo(40, 62);
    x.lineTo(78, 84);
    x.lineTo(112, 58);
    x.lineTo(140, 96);
    x.closePath();
    x.fill();
    return c;
  }

  const source = { image: null, pixels: [], name: "a demo image", demo: true };

  function setSource(detail) {
    if (detail?.image) {
      source.image = detail.image;
      source.pixels = detail.pixels;
      source.name = detail.name || "your image";
      source.demo = false;
    } else {
      source.image = makeDemoImage();
      source.pixels = samplePixels(source.image);
      source.name = "a demo image";
      source.demo = true;
    }
    $("learn-source").textContent = source.demo ? "a demo image" : `“${source.name}”`;
    $("learn-source-hint").hidden = !source.demo;
    $("fact-points").textContent = source.pixels.length.toLocaleString();
    sample.rebuild();
    distance.draw();
    kmeans.reset();
    runs.roll();
    tidy.rebuild();
  }

  /* ---------------------------------------------------------- cube plot */

  class CubePlot {
    constructor(canvas, { theta = -0.72, phi = 0.48, drag = true, labels = true, onTurn } = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.theta = theta;
      this.phi = phi;
      this.labels = labels;
      if (drag) {
        let last = null;
        canvas.style.touchAction = "pan-y";
        canvas.addEventListener("pointerdown", (e) => {
          last = e.clientX;
          canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener("pointermove", (e) => {
          if (last === null) return;
          this.theta += (e.clientX - last) * 0.012;
          last = e.clientX;
          onTurn?.();
        });
        const end = () => (last = null);
        canvas.addEventListener("pointerup", end);
        canvas.addEventListener("pointercancel", end);
      }
    }

    fit() {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (!w || !h) return false;
      if (this.canvas.width !== Math.round(w * DPR) || this.canvas.height !== Math.round(h * DPR)) {
        this.canvas.width = Math.round(w * DPR);
        this.canvas.height = Math.round(h * DPR);
      }
      this.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      this.w = w;
      this.h = h;
      this.S = Math.min(w / 1.7, h / 1.85);
      this.cx = w / 2;
      this.cy = h / 2 + this.S * 0.04;
      return true;
    }

    project([r, g, b]) {
      const x = r / 255 - 0.5;
      const y = g / 255 - 0.5;
      const z = b / 255 - 0.5;
      const c = Math.cos(this.theta);
      const s = Math.sin(this.theta);
      const x1 = x * c - z * s;
      const z1 = x * s + z * c;
      const cp = Math.cos(this.phi);
      const sp = Math.sin(this.phi);
      return { x: this.cx + x1 * this.S, y: this.cy + (-y * cp + z1 * sp) * this.S, d: z1 * cp + y * sp };
    }

    line(a, b, color, width = 1, dash = null) {
      const p = this.project(a);
      const q = this.project(b);
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.restore();
    }

    frame() {
      if (!this.fit()) return false;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      const corners = [];
      for (const r of [0, 255]) for (const g of [0, 255]) for (const b of [0, 255]) corners.push([r, g, b]);
      for (let i = 0; i < 8; i++) {
        for (let j = i + 1; j < 8; j++) {
          const diff = corners[i].filter((v, k) => v !== corners[j][k]).length;
          if (diff === 1) this.line(corners[i], corners[j], "rgba(36, 27, 19, 0.22)");
        }
      }
      for (const axis of AXES) {
        const end = axis.dir.map((v) => v * 290);
        this.line([0, 0, 0], end, axis.color, 1.6);
        for (let t = 64; t < 255; t += 64) {
          const p = this.project(axis.dir.map((v) => v * t));
          ctx.fillStyle = axis.color;
          ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        }
        if (this.labels) {
          const p = this.project(axis.dir.map((v) => v * 318));
          ctx.fillStyle = axis.color;
          ctx.font = "italic 17px 'IM Fell English', serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(axis.label, p.x, p.y);
        }
      }
      return true;
    }

    dots(points, radius = 2.4, alpha = 0.9) {
      const ctx = this.ctx;
      const projected = points.map((pt) => ({ pt, ...this.project(pt) })).sort((a, b) => a.d - b.d);
      for (const { pt, x, y } of projected) {
        ctx.fillStyle = css(pt, alpha);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    marker(color, radius = 9, label = null) {
      const p = this.project(color);
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(36, 27, 19, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - radius - 6, p.y);
      ctx.lineTo(p.x + radius + 6, p.y);
      ctx.moveTo(p.x, p.y - radius - 6);
      ctx.lineTo(p.x, p.y + radius + 6);
      ctx.stroke();
      ctx.fillStyle = css(color);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(245, 236, 216, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius - 2.5, 0, Math.PI * 2);
      ctx.stroke();
      if (label) {
        ctx.fillStyle = INK;
        ctx.font = "600 11px 'Chakra Petch', sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, p.x + radius + 6, p.y - radius - 2);
      }
      ctx.restore();
      return p;
    }
  }

  /* ------------------------------------------------------ 1 · sample */

  const sample = (() => {
    const gridCanvas = $("sample-grid");
    const gctx = gridCanvas.getContext("2d");
    const plot = new CubePlot($("sample-cube"), { onTurn: () => drawCube() });
    const resInput = $("sample-res");
    const readout = $("sample-readout");
    let cells = [];
    let cols = 0;
    let rows = 0;
    let layout = null;
    let active = -1;
    let hovering = false;

    function rebuild() {
      const res = Number(resInput.value);
      $("sample-res-out").textContent = `${res} px`;
      const img = source.image;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = res / Math.max(iw, ih);
      cols = Math.max(1, Math.round(iw * scale));
      rows = Math.max(1, Math.round(ih * scale));
      const c = document.createElement("canvas");
      c.width = cols;
      c.height = rows;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0, cols, rows);
      const { data } = x.getImageData(0, 0, cols, rows);
      cells = [];
      for (let i = 0; i < data.length; i += 4) {
        cells.push({ rgb: [data[i], data[i + 1], data[i + 2]], opaque: data[i + 3] >= ALPHA_THRESHOLD });
      }
      active = cells.findIndex((cell) => cell.opaque);
      draw();
    }

    function drawGrid() {
      const w = gridCanvas.clientWidth;
      const h = gridCanvas.clientHeight;
      if (!w || !h) return;
      gridCanvas.width = Math.round(w * DPR);
      gridCanvas.height = Math.round(h * DPR);
      gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      gctx.clearRect(0, 0, w, h);
      const size = Math.min((w - 8) / cols, (h - 8) / rows);
      const ox = (w - size * cols) / 2;
      const oy = (h - size * rows) / 2;
      layout = { size, ox, oy };
      cells.forEach((cell, index) => {
        const cx = ox + (index % cols) * size;
        const cy = oy + Math.floor(index / cols) * size;
        if (cell.opaque) {
          gctx.fillStyle = css(cell.rgb);
          gctx.fillRect(cx, cy, size, size);
        } else {
          gctx.strokeStyle = "rgba(36, 27, 19, 0.25)";
          gctx.beginPath();
          gctx.moveTo(cx, cy);
          gctx.lineTo(cx + size, cy + size);
          gctx.stroke();
        }
      });
      if (size > 7) {
        gctx.strokeStyle = "rgba(245, 236, 216, 0.35)";
        gctx.lineWidth = 1;
        for (let i = 0; i <= cols; i++) {
          gctx.beginPath();
          gctx.moveTo(ox + i * size, oy);
          gctx.lineTo(ox + i * size, oy + rows * size);
          gctx.stroke();
        }
        for (let j = 0; j <= rows; j++) {
          gctx.beginPath();
          gctx.moveTo(ox, oy + j * size);
          gctx.lineTo(ox + cols * size, oy + j * size);
          gctx.stroke();
        }
      }
      if (active >= 0) {
        const ax = ox + (active % cols) * size;
        const ay = oy + Math.floor(active / cols) * size;
        gctx.strokeStyle = "#f5ecd8";
        gctx.lineWidth = 3;
        gctx.strokeRect(ax - 1, ay - 1, size + 2, size + 2);
        gctx.strokeStyle = INK;
        gctx.lineWidth = 1.5;
        gctx.strokeRect(ax - 1, ay - 1, size + 2, size + 2);
      }
    }

    function drawCube() {
      if (!plot.frame()) return;
      plot.dots(cells.filter((c) => c.opaque).map((c) => c.rgb), 2.6, 0.85);
      const cell = cells[active];
      if (!cell?.opaque) return;
      const [r, g, b] = cell.rgb;
      const dash = [3, 3];
      plot.line([r, g, b], [r, 0, b], "rgba(36, 27, 19, 0.6)", 1, dash);
      plot.line([r, 0, b], [r, 0, 0], AXES[0].color, 1, dash);
      plot.line([r, 0, b], [0, 0, b], AXES[2].color, 1, dash);
      plot.line([r, g, b], [0, g, 0], AXES[1].color, 1, dash);
      plot.marker(cell.rgb, 7);
      readout.innerHTML = `<span class="chip" style="background:${toHex(cell.rgb)}"></span><b class="ch-r">R ${r}</b> <b class="ch-g">G ${g}</b> <b class="ch-b">B ${b}</b> → the point (${r}, ${g}, ${b})`;
    }

    function draw() {
      drawGrid();
      drawCube();
    }

    gridCanvas.addEventListener("pointermove", (e) => {
      if (!layout) return;
      const rect = gridCanvas.getBoundingClientRect();
      const i = Math.floor((e.clientX - rect.left - layout.ox) / layout.size);
      const j = Math.floor((e.clientY - rect.top - layout.oy) / layout.size);
      if (i < 0 || j < 0 || i >= cols || j >= rows) return;
      hovering = true;
      const index = j * cols + i;
      if (index !== active && cells[index]?.opaque) {
        active = index;
        draw();
      }
    });
    gridCanvas.addEventListener("pointerleave", () => (hovering = false));
    resInput.addEventListener("input", rebuild);

    // Wander across the image on its own until someone hovers.
    setInterval(() => {
      if (hovering || reduceMotion || panel.hidden || !cells.length) return;
      const opaque = cells.map((c, i) => (c.opaque ? i : -1)).filter((i) => i >= 0);
      active = opaque[Math.floor(Math.random() * opaque.length)];
      draw();
    }, 1600);

    return { rebuild, draw, canvases: [gridCanvas, plot.canvas] };
  })();

  /* ---------------------------------------------------- 2 · distance */

  const distance = (() => {
    const plot = new CubePlot($("distance-cube"), { onTurn: () => draw() });
    const inputA = $("dist-a");
    const inputB = $("dist-b");
    const readout = $("dist-readout");
    const meter = $("dist-meter");
    let cloud = [];

    const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

    function draw() {
      if (!plot.frame()) return;
      if (cloud.length === 0 || cloud.source !== source.pixels) {
        cloud = subsample(source.pixels, 500);
        cloud.source = source.pixels;
      }
      plot.dots(cloud, 1.6, 0.22);
      const a = parse(inputA.value);
      const b = parse(inputB.value);
      const legR = [b[0], a[1], a[2]];
      const legG = [b[0], b[1], a[2]];
      plot.line(a, legR, AXES[0].color, 3);
      plot.line(legR, legG, AXES[1].color, 3);
      plot.line(legG, b, AXES[2].color, 3);
      plot.line(a, b, INK, 2, [6, 4]);
      plot.marker(a, 9, "A");
      plot.marker(b, 9, "B");

      const dr = b[0] - a[0];
      const dg = b[1] - a[1];
      const db = b[2] - a[2];
      const d = Math.sqrt(colorDistanceSq(a, b));
      const verdict =
        d < DEDUPE_DISTANCE ? "twins, so they would be merged" : d < 100 ? "related" : d < 250 ? "different" : "opposites";
      readout.innerHTML =
        `d = √(<b class="ch-r">${dr}</b>² + <b class="ch-g">${dg}</b>² + <b class="ch-b">${db}</b>²) = <b>${d.toFixed(1)}</b>` +
        ` <span class="muted">· ${verdict}</span>`;
      meter.style.width = `${Math.min(100, (d / 441.67) * 100)}%`;
    }

    inputA.addEventListener("input", draw);
    inputB.addEventListener("input", draw);
    $("dist-random").addEventListener("click", () => {
      const pick = () => source.pixels[Math.floor(Math.random() * source.pixels.length)];
      inputA.value = toHex(pick()).toLowerCase();
      inputB.value = toHex(pick()).toLowerCase();
      draw();
    });

    return { draw, canvases: [plot.canvas] };
  })();

  /* ------------------------------------------------------ 3 · k-means */

  const kmeans = (() => {
    const plot = new CubePlot($("kmeans-cube"), { onTurn: () => draw() });
    const readout = $("km-readout");
    const btn = {
      seed: $("km-seed"),
      assign: $("km-assign"),
      update: $("km-update"),
      run: $("km-run"),
      reset: $("km-reset"),
    };
    const steps = [...document.querySelectorAll("#lesson-kmeans .steps li")];
    const kButtons = [...document.querySelectorAll("#lesson-kmeans [data-k]")];

    const state = { k: 5, points: [], centers: [], trails: [], assign: null, round: 0, busy: false, done: false };

    function setStep(name) {
      steps.forEach((li) => li.classList.toggle("is-active", li.dataset.step === name));
    }

    function sync() {
      const seeded = state.centers.length === state.k;
      btn.seed.disabled = state.busy || seeded;
      btn.assign.disabled = state.busy || !seeded || state.done;
      btn.update.disabled = state.busy || !state.assign || state.done;
      btn.run.disabled = state.busy || state.done;
      btn.reset.disabled = state.busy;
      kButtons.forEach((b) => (b.disabled = state.busy));
    }

    function draw() {
      if (!plot.frame()) return;
      const ctx = plot.ctx;
      if (state.assign && state.centers.length) {
        ctx.lineWidth = 0.6;
        const projectedCenters = state.centers.map((c) => plot.project(c));
        state.points.forEach((pt, i) => {
          const p = plot.project(pt);
          const q = projectedCenters[state.assign[i]];
          ctx.strokeStyle = css(state.centers[state.assign[i]], 0.28);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        });
      }
      plot.dots(state.points, 2.1, 0.85);
      state.trails.forEach((trail) => {
        for (let i = 1; i < trail.length; i++) plot.line(trail[i - 1], trail[i], "rgba(36, 27, 19, 0.7)", 1.2, [3, 3]);
      });
      state.centers.forEach((c, i) => plot.marker(c, 9, String(i + 1)));
    }

    function report(html) {
      readout.innerHTML = html;
    }

    function errorText() {
      if (!state.assign) return "";
      const err = totalError(state.points, state.centers);
      const avg = Math.sqrt(err / state.points.length);
      return ` · error <b>${compact.format(err)}</b> · average distance to centre <b>${avg.toFixed(1)}</b>`;
    }

    function reset() {
      state.points = subsample(source.pixels, 650);
      state.centers = [];
      state.trails = [];
      state.assign = null;
      state.round = 0;
      state.done = false;
      state.busy = false;
      setStep(null);
      report(`${state.points.length} pixels, k = ${state.k}. Press <b>Seed</b> to place the first centres.`);
      sync();
      draw();
    }

    async function seed() {
      state.busy = true;
      sync();
      setStep("seed");
      const full = initCenters(state.points, state.k);
      for (let i = 0; i < full.length; i++) {
        state.centers.push(full[i]);
        state.trails.push([full[i]]);
        report(
          i === 0
            ? "Centre 1: a random pixel."
            : `Centre ${i + 1}: the pixel farthest from the ${i === 1 ? "first centre" : `${i} centres so far`}.`
        );
        draw();
        await wait(320);
      }
      state.busy = false;
      report(`${state.k} centres placed. Next, <b>Assign</b> each pixel to its nearest centre.`);
      sync();
    }

    function assign() {
      setStep("assign");
      state.assign = state.points.map((p) => nearestCenterIndex(p, state.centers));
      const sizes = state.centers.map((_, i) => state.assign.filter((a) => a === i).length);
      report(`Round ${state.round + 1}: each pixel joined its nearest centre (crowds of ${sizes.join(", ")})${errorText()}.`);
      sync();
      draw();
    }

    async function update() {
      state.busy = true;
      sync();
      setStep("update");
      const sums = state.centers.map(() => [0, 0, 0, 0]);
      state.points.forEach((p, i) => {
        const s = sums[state.assign[i]];
        s[0] += p[0];
        s[1] += p[1];
        s[2] += p[2];
        s[3] += 1;
      });
      const from = state.centers.map((c) => c.slice());
      const to = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : from[i]));
      const frames = reduceMotion ? 1 : 18;
      for (let f = 1; f <= frames; f++) {
        const t = 1 - Math.pow(1 - f / frames, 3);
        state.centers = from.map((c, i) => c.map((v, k) => v + (to[i][k] - v) * t));
        draw();
        await new Promise(requestAnimationFrame);
      }
      state.centers = to;
      state.trails.forEach((trail, i) => trail.push(to[i]));
      state.round += 1;
      const moved = Math.max(...from.map((c, i) => Math.sqrt(colorDistanceSq(c, to[i]))));
      state.done = centersConverged(from, to) || state.round >= KMEANS_ITERATIONS;
      state.assign = state.points.map((p) => nearestCenterIndex(p, state.centers));
      state.busy = false;
      if (state.done) {
        setStep("repeat");
        report(
          (state.round >= KMEANS_ITERATIONS && !centersConverged(from, to)
            ? `Stopped after ${KMEANS_ITERATIONS} rounds.`
            : `Settled after ${state.round} round${state.round > 1 ? "s" : ""}: the centres stopped moving.`) +
            `${errorText()}. These ${state.k} centres are the palette.`
        );
      } else {
        setStep("update");
        report(`Round ${state.round}: the centres moved up to <b>${moved.toFixed(1)}</b> towards their crowds${errorText()}. Assign again.`);
      }
      sync();
      draw();
    }

    async function runAll() {
      if (state.centers.length < state.k) await seed();
      state.busy = true;
      sync();
      while (!state.done) {
        assign();
        state.busy = true;
        sync();
        await wait(420);
        await update();
        state.busy = !state.done;
        sync();
        await wait(260);
      }
      state.busy = false;
      sync();
    }

    btn.seed.addEventListener("click", seed);
    btn.assign.addEventListener("click", assign);
    btn.update.addEventListener("click", update);
    btn.run.addEventListener("click", runAll);
    btn.reset.addEventListener("click", reset);
    kButtons.forEach((b) =>
      b.addEventListener("click", () => {
        state.k = Number(b.dataset.k);
        kButtons.forEach((x) => x.classList.toggle("is-active", x === b));
        reset();
      })
    );

    return { reset, draw, canvases: [plot.canvas] };
  })();

  /* -------------------------------------------------------- 4 · runs */

  const runs = (() => {
    const host = $("runs");
    const readout = $("runs-readout");
    const K = 7;
    let results = [];
    const cards = [0, 1, 2].map((i) => {
      const card = document.createElement("div");
      card.className = "run";
      card.innerHTML = `
        <p class="run__head"><span>Run ${i + 1}</span><span class="run__badge">Kept</span></p>
        <canvas class="fig-canvas fig-canvas--mini"></canvas>
        <div class="run__strip"></div>
        <div class="run__error"><span class="run__bar"><i></i></span><b></b></div>`;
      host.append(card);
      const canvas = card.querySelector("canvas");
      return { card, canvas, plot: new CubePlot(canvas, { drag: false, labels: false, theta: -0.72 }) };
    });

    function draw() {
      if (!results.length) return;
      const best = Math.min(...results.map((r) => r.error));
      const worst = Math.max(...results.map((r) => r.error));
      results.forEach((result, i) => {
        const { card, plot } = cards[i];
        card.classList.toggle("is-best", result.error === best);
        if (plot.frame()) {
          plot.dots(result.points, 1.5, 0.5);
          result.centers.forEach((c) => plot.marker(c, 6));
        }
        card.querySelector(".run__strip").innerHTML = sortByLuminance(result.centers)
          .map((c) => `<span style="background:${toHex(c)}"></span>`)
          .join("");
        card.querySelector(".run__error b").textContent = compact.format(result.error);
        card.querySelector(".run__bar i").style.width = `${(result.error / worst) * 100}%`;
      });
      const spread = (worst - best) / best;
      readout.textContent =
        spread < 0.005
          ? "All three runs agreed this time. Roll again to see them differ."
          : `The kept run's error is ${(spread * 100).toFixed(1)}% lower than the worst.`;
    }

    function roll() {
      const points = subsample(source.pixels, 900);
      results = [0, 1, 2].map(() => ({ ...kMeans(points, K, KMEANS_ITERATIONS), points }));
      draw();
    }

    $("runs-roll").addEventListener("click", roll);
    return { roll, draw, canvases: cards.map((c) => c.canvas) };
  })();

  /* -------------------------------------------------------- 5 · tidy */

  const tidy = (() => {
    const host = $("tidy");
    const slider = $("tidy-threshold");
    const sortBtn = $("tidy-sort");
    const readout = $("tidy-readout");
    let raw = [];
    let sorted = false;

    function rebuild() {
      raw = bestKMeans(subsample(source.pixels, 2500), 10);
      host.innerHTML = "";
      raw.forEach((color, index) => {
        const card = document.createElement("div");
        card.className = "tidy-card";
        card.dataset.index = String(index);
        const lum = luminance(color);
        card.innerHTML = `
          <span class="tidy-card__swatch" style="--c:${toHex(color)}"></span>
          <span class="tidy-card__hex">${toHex(color)}</span>
          <span class="tidy-card__lum"><i style="height:${(lum / 255) * 100}%"></i></span>
          <span class="tidy-card__val">L ${Math.round(lum)}</span>
          <span class="tidy-card__note"></span>`;
        host.append(card);
      });
      update(false);
    }

    function update(animate = true) {
      const threshold = Number(slider.value);
      $("tidy-threshold-out").textContent = String(threshold);
      const kept = [];
      const twinOf = new Map();
      raw.forEach((color, i) => {
        const twin = kept.find((k) => colorDistanceSq(raw[k], color) < threshold * threshold);
        if (twin === undefined) kept.push(i);
        else twinOf.set(i, twin);
      });

      // FLIP: remember where each card was, reorder, then animate from there.
      const cards = [...host.children];
      const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));

      cards.forEach((card) => {
        const i = Number(card.dataset.index);
        const dropped = twinOf.has(i);
        card.classList.toggle("is-dropped", dropped);
        card.classList.toggle("is-gone", dropped && sorted);
        card.querySelector(".tidy-card__note").textContent = dropped ? `≈ ${toHex(raw[twinOf.get(i)])}` : "";
      });
      const order = sorted
        ? [...kept.sort((a, b) => luminance(raw[a]) - luminance(raw[b])), ...twinOf.keys()]
        : raw.map((_, i) => i);
      order.forEach((i) => host.append(cards.find((c) => Number(c.dataset.index) === i)));

      if (animate && !reduceMotion) {
        for (const card of cards) {
          const a = before.get(card);
          const b = card.getBoundingClientRect();
          const dx = a.left - b.left;
          const dy = a.top - b.top;
          if (!dx && !dy) continue;
          card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
            duration: 520,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          });
        }
      }

      const merged = raw.length - kept.length;
      readout.innerHTML =
        `${raw.length} centres → <b>${kept.length} colour${kept.length === 1 ? "" : "s"}</b>` +
        (merged ? ` (${merged} merged into a twin)` : " (no twins at this distance)") +
        (sorted ? " · sorted dark → light" : " · in the order k-means found them");
    }

    slider.addEventListener("input", () => update(false));
    sortBtn.addEventListener("click", () => {
      sorted = !sorted;
      sortBtn.setAttribute("aria-pressed", String(sorted));
      sortBtn.textContent = sorted ? "Original order" : "Sort by light";
      update(true);
    });

    return { rebuild, canvases: [] };
  })();

  /* --------------------------------------------------- pipeline & boot */

  const links = [...panel.querySelectorAll(".pipeline a")];
  links.forEach((link) =>
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(link.dataset.lesson).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    })
  );
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          links.forEach((l) => l.classList.toggle("is-active", l.dataset.lesson === entry.target.id));
        }
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    panel.querySelectorAll(".lesson").forEach((lesson) => observer.observe(lesson));
  }

  // Canvases have no size while the tab is hidden; redraw whenever they get one.
  const redrawers = [
    [sample.canvases, sample.draw],
    [distance.canvases, distance.draw],
    [kmeans.canvases, kmeans.draw],
    [runs.canvases, runs.draw],
  ];
  const resize = new ResizeObserver((entries) => {
    const due = new Set();
    for (const entry of entries) {
      for (const [canvases, fn] of redrawers) if (canvases.includes(entry.target)) due.add(fn);
    }
    due.forEach((fn) => fn());
  });
  redrawers.forEach(([canvases]) => canvases.forEach((c) => resize.observe(c)));

  window.addEventListener("codex:palettes", (event) => setSource(event.detail));
  setSource(window.__codexLast);
})();
