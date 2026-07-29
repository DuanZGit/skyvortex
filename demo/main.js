/**
 * SkyVortex · 飞行员 Demo 主入口（干净接线层）
 *
 * 架构：WeatherDataProvider → CloudTextureSynthesizer → SkyVortexEngine
 *       分析：StormTracker / FlightPathProfiler   UI：TimelineController
 *
 * 原则：定义 → 工具 → 初始化 → 数据管线 → 面板渲染 → 事件绑定 → 单一启动入口
 */

import { SkyVortexEngine, detectDevicePerformance } from "../skyvortex-engine.js";
import {
  WeatherDataProvider, MockProvider, HimawariProvider,
  CloudTextureSynthesizer, StormTracker, FlightPathProfiler, TimelineController,
} from "../src/index.js";

const Cesium = window.Cesium;

// ── 配置 ──────────────────────────────────────────────────────────

const REGIONS = {
  beijing:   { name: "北京", center: [116.5, 39.8], alt: 10000 },
  shanghai:  { name: "上海", center: [121.5, 31.2], alt: 10000 },
  guangzhou: { name: "广州", center: [113.3, 23.1], alt: 10000 },
};

/** ICAO → 机场坐标（航线 Tab 用） */
const AIRPORTS = {
  ZBAA: { name: "北京首都", lon: 116.584, lat: 40.080 },
  ZBAD: { name: "北京大兴", lon: 116.410, lat: 39.509 },
  ZSSS: { name: "上海虹桥", lon: 121.336, lat: 31.198 },
  ZSPD: { name: "上海浦东", lon: 121.805, lat: 31.143 },
  ZGGG: { name: "广州白云", lon: 113.299, lat: 23.392 },
  ZGSZ: { name: "深圳宝安", lon: 113.811, lat: 22.639 },
  ZUUU: { name: "成都双流", lon: 103.947, lat: 30.578 },
  ZUCK: { name: "重庆江北", lon: 106.642, lat: 29.719 },
  ZLXY: { name: "西安咸阳", lon: 108.752, lat: 34.447 },
  ZHHH: { name: "武汉天河", lon: 114.208, lat: 30.784 },
};

/** VOR/DME 导航台（坐标/频率源自 OurAirports 公开库，三个 demo 区域周边） */
const NAVAIDS = [
  // 北京区域
  { id: "VYK", name: "大王庄", freq: "112.7", lon: 116.572, lat: 39.192 },
  { id: "PEK", name: "官庄",   freq: "114.7", lon: 116.600, lat: 40.050 },
  { id: "SZY", name: "沙子营", freq: "117.2", lon: 116.462, lat: 40.102 },
  { id: "HUR", name: "怀柔",   freq: "113.6", lon: 116.748, lat: 40.330 },
  { id: "TAJ", name: "天津",   freq: "112.1", lon: 117.358, lat: 39.107 },
  // 上海区域
  { id: "SHA", name: "虹桥",   freq: "117.2", lon: 121.332, lat: 31.200 },
  { id: "PUD", name: "浦东",   freq: "116.9", lon: 121.780, lat: 31.168 },
  { id: "HSH", name: "横沙",   freq: "114.4", lon: 121.843, lat: 31.368 },
  { id: "NHW", name: "南汇",   freq: "114.6", lon: 121.573, lat: 31.082 },
  { id: "JTN", name: "九亭",   freq: "109.6", lon: 121.340, lat: 31.125 },
  { id: "NTG", name: "南通",   freq: "115.6", lon: 120.978, lat: 32.063 },
  { id: "HGH", name: "杭州",   freq: "113.0", lon: 120.458, lat: 30.240 },
  // 广州区域
  { id: "POU", name: "平洲",   freq: "114.1", lon: 113.190, lat: 23.020 },
  { id: "CEN", name: "岑村",   freq: "114.6", lon: 113.417, lat: 23.150 },
  { id: "CON", name: "从化",   freq: "113.0", lon: 113.585, lat: 23.588 },
  { id: "SHL", name: "石龙",   freq: "115.7", lon: 113.853, lat: 23.090 },
  { id: "SZX", name: "深圳",   freq: "115.3", lon: 113.803, lat: 22.645 },
  { id: "GLN", name: "观澜",   freq: "112.0", lon: 114.035, lat: 22.710 },
  { id: "ZUH", name: "珠海",   freq: "116.7", lon: 113.467, lat: 22.222 },
  { id: "GYA", name: "高要",   freq: "116.5", lon: 112.487, lat: 23.070 },
  { id: "LMN", name: "龙门",   freq: "116.3", lon: 114.327, lat: 23.650 },
  { id: "TAN", name: "源潭",   freq: "108.6", lon: 113.240, lat: 23.668 },
];

