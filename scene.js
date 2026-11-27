/**
 * 3D instruments for the Codex of Colour.
 *  - Hero: a framed picture whose colours lift out as blocks and settle into a palette.
 *  - Cubus Colorum: the sampled pixels plotted in RGB space, with the k-means
 *    centroids as orbs and drafting lines dropped to the floor of the cube.
 * script.js publishes data through the "codex:palettes" / "codex:clear" events.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const INK = 0x2a2118;
const SANGUINE = 0xa8452b;
const VERDIGRIS = 0x2f8a80;
const GOLD = 0xb8893a;
const INDIGO = 0x34507a;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scenes = [];

function makeRenderer(canvas) {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch (error) {
    console.warn("WebGL unavailable; 3D instruments disabled.", error);
    return null;
  }
}

function fitRenderer(entry) {
  const { renderer, camera, canvas } = entry;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function watchVisibility(entry) {
  entry.visible = true;
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver(([record]) => {
    entry.visible = record.isIntersecting;
  }).observe(entry.canvas);
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0x6b4e32, 1.6));
  const key = new THREE.DirectionalLight(0xfff0d0, 1.4);
  key.position.set(4, 6, 8);
  scene.add(key);
}

function beamBetween(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/* ------------------------------------------------------------------ hero */
/*
 * A framed picture; five colour blocks lift out of the spots where those colours
 * live in the picture and settle into a palette row beneath it. Loops gently.
 */

const HERO_COLORS = 5;
const CYCLE_MS = 7000;

