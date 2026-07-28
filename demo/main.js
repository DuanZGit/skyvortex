/**
 * SkyVortex · 飞行员 Demo 主入口
 *
 * 架构：WeatherDataProvider → CloudTextureSynthesizer → SkyVortexEngine → StormTracker / TimelineController
 */

import { SkyVortexEngine } from "../skyvortex-engine.js";
import {
  WeatherDataProvider, MockProvider,
  CloudTextureSynthesizer, StormTracker, TimelineController,
} from "../src/index.js";

const Cesium = window.Cesium;
Cesium.Ion.defaultAccessToken = "";

const REGIONS = {
  beijing:   { name: "北京", center: [116.5, 39.8], alt: 10000 },
  shanghai:  { name: "上海", center: [121.5, 31.2], alt: 10000 },
  guangzhou: { name: "广州", center: [113.3, 23.1], alt: 10000 },
};

let currentRegion = "beijing";
let timeline = null;

// ── Toast ────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("sv-toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

// ── 全局错误捕获 ─────────────────────────────────────────────────────────

window.addEventListener("error", e => {
  window.__init_error = (e.error?.message || e.message) + "\n" + (e.error?.stack || "");
});
window.addEventListener("unhandledrejection", e => {
  window.__init_error = "Promise: " + (e.reason?.message || e.reason);
});

let viewer, engine;

// ── Cesium Viewer ────────────────────────────────────────────────────────

try {
viewer = new Cesium.Viewer("cesiumContainer", {
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.TileMapServiceImageryProvider.fromUrl(
      Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
    )
  ),
  baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false,
  animation: false, timeline: false, fullscreenButton: false,
  infoBox: false, selectionIndicator: false,
  skyBox: false, skyAtmosphere: false,
  requestRenderMode: false,
  contextOptions: { webgl: { alpha: true } },
});

viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(
    REGIONS[currentRegion].center[0], REGIONS[currentRegion].center[1], REGIONS[currentRegion].alt
  ),
  orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO * 0.45, roll: 0 },
});
} catch (err) {
  window.__init_error = "Viewer init: " + err.message;
  throw err;
}

// ── SkyVortex Engine ─────────────────────────────────────────────────────

engine = new SkyVortexEngine(viewer, {
  cloudsAssetsBase: "/engine-base/public/clouds-assets/",
  atmosphereAssetsBase: "/engine-base/src/AtmosphereFromThreeGeospatial/assets/",
  atmosphereShaderBase: "/engine-base/src/AtmosphereFromThreeGeospatial/Shaders/",
  brunetonShaderBase: "/engine-base/src/AtmosphereFromThreeGeospatial/Shaders/bruneton/",
  blueNoiseUrl: "/engine-base/public/data/noisePic/noisergba256.png",
  showGui: true,
});

window.__engine = engine;
window.__viewer = viewer;

try {
  await engine.init();
  window.__init_error = null;
  document.getElementById("loading").classList.add("hidden");
  toast("SkyVortex 就绪");
} catch (err) {
  window.__init_error = err.message + "\n" + err.stack;
  console.error("Engine init failed:", err);
  document.getElementById("sv-status").textContent = "❌ 错误";
  document.getElementById("loading").innerHTML =
    `❌ 初始化失败：${err.message}<br><small style="opacity:.6">${err.stack?.split('\n')[0] || ''}</small>`;
  document.getElementById("loading").classList.remove("hidden");
}

// ── 深度模块初始化 ───────────────────────────────────────────────────────

const provider = new WeatherDataProvider();
provider.setAdapter(new MockProvider(42));
const synth = new CloudTextureSynthesizer();
const stormTracker = new StormTracker();

// ── 加载区域时序数据 ────────────────────────────────────────────────────

async function loadRegion(region) {
  currentRegion = region;
  const r = REGIONS[region];
  document.getElementById("sv-status").textContent = "● 加载中…";

  try {
    // 1. 数据层：生成 12 帧时序
    const frames = await provider.getTimeSeries(region, "2026-07-28T12:00:00Z", 12, 5);
    window.__step = '1-ok frames=' + frames.length;

    // 2. 合成层：第一帧 → RGBA 纹理
    const tex = synth.synthesize(frames[0]);
    window.__step = '2-ok tex=' + tex.width;
    // RGBA raw → PNG blob（OffscreenCanvas 编码）
    const canvas = new OffscreenCanvas(tex.width, tex.height);
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(tex.width, tex.height);
    imgData.data.set(tex.rgba);
    ctx.putImageData(imgData, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: "image/png" });
    const url = URL.createObjectURL(pngBlob);

    // 3. 渲染层：替换天气纹理
    window.__step = '3-swap';
    await engine.swapWeatherTexture(url);
    window.__step = '3-ok';
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // 4. 时间轴：加载帧
    window.__step = '4-timeline';
    timeline = new TimelineController();
    timeline.load(frames.map((f, i) => ({ timestamp: f.timestamp, data: f })));
    const slider = document.getElementById("sv-timeline");
    slider.max = timeline.count - 1;
    slider.value = 0;
    updateTimeDisplay();
    window.__step = '4-ok count=' + timeline.count;

    // 5. 分析层：识别单体
    window.__step = '5-tracker';
    renderStormsFromTracker(frames[Math.floor(frames.length / 2)]);
    window.__step = '5-ok';

    // 6. 视角
    engine.setPilotView(r.center[0], r.center[1], r.alt);

    document.getElementById("sv-status").textContent = "● 实时";
    window.__step = 'done';
    toast(`切换至 ${r.name}`);
  } catch (err) {
    window.__step = 'ERR at ' + (window.__step || '?');
    window.__load_error = "type=" + typeof err + " msg=" + JSON.stringify(err) + " stack=" + (err?.stack || 'no-stack');
    console.error("loadRegion failed:", err);
    toast(`加载失败（${region}）`);
    document.getElementById("sv-status").textContent = "● 错误";
  }
}