const FRAME_COUNT = 12;      // 时间轴帧数（与 #sv-timeline max=11 对应）

/** 数据源：mock = 内置雷暴生成器；himawari = 葵花 9 号 B13 红外实况（NICT，10min 一帧） */
const DATA_SOURCES = {
  mock:     { name: "模拟雷暴", adapter: () => new MockProvider(42),    intervalMin: 5,  layerTag: "CAPPI" },
  himawari: { name: "葵花卫星", adapter: () => new HimawariProvider(), intervalMin: 10, layerTag: "卫星 IR" },
};

// ── 模块实例与状态 ─────────────────────────────────────────────────

const provider = new WeatherDataProvider();
provider.setAdapter(new MockProvider(42));
const synth = new CloudTextureSynthesizer();
const stormTracker = new StormTracker();
const profiler = new FlightPathProfiler();
const timeline = new TimelineController();

let viewer = null;
let engine = null;
let engineReady = false;

let currentRegion = "beijing";
let currentSource = "mock";
let currentPerformance = "high";
let cloudsVisible = true;
/** 机场/导航台标记图层 */
let navDataSource = null;
/** 当前光照模式："day"（锁定正午，默认）/ "live"（实况太阳） */
let lightingMode = "day";

/** @type {import('../src/data/types.js').WeatherFrame[]} */
let weatherFrames = [];
/** 预合成的 Cesium.Texture 帧缓存（与 weatherFrames 对齐） */
let frameTextures = [];
/** 区域加载版本号：并发加载守卫 */
let loadVersion = 0;

// ── 工具 ──────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

let toastTimer = null;
function toast(msg) {
  const el = $("sv-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function setStatus(text, type = "ok") {
  const el = $("sv-status");
  const dot = $("sv-status-dot");
  if (el) el.textContent = text;
  if (dot) dot.classList.toggle("error", type === "error");
}

function fmtTime(iso) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function levelText(level) {
  return level === "danger" ? "危险" : level === "warn" ? "注意" : "安全";
}

// ── Cesium Viewer + 引擎初始化 ─────────────────────────────────────

function initViewer() {
  Cesium.Ion.defaultAccessToken = "";
  viewer = new Cesium.Viewer("cesiumContainer", {
    // Esri 世界卫星影像（免费无 key，真实地表）；失败时降级内置 NaturalEarthII 离线底图
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
      ).catch(() =>
        Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
        )
      )
    ),
    baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false,
    animation: false, timeline: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false,
    skyBox: false, skyAtmosphere: false,
    requestRenderMode: false,
    // preserveDrawingBuffer：支持截图导出（飞行前天气简报留存）
    // alpha 必须为 false：云后处理把“云覆盖度”写进输出 alpha（TAA 历史校验用），
    // 若 canvas 带透明度，云隙处 alpha≈0 会透出网页深色背景 → 云之间发黑
    contextOptions: { webgl: { alpha: false, preserveDrawingBuffer: true } },
  });
  // 俯仰控制：右键拖拽 = 调俯仰（Cesium 默认仅中键/Ctrl+拖拽，飞行员场景下不可发现）
  const ssc = viewer.scene.screenSpaceCameraController;
  ssc.tiltEventTypes = [
    Cesium.CameraEventType.RIGHT_DRAG,
    Cesium.CameraEventType.MIDDLE_DRAG,
    Cesium.CameraEventType.PINCH,
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
  ];
  ssc.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
  // 默认白天光照：真实时钟在傍晚/夜间会让云层无光照发黑，飞行简报场景下不可读
  setLightingMode("day");
  initNavMarkers();
  flyToRegion(currentRegion, false);
}