function makeDemoPicture() {
  const c = document.createElement("canvas");
  c.width = 240;
  c.height = 160;
  const x = c.getContext("2d");
  const sky = x.createLinearGradient(0, 0, 0, 100);
  sky.addColorStop(0, "#2c2a6b");
  sky.addColorStop(0.55, "#b04a62");
  sky.addColorStop(1, "#f08a4b");
  x.fillStyle = sky;
  x.fillRect(0, 0, 240, 100);
  x.fillStyle = "#ffd36b";
  x.beginPath();
  x.arc(168, 82, 22, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#2a7f86";
  x.fillRect(0, 100, 240, 60);
  x.fillStyle = "#1d3324";
  x.beginPath();
  x.moveTo(0, 101);
  x.lineTo(44, 60);
  x.lineTo(84, 86);
  x.lineTo(118, 56);
  x.lineTo(150, 101);
  x.closePath();
  x.fill();
  return c;
}

/** Where in the picture each colour can be found, as 0–1 coordinates. */
function locateColors(image, colors) {
  const w = 60;
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const h = Math.max(1, Math.round((w * ih) / iw));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(image, 0, 0, w, h);
  const { data } = x.getImageData(0, 0, w, h);
  return colors.map(([r, g, b]) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const d = (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2;
      // Prefer spots away from the edges so the blocks visibly come from inside.
      const p = i / 4;
      const u = (p % w) / w;
      const v = Math.floor(p / w) / h;
      const edge = Math.min(u, 1 - u, v, 1 - v) < 0.08 ? 900 : 0;
      if (d + edge < bestD) {
        bestD = d + edge;
        best = p;
      }
    }
    return { u: ((best % w) + 0.5) / w, v: (Math.floor(best / w) + 0.5) / h };
  });
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function createHero(canvas) {
  const renderer = makeRenderer(canvas);
  if (!renderer) {
    canvas.hidden = true;
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.2, 10);
  camera.lookAt(0, -0.35, 0);
  addLights(scene);

  const rig = new THREE.Group();
  scene.add(rig);

  // The picture in its frame.
  const card = new THREE.Group();
  card.position.set(0, 0.75, 0);
  card.rotation.x = -0.12;
  rig.add(card);

  const pictureMaterial = new THREE.MeshBasicMaterial();
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xe6d6b4, roughness: 0.8 });
  const picture = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), [
    edgeMaterial,
    edgeMaterial,
    edgeMaterial,
    edgeMaterial,
    pictureMaterial,
    edgeMaterial,
  ]);
  card.add(picture);
  const frameMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 0.12),
    new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6, metalness: 0.2 })
  );
  frameMesh.position.z = -0.05;
  card.add(frameMesh);

  // Colour blocks, the rings marking where each colour was found, and the thread between them.
  const blockGeometry = new RoundedBoxGeometry(0.62, 0.62, 0.62, 4, 0.08);
  const blocks = [];
  for (let i = 0; i < HERO_COLORS; i++) {
    const block = new THREE.Mesh(
      blockGeometry,
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.45, metalness: 0.05 })
    );
    rig.add(block);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.105, 32),
      new THREE.MeshBasicMaterial({ color: 0xf5ecd8, transparent: true })
    );
    ring.position.z = 0.03;
    card.add(ring);

    const thread = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.45 })
    );
    rig.add(thread);
    blocks.push({ block, ring, thread, uv: { u: 0.5, v: 0.5 } });
  }

  // A faint shelf under the palette row.
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.05, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xd9c7a5, roughness: 0.9 })
  );
  shelf.position.set(0, -2.02, 0.5);
  rig.add(shelf);

  let width = 3.4;
  let height = 2.2;

  function setSource(image, colors) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const aspect = Math.min(1.9, Math.max(0.75, iw / ih));
    width = aspect >= 1.55 ? 3.6 : 2.4 * aspect;
    height = width / aspect;
    picture.scale.set(width, height, 1);
    frameMesh.scale.set(width + 0.22, height + 0.22, 1);

    const scale = Math.min(1, 512 / Math.max(iw, ih));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
    // A new texture each time: WebGL cannot resize an uploaded one in place.
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    pictureMaterial.map?.dispose();
    pictureMaterial.map = texture;
    pictureMaterial.needsUpdate = true;

    const spots = locateColors(image, colors);
    blocks.forEach((entry, i) => {
      const color = colors[i % colors.length];
      entry.block.material.color.setRGB(color[0] / 255, color[1] / 255, color[2] / 255, THREE.SRGBColorSpace);
      entry.uv = spots[i % spots.length];
      entry.ring.position.set((entry.uv.u - 0.5) * width, (0.5 - entry.uv.v) * height, 0.03);
    });
  }

  const pointer = { x: 0, y: 0 };
  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX / window.innerWidth - 0.5;
      pointer.y = event.clientY / window.innerHeight - 0.5;
    },
    { passive: true }
  );

  const start = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const end = new THREE.Vector3();

  const entry = {
    renderer,
    scene,
    camera,
    canvas,
    tick(time) {
      rig.rotation.y += (pointer.x * 0.5 - 0.18 - rig.rotation.y) * 0.05;
      rig.rotation.x += (pointer.y * 0.25 - rig.rotation.x) * 0.05;
      card.updateMatrixWorld();

      const t = reduceMotion ? 0.6 : (time % CYCLE_MS) / CYCLE_MS;
      const gap = 0.76;
      blocks.forEach((b, i) => {
        start.set(b.ring.position.x, b.ring.position.y, 0.2);
        card.localToWorld(start);
        rig.worldToLocal(start);
        end.set((i - (HERO_COLORS - 1) / 2) * gap, -1.62, 0.5);
        lift.set(start.x * 0.6 + end.x * 0.4, start.y - 0.2, 1.8);

        // 0–.12 appear on the picture · .12–.5 travel · .5–.86 rest · .86–1 fade away.
        const appear = clamp01((t - i * 0.015) / 0.1);
        const travel = ease(clamp01((t - 0.12 - i * 0.045) / 0.3));
        const leave = clamp01((t - 0.86) / 0.12);

        // Quadratic curve: start → lift → end.
        const a = 1 - travel;
        b.block.position.set(
          a * a * start.x + 2 * a * travel * lift.x + travel * travel * end.x,
          a * a * start.y + 2 * a * travel * lift.y + travel * travel * end.y,
          a * a * start.z + 2 * a * travel * lift.z + travel * travel * end.z
        );
        const rest = travel === 1 ? Math.sin(time * 0.002 + i) * 0.04 : 0;
        b.block.position.y += rest;
        b.block.rotation.set(0.35 * (1 - travel) + 0.12, (1 - travel) * 1.6 - 0.25 + rest, 0);
        const size = (0.35 + 0.65 * travel) * appear * (1 - leave);
        b.block.scale.setScalar(Math.max(0.001, size));

        b.ring.material.opacity = appear * (1 - leave);
        b.ring.scale.setScalar(1 + (1 - appear) * 1.5);

        const pos = b.thread.geometry.attributes.position;
        pos.setXYZ(0, start.x, start.y, start.z - 0.17);
        pos.setXYZ(1, b.block.position.x, b.block.position.y, b.block.position.z);
        pos.needsUpdate = true;
        b.thread.material.opacity = 0.4 * appear * (1 - leave) * (travel > 0 ? 1 : 0);
      });
    },
    setSource,
  };
  watchVisibility(entry);
  return entry;
}

