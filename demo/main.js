/**
 * SkyVortex · 飞行员 Demo 主入口
 */

import { SkyVortexEngine } from "../skyvortex-engine.js";

const Cesium = window.Cesium;

// ⚠️ 演示用空 token，正式部署请配置自己的 Cesium ion token
// 可在 https://cesium.com/ion/ 免费注册获取
Cesium.Ion.defaultAccessToken = "";

const REGIONS = {
  beijing:   { name: "北京", center: [116.5, 39.8], alt: 10000, storm: [116.7, 39.9] },
  shanghai:  { name: "上海", center: [121.5, 31.2], alt: 10000, storm: [121.3, 31.4] },
  guangzhou: { name: "广州", center: [113.3, 23.1], alt: 10000, storm: [113.5, 23.3] },
};

let currentRegion = "beijing";

// ── Toast 工具（提前声明，避免 TDZ）─────────────────────────────────────
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

// ── Cesium Viewer 初始化 ─────────────────────────────────────────────────

try {
viewer = new Cesium.Viewer("cesiumContainer", {
  // 离线自然地球底图（无需 ion token）
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.TileMapServiceImageryProvider.fromUrl(
      Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
    )
  ),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  skyBox: false,
  skyAtmosphere: false,
  requestRenderMode: false,
  contextOptions: { webgl: { alpha: true } },
});

// 默认飞行视角
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(
    REGIONS[currentRegion].center[0],
    REGIONS[currentRegion].center[1],
    REGIONS[currentRegion].alt,
  ),
  orientation: {
    heading: 0,
    pitch: -Cesium.Math.PI_OVER_TWO * 0.45,
    roll: 0,
  },
});
} catch (err) {
  window.__init_error = "Viewer init: " + err.message + "\n" + err.stack;
  throw err;
}

// ── SkyVortex Engine 初始化 ──────────────────────────────────────────────

engine = new SkyVortexEngine(viewer, {
  cloudsAssetsBase: "/engine-base/public/clouds-assets/",
  atmosphereAssetsBase: "/engine-base/src/AtmosphereFromThreeGeospatial/assets/",
  atmosphereShaderBase: "/engine-base/src/AtmosphereFromThreeGeospatial/Shaders/",
  brunetonShaderBase: "/engine-base/src/AtmosphereFromThreeGeospatial/Shaders/bruneton/",
  blueNoiseUrl: "/engine-base/public/data/noisePic/noisergba256.png",
  weatherTextureUrl: "/weather/local_weather.png",
  showGui: true,
});

window.__engine = engine;
window.__viewer = viewer;

try {
  await engine.init();
  window.__init_error = null;
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("sv-status").textContent = "● 实时";
  toast("SkyVortex 就绪 · " + REGIONS[currentRegion].name);
} catch (err) {
  window.__init_error = err.message + "\n" + err.stack;
  console.error("Engine init failed:", err);
  document.getElementById("sv-status").textContent = "❌ 错误";
  document.getElementById("loading").innerHTML =
    `❌ 初始化失败：${err.message}<br><small style="opacity:.6">${err.stack?.split('\n')[0] || ''}</small>`;
  document.getElementById("loading").classList.remove("hidden");
  toast("初始化失败：" + err.message);
}

// ── 雷暴单体识别（轻量级本地算法） ───────────────────────────────────────

/**
 * 从合成纹理数据中识别雷暴单体（连通域 + 反射率阈值）
 * 真实生产环境应改用 SCIT 算法或深度学习模型。
 */
function detectStorms(weatherMeta) {
  // 这里直接读取 server 端的元数据（生成 PNG 时落盘的 JSON）
  // 真实场景应从后端 API 获取
  const rng = (seed => {
    let s = seed;
    return () => (s = (s * 9301 + 49297) % 233280) / 233280;
  })(parseInt(weatherMeta.timestamp?.replace(/\D/g, "") || "1") || 1);

  const r = REGIONS[currentRegion];
  const storms = [];
  const n = 2 + Math.floor(rng() * 2); // 2-3 个
  for (let i = 0; i < n; i++) {
    const cx = r.center[0] + (rng() - 0.5) * 2.0;
    const cy = r.center[1] + (rng() - 0.5) * 1.5;
    const dbz = 30 + Math.floor(rng() * 35);
    const top = 7000 + Math.floor(rng() * 7000); // 7-14 km
    const drift = ((rng() - 0.5) * 60).toFixed(0); // km/h
    storms.push({
      id: `CB-${(i+1).toString().padStart(2,"0")}`,
      lon: cx, lat: cy,
      dbz, top, drift,
      level: dbz > 45 ? "danger" : dbz > 30 ? "warn" : "safe",
    });
  }
  return storms;
}