/** 光照模式：day = 锁定当天正午（云形态清晰可读）；live = 实况太阳位置（傍晚/夜间云会发暗） */
function setLightingMode(mode) {
  lightingMode = mode;
  const clock = viewer.clock;
  if (mode === "day") {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    clock.currentTime = Cesium.JulianDate.fromDate(noon);
    clock.shouldAnimate = false;
  } else {
    clock.currentTime = Cesium.JulianDate.now();
    clock.multiplier = 1;
    clock.shouldAnimate = true;
  }
}

/** 机场 + VOR 导航台标记（独立 DataSource，可一键显隐） */
function initNavMarkers() {
  navDataSource = new Cesium.CustomDataSource("nav-markers");
  const labelCommon = {
    font: "600 12px 'JetBrains Mono', monospace",
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    outlineColor: Cesium.Color.fromCssColorString("#060a10"),
    outlineWidth: 3,
    pixelOffset: new Cesium.Cartesian2(0, -16),
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    // 穿透地形/云底图层始终可见；远距离自动隐藏避免标签堆叠
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 900000),
    scaleByDistance: new Cesium.NearFarScalar(20000, 1.0, 600000, 0.6),
  };

  for (const [icao, ap] of Object.entries(AIRPORTS)) {
    navDataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 0),
      point: {
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString("#38bdf8"),
        outlineColor: Cesium.Color.fromCssColorString("#060a10"),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: { ...labelCommon, text: `✈ ${icao} ${ap.name}`, fillColor: Cesium.Color.fromCssColorString("#7dd3fc") },
    });
  }
  for (const nav of NAVAIDS) {
    navDataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(nav.lon, nav.lat, 0),
      point: {
        pixelSize: 5,
        color: Cesium.Color.fromCssColorString("#f59e0b"),
        outlineColor: Cesium.Color.fromCssColorString("#060a10"),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        ...labelCommon,
        text: `◈ ${nav.id} ${nav.freq}`,
        fillColor: Cesium.Color.fromCssColorString("#fbbf24"),
        // VOR 标签比机场更密，更近就隐
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 600000),
      },
    });
  }
  viewer.dataSources.add(navDataSource);
}

async function initEngine() {
  engine = new SkyVortexEngine(viewer, {
    cloudsAssetsBase: "/engine-base/public/clouds-assets/",
    atmosphereAssetsBase: "/engine-base/src/AtmosphereFromThreeGeospatial/assets/",
    atmosphereShaderBase: "/engine-base/src/AtmosphereFromThreeGeospatial/Shaders/",
    brunetonShaderBase: "/engine-base/src/AtmosphereFromThreeGeospatial/Shaders/bruneton/",
    blueNoiseUrl: "/engine-base/public/data/noisePic/noisergba256.png",
    showGui: false,
    performance: currentPerformance,
  });
  await engine.init();
  engineReady = true;
  window.__engine = engine;
}

function flyToRegion(region, animate = true) {
  if (!viewer) return;
  const r = REGIONS[region];
  const dest = Cesium.Cartesian3.fromDegrees(r.center[0], r.center[1], r.alt);
  const orientation = { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO * 0.45, roll: 0 };
  if (animate) viewer.camera.flyTo({ destination: dest, orientation, duration: 1.2 });
  else viewer.camera.setView({ destination: dest, orientation });
}

function setFlightView(mode) {
  if (!viewer) return;
  const [lon, lat] = REGIONS[currentRegion].center;
  const views = {
    pilot: { alt: 12000, pitch: -Math.PI / 3, heading: 0 },
    tower: { alt: 800,   pitch: Cesium.Math.toRadians(12), heading: 0 },
    side:  { alt: 6000,  pitch: 0, heading: Math.PI / 2, offsetLon: -0.9 },
    top:   { alt: 45000, pitch: -Cesium.Math.PI_OVER_TWO, heading: 0 },
  };
  const v = views[mode];
  if (!v) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon + (v.offsetLon || 0), lat, v.alt),
    orientation: { heading: v.heading, pitch: v.pitch, roll: 0 },
    duration: 1.2,
  });
}

// ── 数据管线：区域帧序列 → 合成 → 纹理缓存 → 时间轴 ─────────────────