// ── 单体面板（StormTracker 真实数据） ──────────────────────────────────

function renderStormsFromTracker(frame) {
  const storms = stormTracker.detect(frame);
  const container = document.getElementById("sv-storms");
  if (!storms.length) {
    container.innerHTML = `<div style="font-size:11px;color:#6c87a8;padding:4px;">本时次无强回波</div>`;
    return;
  }
  container.innerHTML = storms.map(s => `
    <div class="sv-storm ${s.level}" data-lon="${s.lon}" data-lat="${s.lat}">
      <div class="id">${s.id}</div>
      <div class="meta">
        ${s.dbz.toFixed(1)} dBZ · 云顶 ${(s.topHeight/1000).toFixed(1)} km
        · 移速 ${s.driftSpeed?.toFixed(0) || '--'} km/h
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".sv-storm").forEach(el => {
    el.addEventListener("click", () => {
      const lon = parseFloat(el.dataset.lon);
      const lat = parseFloat(el.dataset.lat);
      engine.setPilotView(lon, lat, 8000, 0, -Math.PI/4);
      toast(`飞行至 ${el.querySelector(".id").textContent}`);
    });
  });
}

// ── 时间轴控制 ──────────────────────────────────────────────────────────

function updateTimeDisplay() {
  if (!timeline) return;
  const d = new Date(timeline.currentTime);
  document.getElementById("sv-time").textContent =
    d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
}

let playTimer = null;
function togglePlay() {
  const btn = document.getElementById("sv-play");
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    btn.textContent = "▶";
    return;
  }
  btn.textContent = "⏸";
  playTimer = setInterval(async () => {
    if (!timeline || timeline.currentIndex >= timeline.count - 1) {
      clearInterval(playTimer);
      playTimer = null;
      btn.textContent = "▶";
      return;
    }
    await seekToFrame(timeline.currentIndex + 1);
  }, 1200);
}

async function seekToFrame(idx) {
  if (!timeline) return;
  timeline.seek(idx);
  document.getElementById("sv-timeline").value = idx;
  updateTimeDisplay();

  const frame = timeline.currentFrame;
  if (!frame) return;

  const tex = synth.synthesize(frame.data);
  const c = new OffscreenCanvas(tex.width, tex.height);
  const cx = c.getContext("2d");
  const id = cx.createImageData(tex.width, tex.height);
  id.data.set(tex.rgba);
  cx.putImageData(id, 0, 0);
  const png = await c.convertToBlob({ type: "image/png" });
  const url = URL.createObjectURL(png);
  await engine.swapWeatherTexture(url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  renderStormsFromTracker(frame.data);
}

document.getElementById("sv-timeline").addEventListener("input", e => {
  seekToFrame(parseInt(e.target.value));
});
document.getElementById("sv-play").addEventListener("click", togglePlay);

// ── 区域切换 ─────────────────────────────────────────────────────────────

document.querySelectorAll("#sv-regions .sv-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("#sv-regions .sv-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    await loadRegion(btn.dataset.region);
  });
});

// ── 飞行视角预设 ─────────────────────────────────────────────────────────

const FPV = {
  pilot: () => { const r = REGIONS[currentRegion]; engine.setPilotView(r.center[0], r.center[1], 10000, 0, -Math.PI/3); toast("飞行员俯瞰视角"); },
  tower: () => { const r = REGIONS[currentRegion]; engine.setPilotView(r.center[0] - 0.5, r.center[1] - 0.5, 1500, Math.PI/4, -0.1); toast("塔台视角"); },
  side:  () => { const r = REGIONS[currentRegion]; engine.setPilotView(r.center[0] + 3, r.center[1], 12000, -Math.PI/2, 0); toast("侧面剖视"); },
  top:   () => { const r = REGIONS[currentRegion]; engine.setPilotView(r.center[0], r.center[1], 50000, 0, -Math.PI/2); toast("正上方俯视"); },
};

document.querySelectorAll("[data-fpv]").forEach(btn => {
  btn.addEventListener("click", () => FPV[btn.dataset.fpv]());
});

// ── 云体显隐 ─────────────────────────────────────────────────────────────

let cloudsVisible = true;
document.getElementById("sv-toggle-clouds").addEventListener("click", () => {
  cloudsVisible = !cloudsVisible;
  engine.setCloudsVisible(cloudsVisible);
  toast(cloudsVisible ? "云体显示" : "云体隐藏");
});

// ── 启动 ─────────────────────────────────────────────────────────────────

loadRegion("beijing");

console.log("%c SkyVortex ready ", "background:#56a8f0;color:#000;padding:4px 8px;border-radius:4px;font-weight:600");
console.log("API: window.__engine =", engine);
window.__main_loaded = true;