/* ---------------------------------------------------------------- cubus */

function textSprite(text, color) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "italic 86px 'IM Fell English', 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.setScalar(0.16);
  return sprite;
}

function lineSegments(points, material) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineSegments(geometry, material);
  return line;
}

function createCubus(canvas, section) {
  const renderer = makeRenderer(canvas);
  if (!renderer) return null;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  camera.position.set(2.15, 1.35, 2.5);
  addLights(scene);

  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.7;
  // Keep vertical page scrolling on touch screens; horizontal drags still turn the cube.
  canvas.style.touchAction = "pan-y";

  const world = new THREE.Group();
  scene.add(world);

  const cube = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.4 })
  );
  world.add(cube);

  const origin = new THREE.Vector3(-0.5, -0.5, -0.5);
  const axes = [
    { dir: new THREE.Vector3(1, 0, 0), color: SANGUINE, label: "R", css: "#a8452b" },
    { dir: new THREE.Vector3(0, 1, 0), color: VERDIGRIS, label: "G", css: "#2f8a80" },
    { dir: new THREE.Vector3(0, 0, 1), color: INDIGO, label: "B", css: "#34507a" },
  ];
  for (const axis of axes) {
    const material = new THREE.MeshStandardMaterial({ color: axis.color, roughness: 0.5 });
    world.add(beamBetween(origin, origin.clone().addScaledVector(axis.dir, 1.12), 0.006, material));
    const ticks = [];
    const across = axis.dir.x ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    for (let step = 0.25; step < 1; step += 0.25) {
      const point = origin.clone().addScaledVector(axis.dir, step);
      ticks.push(point.clone().addScaledVector(across, -0.03), point.clone().addScaledVector(across, 0.03));
    }
    world.add(lineSegments(ticks, new THREE.LineBasicMaterial({ color: axis.color })));
    const sprite = textSprite(axis.label, axis.css);
    sprite.position.copy(origin).addScaledVector(axis.dir, 1.2);
    world.add(sprite);
  }

  let points = null;
  const markers = new THREE.Group();
  world.add(markers);
  let data = null;
  let currentK = 5;

  const toSpace = ([r, g, b]) => new THREE.Vector3(r / 255 - 0.5, g / 255 - 0.5, b / 255 - 0.5);

  function setPixels(pixels) {
    if (points) {
      world.remove(points);
      points.geometry.dispose();
    }
    const positions = new Float32Array(pixels.length * 3);
    const colors = new Float32Array(pixels.length * 3);
    const color = new THREE.Color();
    pixels.forEach((pixel, index) => {
      positions[index * 3] = pixel[0] / 255 - 0.5;
      positions[index * 3 + 1] = pixel[1] / 255 - 0.5;
      positions[index * 3 + 2] = pixel[2] / 255 - 0.5;
      color.setRGB(pixel[0] / 255, pixel[1] / 255, pixel[2] / 255, THREE.SRGBColorSpace);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.014, vertexColors: true, transparent: true, opacity: 0.75 })
    );
    world.add(points);
  }

  function setCentroids(colors, pixels) {
    for (const child of [...markers.children]) {
      markers.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
    if (!colors.length) return;

    // Share of pixels nearest to each centroid sets the orb's size.
    const counts = new Array(colors.length).fill(0);
    const stride = Math.max(1, Math.floor(pixels.length / 4000));
    for (let p = 0; p < pixels.length; p += stride) {
      const pixel = pixels[p];
      let best = 0;
      let bestDistance = Infinity;
      colors.forEach((c, index) => {
        const d = (pixel[0] - c[0]) ** 2 + (pixel[1] - c[1]) ** 2 + (pixel[2] - c[2]) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = index;
        }
      });
      counts[best] += 1;
    }
    const total = counts.reduce((a, b) => a + b, 0) || 1;

    const dashMaterial = new THREE.LineDashedMaterial({
      color: INK,
      dashSize: 0.025,
      gapSize: 0.018,
      transparent: true,
      opacity: 0.55,
    });

    colors.forEach((rgb, index) => {
      const position = toSpace(rgb);
      const radius = 0.03 + 0.085 * Math.sqrt(counts[index] / total);
      const color = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 28, 20),
        new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.15, emissive: color, emissiveIntensity: 0.15 })
      );
      orb.position.copy(position);
      markers.add(orb);

      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.55, 0.0025, 6, 48),
        new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.6 })
      );
      halo.position.copy(position);
      halo.userData.billboard = true;
      markers.add(halo);

      const drop = lineSegments([position, new THREE.Vector3(position.x, -0.5, position.z)], dashMaterial.clone());
      drop.computeLineDistances();
      markers.add(drop);

      const foot = new THREE.Mesh(
        new THREE.RingGeometry(0.012, 0.018, 24),
        new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
      );
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(position.x, -0.499, position.z);
      markers.add(foot);
    });
  }

  function showK(k) {
    currentK = k;
    for (const button of section.querySelectorAll("[data-k]")) {
      const active = Number(button.dataset.k) === k;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (!data) return;
    const palette = data.palettes.find((p) => p.size === k) || data.palettes[0];
    setCentroids(palette.colors, data.pixels);
  }

  section.querySelectorAll("[data-k]").forEach((button) => {
    button.addEventListener("click", () => showK(Number(button.dataset.k)));
  });

  const entry = {
    renderer,
    scene,
    camera,
    canvas,
    tick() {
      controls.update();
      for (const child of markers.children) {
        if (child.userData.billboard) child.quaternion.copy(camera.quaternion);
      }
    },
    load(detail) {
      data = detail;
      section.hidden = false;
      setPixels(detail.pixels);
      showK(currentK);
      fitRenderer(entry);
    },
    clear() {
      data = null;
      section.hidden = true;
    },
  };
  watchVisibility(entry);
  return entry;
}