async function loadRegion(region) {
  const version = ++loadVersion;
  const src = DATA_SOURCES[currentSource];
  setStatus("加载中…");
  $("sv-location").textContent = `${REGIONS[region].name} · ${src.layerTag}`;

  const frames = await provider.getTimeSeries(
    region, new Date().toISOString(), FRAME_COUNT, src.intervalMin
  );
  if (version !== loadVersion) return; // 已被更新的加载取代

  // 预合成 12 帧 Cesium 纹理（播放时零合成开销）
  const textures = frames.map(f => engineReady ? engine.createWeatherTexture(synth.synthesize(f)) : null);

  const oldTextures = frameTextures;
  weatherFrames = frames;
  frameTextures = textures;
  timeline.load(frames.map(f => ({ timestamp: f.timestamp, data: f })));

  // 旧缓存延迟销毁（当前已安装的旧纹理在 load→onFrame 安装新帧后才销毁，安全）
  if (engineReady) {
    for (const t of oldTextures) if (t) engine._destroyTextureDeferred(t);
  }

  renderStorms();
  setStatus(currentSource === "himawari" ? "卫星实况" : "实时");
}

function onTimelineFrame(index, frame) {
  const slider = $("sv-timeline");
  if (slider) slider.value = String(index);
  $("sv-time").textContent = frame ? fmtTime(frame.timestamp) : "--:--";
  if (engineReady && frameTextures[index]) {
    engine.setWeatherTexture(frameTextures[index], { destroyOld: false });
  }
}

// ── 面板渲染 ──────────────────────────────────────────────────────

function renderStorms() {
  const container = $("sv-storms");
  if (!container) return;
  if (!weatherFrames.length) {
    container.innerHTML = `<div class="sv-empty">暂无数据</div>`;
    return;
  }
  // 全序列追踪：拿到移速/移向
  const tracks = stormTracker.track(weatherFrames);
  if (!tracks.length) {
    container.innerHTML = `<div class="sv-empty">当前区域无活跃雷暴单体</div>`;
    return;
  }
  container.innerHTML = tracks.map(t => {
    const s = t.storm;
    const drift = s.driftSpeed != null ? ` · ${s.driftSpeed} km/h @${s.driftDir}°` : "";
    return `
      <div class="sv-card" data-storm-lon="${s.lon}" data-storm-lat="${s.lat}">
        <div class="sv-card-header">
          <div class="sv-card-title">${s.id}</div>
          <span class="sv-badge ${s.level}">${levelText(s.level)}</span>
        </div>
        <div class="sv-card-meta">${s.dbz} dBZ · 顶高 ${(s.topHeight / 1000).toFixed(1)} km${drift}</div>
      </div>`;
  }).join("");

  // 点击单体 → 飞过去
  container.querySelectorAll(".sv-card").forEach(card => {
    card.addEventListener("click", () => {
      const lon = Number(card.dataset.stormLon);
      const lat = Number(card.dataset.stormLat);
      if (viewer && Number.isFinite(lon)) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.35, 15000),
          orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
          duration: 1.2,
        });
      }
    });
  });
}

async function loadSigmets() {
  const container = $("sv-sigmets");
  if (!container) return;
  try {
    const sigmets = await provider.getSigmetsForRegion(currentRegion);
    if (!sigmets.length) {
      container.innerHTML = `<div class="sv-empty">当前区域无 SIGMET 警告</div>`;
      return;
    }
    container.innerHTML = sigmets.slice(0, 5).map(s => `
      <div class="sv-card">
        <div class="sv-card-header">
          <div class="sv-card-title">${s.label}</div>
          <span class="sv-badge ${s.level}">${levelText(s.level)}</span>
        </div>
        <div class="sv-card-meta">${s.fir} · ${s.startTime?.slice(11, 16) || "--"}-${s.endTime?.slice(11, 16) || "--"} UTC</div>
      </div>`).join("");
  } catch (err) {
    console.error("SIGMET load failed:", err);
    container.innerHTML = `<div class="sv-empty">SIGMET 加载失败（网络受限）</div>`;
  }
}

async function loadForecast() {
  const el = $("sv-forecast");
  if (!el) return;
  try {
    const days = await provider.getFlightWeatherSummary(currentRegion, 3);
    if (!days.length) {
      el.innerHTML = `<div class="sv-empty">暂无预报数据</div>`;
      return;
    }
    el.innerHTML = days.map(d => `
      <div class="sv-card">
        <div class="sv-card-header">
          <div class="sv-card-title">${d.date.slice(5)}</div>
          <span class="sv-badge ${d.riskLevel}">${levelText(d.riskLevel)}</span>
        </div>
        <div class="sv-card-meta">云量 ${Math.round(d.maxCloud)}% · 降水 ${d.maxPrecip.toFixed(1)} mm · 风 ${d.avgWind.toFixed(0)} km/h</div>
      </div>`).join("");
  } catch (err) {
    console.error("Forecast load failed:", err);
    el.innerHTML = `<div class="sv-empty">预报加载失败（网络受限）</div>`;
  }
}

