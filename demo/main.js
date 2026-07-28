/**
 * SkyVortex · 飞行员 Demo 主入口
 *
 * 架构：WeatherDataProvider → CloudTextureSynthesizer → SkyVortexEngine → StormTracker / TimelineController
 *
 * UI：移动端优先，底部 Tab Bar 导航
 */

import { SkyVortexEngine } from "../skyvortex-engine.js";
import {
  WeatherDataProvider, MockProvider,
  CloudTextureSynthesizer, StormTracker, TimelineController,
} from "../src/index.js";

const Cesium = window.Cesium;
Cesium.Ion.defaultAccessToken = "";

// ── 配置 ────────────────────────────────────────────────────────────────

const REGIONS = {
  beijing:   { name: "北京", center: [116.5, 39.8], alt: 10000 },
  shanghai:  { name: "上海", center: [121.5, 31.2], alt: 10000 },
  guangzhou: { name: "广州", center: [113.3, 23.1], alt: 10000 },
};

let currentRegion = "beijing";
let currentTab = "storms";
let timeline = null;
let playTimer = null;
let cloudsVisible = true;
let currentPerformance = "high";

// ── 深度模块 ────────────────────────────────────────────────────────────

const provider = new WeatherDataProvider();
provider.setAdapter(new MockProvider(42));
const synth = new CloudTextureSynthesizer();
const stormTracker = new StormTracker();

// ── 工具函数 ────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("sv-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function setStatus(text, type = "ok") {
  const el = document.getElementById("sv-status");
  const dot = document.getElementById("sv-status-dot");
  if (!el) return;
  el.textContent = text;
  if (dot) dot.classList.toggle("error", type === "error");
}

async function textureToBlobUrl(tex) {
  const canvas = new OffscreenCanvas(tex.width, tex.height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(tex.width, tex.height);
  imgData.data.set(tex.rgba);
  ctx.putImageData(imgData, 0, 0);
  const pngBlob = await canvas.convertToBlob({ type: "image/png" });
  return URL.createObjectURL(pngBlob);
}

// ── Cesium Viewer ───────────────────────────────────────────────────────

let viewer, engine;

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
      REGIONS[currentRegion].center[0],
      REGIONS[currentRegion].center[1],
      REGIONS[currentRegion].alt
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
  brunetonShaderBase: "/engine-base/src/AtmosphereFromGeospatial/Shaders/bruneton/",
  blueNoiseUrl: "/engine-base/public/data/noisePic/noisergba256.png",
  showGui: false,  // 移动端隐藏 dat.gui
});

window.__engine = engine;
window.__viewer = viewer;

try {
  await engine.init();
  setStatus("实时");
  document.getElementById("loading").classList.add("hidden");
  toast("SkyVortex 就绪");
} catch (err) {
  window.__init_error = err.message + "\n" + err.stack;
  console.error("Engine init failed:", err);
  setStatus("错误", "error");
  document.getElementById("sv-status").textContent = "❌ 错误";
  document.getElementById("loading").innerHTML =
    `❌ 初始化失败：${err.message}<br><small style="opacity:.6">${err.stack?.split('\n')[0] || ''}</small>`;
  document.getElementById("loading").classList.remove("hidden");
}

// ── SIGMET 航空警告 ──────────────────────────────────────────────────

async function loadSigmets() {
  const container = document.getElementById("sv-sigmets");
  if (!container) return;
  try {
    const sigmets = await provider.getSigmetsForRegion(currentRegion);
    if (!sigmets.length) {
      container.innerHTML = `<div style="font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;">当前区域无 SIGMET 警告</div>`;
      return;
    }
    container.innerHTML = sigmets.slice(0, 5).map(s => `
      <div class="sv-card">
        <div class="sv-card-header">
          <div class="sv-card-title">${s.label}</div>
          <span class="sv-badge ${s.level}">${s.level === 'danger' ? '危险' : s.level === 'warn' ? '注意' : '安全'}</span>
        </div>
        <div class="sv-card-meta">${s.fir} · ${s.startTime?.slice(11,16) || '--'}-${s.endTime?.slice(11,16) || '--'} UTC</div>
      </div>
    `).join("");
  } catch (err) {
    console.error("SIGMET load failed:", err);
    container.innerHTML = `<div style="font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;">加载失败</div>`;
  }
}