/* ----------------------------------------------------------------- boot */

const hero = createHero(document.getElementById("hero-canvas"));
const demoPicture = makeDemoPicture();
const demoColors = () => extractPalette(samplePixels(demoPicture), HERO_COLORS);
hero?.setSource(demoPicture, demoColors());
const cubus = createCubus(document.getElementById("cubus-canvas"), document.getElementById("cubus"));
if (hero) scenes.push(hero);
if (cubus) scenes.push(cubus);

function applyData(detail) {
  if (!detail) return;
  const five = detail.palettes.find((p) => p.size === HERO_COLORS) || detail.palettes[0];
  if (detail.image) hero?.setSource(detail.image, five.colors);
  cubus?.load(detail);
}

window.addEventListener("codex:palettes", (event) => applyData(event.detail));
window.addEventListener("codex:clear", () => {
  hero?.setSource(demoPicture, demoColors());
  cubus?.clear();
});
applyData(window.__codexLast);

function frame(time) {
  for (const entry of scenes) {
    if (!entry.visible || entry.canvas.offsetParent === null) continue;
    fitRenderer(entry);
    entry.tick(time);
    entry.renderer.render(entry.scene, entry.camera);
  }
  requestAnimationFrame(frame);
}
if (scenes.length) {
  document.documentElement.classList.add("has-3d");
  requestAnimationFrame(frame);
}