// ── 航线 Tab：真剖面 + 真机场天气 ──────────────────────────────────

async function checkRoute() {
  const result = $("sv-route-result");
  const from = $("sv-from").value.trim().toUpperCase();
  const to = $("sv-to").value.trim().toUpperCase();
  const a = AIRPORTS[from], b = AIRPORTS[to];

  if (!a || !b) {
    result.innerHTML = `<div class="sv-empty">暂不支持该机场。可用：${Object.keys(AIRPORTS).join(" / ")}</div>`;
    return;
  }
  result.innerHTML = `<div class="sv-empty">查询中…</div>`;

  // 1) 雷达剖面（FlightPathProfiler，基于当前区域当前帧）
  profiler.setPath([{ lon: a.lon, lat: a.lat }, { lon: b.lon, lat: b.lat }]);
  const frame = weatherFrames[timeline.index] || weatherFrames[0];
  const profile = frame ? profiler.getProfile(frame) : null;

  // 2) 两端机场实时天气（Open-Meteo 真实 API）
  const [wxA, wxB] = await Promise.allSettled([
    provider.getAirportSnapshot(a.lat, a.lon),
    provider.getAirportSnapshot(b.lat, b.lon),
  ]);

  // 3) 风险判定：剖面最大 dBZ
  let maxDbz = 0;
  if (profile) {
    for (let i = 0; i < profile.dbz.length; i++) maxDbz = Math.max(maxDbz, profile.dbz[i]);
  }
  const risk = maxDbz > 45 ? "danger" : maxDbz > 30 ? "warn" : "safe";
  const riskText = risk === "danger" ? "建议绕飞" : risk === "warn" ? "注意对流" : "航路畅通";

  const airportCard = (icao, ap, wx) => {
    if (wx.status !== "fulfilled") {
      return `<div class="sv-card"><div class="sv-card-header"><div class="sv-card-title">${icao} ${ap.name}</div></div>
        <div class="sv-card-meta">天气获取失败（网络受限）</div></div>`;
    }
    const v = wx.value;
    return `<div class="sv-card">
      <div class="sv-card-header"><div class="sv-card-title">${icao} ${ap.name}</div></div>
      <div class="sv-card-meta">云底 ${Math.round(v.cloud.cappi_1km)} dBZ 等效 · 降水 ${v.precipitation.toFixed(1)} mm · 风 ${v.windSpeed.toFixed(0)} km/h @${Math.round(v.windDir)}°</div>
    </div>`;
  };

  result.innerHTML = `
    <div class="sv-card">
      <div class="sv-card-header">
        <div class="sv-card-title">${from} → ${to}</div>
        <span class="sv-badge ${risk}">${riskText}</span>
      </div>
      <div class="sv-card-meta">距离 ${profile ? profile.distanceKm : "--"} km · 航路峰值 ${maxDbz.toFixed(0)} dBZ</div>
    </div>
    <div style="font-size:11px;color:var(--sv-text-muted);margin:8px 0 4px;">航路垂直剖面（1/3/6 km 扫层，基于${REGIONS[currentRegion].name}雷达帧）</div>
    <canvas id="sv-profile-canvas" width="640" height="160" style="width:100%;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid var(--sv-border-subtle);"></canvas>
    ${airportCard(from, a, wxA)}
    ${airportCard(to, b, wxB)}
  `;

  if (profile) drawProfile($("sv-profile-canvas"), profile);
}