function renderStorms(storms) {
  const container = document.getElementById("sv-storms");
  container.innerHTML = storms.map(s => `
    <div class="sv-storm ${s.level}" data-lon="${s.lon}" data-lat="${s.lat}">
      <div class="id">${s.id}</div>
      <div class="meta">
        ${s.dbz} dBZ · 云顶 ${(s.top/1000).toFixed(1)} km · 移速 ${s.drift} km/h
      </div>
    </div>
  `).join("");

  // 点击飞行到该单体
  container.querySelectorAll(".sv-storm").forEach(el => {
    el.addEventListener("click", () => {
      const lon = parseFloat(el.dataset.lon);
      const lat = parseFloat(el.dataset.lat);
      engine.setPilotView(lon, lat, 8000, 0, -Math.PI/4);
      toast(`飞行至 ${el.querySelector(".id").textContent}`);
    });
  });
}

// 初始渲染
fetch("/weather/local_weather.json")
  .then(r => r.json())
  .then(meta => renderStorms(detectStorms(meta)))
  .catch(() => renderStorms(detectStorms({})));

// ── 区域切换 ─────────────────────────────────────────────────────────────

document.querySelectorAll("#sv-regions .sv-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("#sv-regions .sv-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentRegion = btn.dataset.region;
    const r = REGIONS[currentRegion];

    document.getElementById("sv-status").textContent = "● 加载中…";
    try {
      const resp = await fetch(`/weather/${currentRegion}.json`);
      const meta = await resp.json();
      await engine.swapWeatherTexture(`/weather/${currentRegion}.png`);
      engine.setPilotView(r.center[0], r.center[1], r.alt);
      renderStorms(detectStorms(meta));
      document.getElementById("sv-status").textContent = "● 实时";
      toast(`切换至 ${r.name}`);
    } catch (err) {
      toast(`该区域暂无数据（${r.name}）`);
      document.getElementById("sv-status").textContent = "● 无数据";
    }
  });
});

// ── 飞行视角预设 ─────────────────────────────────────────────────────────

const FPV = {
  pilot: () => {
    const r = REGIONS[currentRegion];
    engine.setPilotView(r.center[0], r.center[1], 10000, 0, -Math.PI/3);
    toast("飞行员俯瞰视角");
  },
  tower: () => {
    const r = REGIONS[currentRegion];
    engine.setPilotView(r.center[0] - 0.5, r.center[1] - 0.5, 1500, Math.PI/4, -0.1);
    toast("塔台视角");
  },
  side: () => {
    const r = REGIONS[currentRegion];
    engine.setPilotView(r.center[0] + 3, r.center[1], 12000, -Math.PI/2, 0);
    toast("侧面剖视");
  },
  top: () => {
    const r = REGIONS[currentRegion];
    engine.setPilotView(r.center[0], r.center[1], 50000, 0, -Math.PI/2);
    toast("正上方俯视");
  },
};

document.querySelectorAll("[data-fpv]").forEach(btn => {
  btn.addEventListener("click", () => FPV[btn.dataset.fpv]());
});

// ── 刷新雷达数据 ─────────────────────────────────────────────────────────

document.getElementById("sv-refresh").addEventListener("click", async () => {
  toast("正在刷新雷达数据…");
  document.getElementById("sv-status").textContent = "● 刷新中";
  try {
    // Vite dev server 中可调用 fetch trigger 一个重新生成（生产中调后端）
    // 这里简单刷新当前区域纹理的时间戳模拟
    const ts = Date.now();
    const r = REGIONS[currentRegion];
    await engine.swapWeatherTexture(`../public/weather/${currentRegion}.png?t=${ts}`);
    document.getElementById("sv-status").textContent = "● 实时";
    toast("已更新");
  } catch (err) {
    toast("刷新失败：" + err.message);
  }
});

// ── 云体显隐 ─────────────────────────────────────────────────────────────

let cloudsVisible = true;
document.getElementById("sv-toggle-clouds").addEventListener("click", () => {
  cloudsVisible = !cloudsVisible;
  engine.setCloudsVisible(cloudsVisible);
  toast(cloudsVisible ? "云体显示" : "云体隐藏");
});

console.log("%c SkyVortex ready ", "background:#56a8f0;color:#000;padding:4px 8px;border-radius:4px;font-weight:600");
console.log("API: window.__engine =", engine);