// ── Open-Meteo 云量预报 ───────────────────────────────────────────────

async function loadForecast() {
  const el = document.getElementById("sv-forecast");
  if (!el) return;
  try {
    const summary = await provider.getFlightWeatherSummary(currentRegion, 3);
    el.innerHTML = summary.map(d => `
      <div class="sv-card">
        <div class="sv-card-header">
          <div class="sv-card-title">${d.date.slice(5)}</div>
          <span class="sv-badge ${d.riskLevel}">${d.riskLevel === 'warn' ? '注意' : '正常'}</span>
        </div>
        <div class="sv-card-meta">
          云量 ${d.maxCloud.toFixed(0)}% · 降水 ${d.maxPrecip.toFixed(1)}mm · 风 ${d.avgWind.toFixed(0)}m/s
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Forecast load failed:", err);
    el.innerHTML = `<div style="font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;">加载失败</div>`;
  }
}

// ── 加载区域时序数据 ────────────────────────────────────────────────────

async function loadRegion(region) {
  currentRegion = region;
  const r = REGIONS[region];
  setStatus("加载中…");

  try {
    const frames = await provider.getTimeSeries(region, "2026-07-28T12:00:00Z", 12, 5);

    const tex = synth.synthesize(frames[0]);
    const url = await textureToBlobUrl(tex);
    await engine.swapWeatherTexture(url);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    timeline = new TimelineController();
    timeline.load(frames.map((f, i) => ({ timestamp: f.timestamp, data: f })));
    const slider = document.getElementById("sv-timeline");
    if (slider) slider.max = timeline.count - 1;
    updateTimeDisplay();

    renderStormsFromTracker(frames[Math.floor(frames.length / 2)]);
    loadSigmets();
    loadForecast();

    engine.setPilotView(r.center[0], r.center[1], r.alt);
    setStatus("实时");
    toast(`切换至 ${r.name}`);
  } catch (err) {
    console.error("loadRegion failed:", err);
    toast(`加载失败（${region}）`);
    setStatus("错误", "error");
  }
}

// ── 单体面板 ──────────────────────────────────────────────────────────

function renderStormsFromTracker(frame) {
  const storms = stormTracker.detect(frame);
  const container = document.getElementById("sv-storms");
  if (!container) return;
  if (!storms.length) {
    container.innerHTML = `<div style="font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;">本时次无强回波</div>`;
    return;
  }
  container.innerHTML = storms.map(s => `
    <div class="sv-card" data-lon="${s.lon}" data-lat="${s.lat}">
      <div class="sv-card-header">
        <div class="sv-card-title">${s.id}</div>
        <span class="sv-badge ${s.level}">${s.dbz.toFixed(0)} dBZ</span>
      </div>
      <div class="sv-card-meta">
        云顶 ${(s.topHeight/1000).toFixed(1)} km · 移速 ${s.driftSpeed?.toFixed(0) || '--'} km/h
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".sv-card").forEach(card => {
    card.addEventListener("click", () => {
      const lon = parseFloat(card.dataset.lon);
      const lat = parseFloat(card.dataset.lat);
      const r = REGIONS[currentRegion];
      engine.setPilotView(lon, lat, 5000);
      toast(`飞行至 ${card.querySelector('.sv-card-title').textContent}`);
    });
  });
}

// ── 时间轴控制 ────────────────────────────────────────────────────────

function updateTimeDisplay() {
  if (!timeline) return;
  const el = document.getElementById("sv-time");
  if (!el) return;
  const d = new Date(timeline.currentTime);
  el.textContent =
    d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

function togglePlay() {
  const btn = document.getElementById("sv-play");
  if (!btn) return;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    btn.textContent = "▶";
    return;
  }

  btn.textContent = "⏸";
  playTimer = setInterval(() => {
    if (!timeline) return;
    const slider = document.getElementById("sv-timeline");
    let next = (parseInt(slider.value) + 1) % timeline.count;
    seekToFrame(next);
  }, 800);
}

async function seekToFrame(idx) {
  if (!timeline) return;
  timeline.seek(idx);
  const slider = document.getElementById("sv-timeline");
  if (slider) slider.value = idx;
  updateTimeDisplay();

  const frame = timeline.currentFrame;
  if (!frame) return;

  const tex = synth.synthesize(frame.data);
  const url = await textureToBlobUrl(tex);
  await engine.swapWeatherTexture(url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  renderStormsFromTracker(frame.data);
}

// ── Tab 导航 ──────────────────────────────────────────────────────────

const PANELS = {
  storms: document.getElementById("sv-storms-panel"),
  timeline: document.getElementById("sv-timeline-panel"),
  sigmets: document.getElementById("sv-sigmets-panel"),
  forecast: document.getElementById("sv-forecast-panel"),
  settings: document.getElementById("sv-settings-panel"),
};

function showPanel(tab) {
  // 隐藏所有面板
  Object.values(PANELS).forEach(panel => {
    if (panel) panel.classList.add("hidden");
  });

  // 显示选中面板
  const panel = PANELS[tab];
  if (panel) {
    panel.classList.remove("hidden");
    currentTab = tab;
  }

  // 更新 Tab 激活态
  document.querySelectorAll("#sv-tab-bar .sv-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

// ── 事件绑定 ──────────────────────────────────────────────────────────

// 区域选择
document.querySelectorAll("#sv-regions .sv-chip").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("#sv-regions .sv-chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    await loadRegion(btn.dataset.region);
  });
});

// 飞行视角
document.querySelectorAll("[data-fpv]").forEach(btn => {
  btn.addEventListener("click", () => {
    const r = REGIONS[currentRegion];
    const views = {
      pilot:   () => engine.setPilotView(r.center[0], r.center[1], 10000, 0, -Math.PI/3),
      tower:   () => engine.setPilotView(r.center[0] - 0.5, r.center[1] - 0.5, 1500, Math.PI/4, -0.1),
      side:    () => engine.setPilotView(r.center[0] + 3, r.center[1], 12000, -Math.PI/2, 0),
      top:     () => engine.setPilotView(r.center[0], r.center[1], 50000, 0, -Math.PI/2),
    };
    views[btn.dataset.fpv]?.();
    toast(btn.textContent + "视角");
  });
});

// 云体显隐
const toggleCloudsBtn = document.getElementById("sv-toggle-clouds");
if (toggleCloudsBtn) {
  toggleCloudsBtn.addEventListener("click", () => {
    cloudsVisible = !cloudsVisible;
    engine.setCloudsVisible(cloudsVisible);
    toast(cloudsVisible ? "云体显示" : "云体隐藏");
  });
}

// 性能模式
document.querySelectorAll("#sv-perf .sv-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#sv-perf .sv-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentPerformance = btn.dataset.perf;
    engine.setPerformancePreset(currentPerformance);
    toast(`性能：${btn.textContent}`);
  });
});

// 时间轴
const slider = document.getElementById("sv-timeline");
if (slider) {
  slider.addEventListener("input", () => seekToFrame(parseInt(slider.value)));
}
const playBtn = document.getElementById("sv-play");
if (playBtn) {
  playBtn.addEventListener("click", togglePlay);
}

// 底部 Tab 导航
document.querySelectorAll("#sv-tab-bar .sv-tab").forEach(btn => {
  btn.addEventListener("click", () => showPanel(btn.dataset.tab));
});

// ── 启动 ─────────────────────────────────────────────────────────────────

loadRegion("beijing");

console.log("%c SkyVortex ready ", "background:#38bdf8;color:#000;padding:4px 8px;border-radius:4px;font-weight:600");
console.log("API: window.__engine =", engine);
window.__main_loaded = true;