/** 剖面图：横轴距离，纵轴 3 个扫层，dBZ 上色 */
function drawProfile(canvas, profile) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const n = profile.sampleCount;
  const levels = 3;
  const padL = 34, padB = 18, padT = 6;
  const plotW = w - padL - 6, plotH = h - padT - padB;
  const cellW = plotW / n, cellH = plotH / levels;

  for (let si = 0; si < n; si++) {
    for (let lv = 0; lv < levels; lv++) {
      const dbz = profile.dbz[si * levels + lv];
      if (dbz < 10) continue;
      ctx.fillStyle = dbzColor(dbz);
      // 层序自下而上：lv=0 (1km) 画在底部
      const y = padT + (levels - 1 - lv) * cellH;
      ctx.fillRect(padL + si * cellW, y, Math.ceil(cellW), cellH - 1);
    }
  }

  // 轴标注
  ctx.fillStyle = "rgba(203,213,225,0.7)";
  ctx.font = "10px JetBrains Mono, monospace";
  const heightLabels = ["6km", "3km", "1km"];
  for (let lv = 0; lv < levels; lv++) {
    ctx.fillText(heightLabels[lv], 4, padT + lv * cellH + cellH / 2 + 3);
  }
  ctx.fillText("0", padL, h - 5);
  const distText = `${profile.distanceKm} km`;
  ctx.fillText(distText, w - ctx.measureText(distText).width - 4, h - 5);
}

function dbzColor(dbz) {
  if (dbz >= 50) return "rgba(239,68,68,0.95)";
  if (dbz >= 40) return "rgba(245,158,11,0.9)";
  if (dbz >= 30) return "rgba(250,204,21,0.85)";
  if (dbz >= 20) return "rgba(34,197,94,0.8)";
  return "rgba(56,189,248,0.55)";
}

// ── Tab 切换 ──────────────────────────────────────────────────────

const TABS = ["storms", "timeline", "sigmets", "forecast", "route", "settings"];

function showPanel(tab) {
  for (const t of TABS) {
    const panel = $(`sv-${t}-panel`);
    if (!panel) continue;
    if (t === tab) {
      panel.classList.remove("hidden");
      requestAnimationFrame(() => panel.classList.add("visible"));
    } else {
      panel.classList.remove("visible");
      panel.classList.add("hidden");
    }
  }
  document.querySelectorAll("#sv-tab-bar .sv-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

// ── 事件绑定（单一入口，绑定一次） ─────────────────────────────────

function bindEvents() {
  // 区域切换
  document.querySelectorAll("#sv-regions .sv-chip").forEach(chip => {
    chip.addEventListener("click", async () => {
      const region = chip.dataset.region;
      if (region === currentRegion) return;
      currentRegion = region;
      document.querySelectorAll("#sv-regions .sv-chip").forEach(c =>
        c.classList.toggle("active", c === chip));
      flyToRegion(region);
      toast(`切换到${REGIONS[region].name}`);
      try {
        await loadRegion(region);
      } catch (err) {
        console.error("loadRegion failed:", err);
        setStatus("数据错误", "error");
      }
      loadSigmets();
      loadForecast();
    });
  });

  // Tab 切换
  document.querySelectorAll("#sv-tab-bar .sv-tab").forEach(btn => {
    btn.addEventListener("click", () => showPanel(btn.dataset.tab));
  });

  // 时间轴
  $("sv-timeline")?.addEventListener("input", (e) => {
    timeline.pause();
    updatePlayIcon();
    timeline.seek(Number(e.target.value));
  });
  $("sv-play")?.addEventListener("click", () => {
    const st = timeline.getState();
    if (st.playing) timeline.pause(); else timeline.play();
    updatePlayIcon();
  });

  // 飞行视角
  document.querySelectorAll("[data-fpv]").forEach(btn => {
    btn.addEventListener("click", () => setFlightView(btn.dataset.fpv));
  });

  // 云体显隐
  $("sv-toggle-clouds")?.addEventListener("click", () => {
    if (!engineReady) { toast("3D 引擎未就绪"); return; }
    cloudsVisible = !cloudsVisible;
    engine.setCloudsVisible(cloudsVisible);
    toast(cloudsVisible ? "云体已显示" : "云体已隐藏");
  });

  // 导航标记显隐
  $("sv-toggle-nav")?.addEventListener("click", () => {
    if (!navDataSource) return;
    navDataSource.show = !navDataSource.show;
    toast(navDataSource.show ? "导航标记已显示" : "导航标记已隐藏");
  });

  // 光照模式切换（白天/实况）
  document.querySelectorAll("#sv-lighting .sv-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const mode = chip.dataset.lighting;
      if (mode === lightingMode) return;
      document.querySelectorAll("#sv-lighting .sv-chip").forEach(c =>
        c.classList.toggle("active", c === chip));
      setLightingMode(mode);
      toast(mode === "day" ? "已锁定白天光照" : "已切换到实况太阳位置");
    });
  });

  // 云体不透明度
  $("sv-density")?.addEventListener("input", (e) => {
    const pct = Number(e.target.value);
    const label = $("sv-density-val");
    if (label) label.textContent = `${pct}%`;
    if (engineReady) engine.setCloudDensity(pct / 100);
  });

  // 数据源切换（设置面板）
  document.querySelectorAll("#sv-source .sv-chip").forEach(chip => {
    chip.addEventListener("click", async () => {
      const source = chip.dataset.source;
      if (source === currentSource) return;
      currentSource = source;
      document.querySelectorAll("#sv-source .sv-chip").forEach(c =>
        c.classList.toggle("active", c === chip));
      provider.setAdapter(DATA_SOURCES[source].adapter());
      toast(`数据源：${DATA_SOURCES[source].name}`);
      try {
        await loadRegion(currentRegion);
      } catch (err) {
        console.error("Source switch failed:", err);
        setStatus("数据错误", "error");
        toast(currentSource === "himawari" ? "卫星数据获取失败（需网络）" : "数据加载失败");
      }
    });
  });

  // 刷新数据
  $("sv-refresh")?.addEventListener("click", async () => {
    toast("刷新数据…");
    await loadRegion(currentRegion);
    loadSigmets();
    loadForecast();
  });

  // 性能档位（HTML 中为 .sv-chip）
  document.querySelectorAll("#sv-perf .sv-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      currentPerformance = chip.dataset.perf;
      document.querySelectorAll("#sv-perf .sv-chip").forEach(c =>
        c.classList.toggle("active", c === chip));
      if (engineReady) engine.setPerformancePreset(currentPerformance);
      toast(`性能模式：${chip.textContent}`);
    });
  });

  // 航线查询
  $("sv-check-route")?.addEventListener("click", () => {
    checkRoute().catch(err => {
      console.error("Route check failed:", err);
      $("sv-route-result").innerHTML = `<div class="sv-empty">查询失败：${err.message}</div>`;
    });
  });
}

function updatePlayIcon() {
  const btn = $("sv-play");
  if (btn) btn.textContent = timeline.getState().playing ? "⏸" : "▶";
}

// ── 启动（单一入口） ───────────────────────────────────────────────

async function main() {
  // 解除 HTML 内置 4s 超时兜底（它只检查 .hidden 类）；用 inline style 控制真实可见性
  const loading = $("loading");
  loading.classList.add("hidden");
  loading.style.display = "flex";
  window.__mainLoaded = true;

  bindEvents();
  timeline.onFrame(onTimelineFrame);
  currentPerformance = detectDevicePerformance();
  document.querySelectorAll("#sv-perf .sv-chip").forEach(c =>
    c.classList.toggle("active", c.dataset.perf === currentPerformance));

  // 1) Cesium Viewer
  try {
    initViewer();
    window.__viewer = viewer;
  } catch (err) {
    console.error("Viewer init failed:", err);
    setStatus("2D 模式", "error");
  }

  // 2) 体积云引擎（失败时降级为数据面板模式）
  if (viewer) {
    try {
      await initEngine();
      const fallback = $("sv-fallback");
      if (fallback) fallback.style.display = "none";
      // 应用滑杆默认不透明度（默认 60%：高空俯视可透见地面）
      const density = Number($("sv-density")?.value || 100);
      if (density !== 100) engine.setCloudDensity(density / 100);
      setStatus("实时");
      toast("SkyVortex 就绪");
    } catch (err) {
      console.error("Engine init failed:", err);
      window.__init_error = err.message + "\n" + (err.stack || "");
      setStatus("2D 模式", "error");
      toast("3D 引擎不可用，数据面板仍可使用");
    }
  }
  loading.style.display = "none";

  // 3) 数据管线（即使引擎失败也照常提供分析数据）
  try {
    await loadRegion(currentRegion);
  } catch (err) {
    console.error("loadRegion failed:", err);
    setStatus("数据错误", "error");
  }
  loadSigmets();
  loadForecast();
}

main();
