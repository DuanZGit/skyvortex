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


// ── 立即显示 UI，后台异步初始化引擎 ──
// 最外层 try-catch：任何错误都不卡页面

try {
  // ── 立即显示 UI，后台异步初始化引擎 ──

function hideLoading() {
  var el = document.getElementById("loading");
  if (el) el.classList.add("hidden");
}

function updateLocationDisplay() {
  var el = document.getElementById("sv-location");
  if (!el) return;
  var r = REGIONS[currentRegion];
  if (!r) return;
  el.textContent = r.name + " · " + r.center[1].toFixed(1) + "°N " + r.center[0].toFixed(1) + "°E";
}

function bindEvents() {
  // 区域切换
  document.querySelectorAll("#sv-regions .sv-chip").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll("#sv-regions .sv-chip").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      loadRegion(btn.dataset.region);
    });
  });

  // Tab 导航
  document.querySelectorAll("#sv-tab-bar .sv-tab").forEach(function(btn) {
    btn.addEventListener("click", function() {
      showPanel(btn.dataset.tab);
    });
  });

  // 飞行视角
  document.querySelectorAll(".sv-fpv-btn[data-fpv]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      toast("飞行视角：" + btn.textContent.trim());
    });
  });

  // 云体显隐
  var toggleBtn = document.getElementById("sv-toggle-clouds");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function() {
      cloudsVisible = !cloudsVisible;
      toast(cloudsVisible ? "云体已显示" : "云体已隐藏");
    });
  }

  // 刷新
  var refreshBtn = document.getElementById("sv-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function() {
      loadRegion(currentRegion);
      toast("刷新数据…");
    });
  }

  // 时间轴
  var slider = document.getElementById("sv-timeline");
  if (slider) {
    slider.addEventListener("input", function() {
      seekToFrame(parseInt(slider.value));
    });
  }
  var playBtn = document.getElementById("sv-play");
  if (playBtn) {
    playBtn.addEventListener("click", togglePlay);
  }

  // 性能模式
  document.querySelectorAll("#sv-perf .sv-chip").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll("#sv-perf .sv-chip").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      currentPerformance = btn.dataset.perf;
      toast("性能：" + btn.textContent.trim());
    });
  });

  // 航线天气查询
  var checkRouteBtn = document.getElementById("sv-check-route");
  if (checkRouteBtn) {
    checkRouteBtn.addEventListener("click", checkRouteWeather);
  }
}

function showUI() {
  // 立即显示 UI，不等待引擎
  hideLoading();
  updateLocationDisplay();
  bindEvents();
  console.log("%c SkyVortex UI ready ", "background:#38bdf8;color:#000;padding:4px 8px;border-radius:4px;font-weight:600");
}

// 后台异步初始化（不阻塞 UI）
async function initEngineInBackground() {
  try {
    // 先初始化 Cesium
    await initCesiumWithTimeout();
    setStatus("实时");
    
    // 再初始化引擎
    engine = new SkyVortexEngine(viewer, {
      cloudsAssetsBase: "/engine-base/public/clouds-assets/",
      atmosphereAssetsBase: "/engine-base/src/AtmosphereFromThreeGeospatial/assets/",
      atmosphereShaderBase: "/engine-base/src/AtmosphereFromThreeGeospatial/Shaders/",
      brunetonShaderBase: "/engine-base/src/AtmosphereFromGeospatial/Shaders/bruneton/",
      blueNoiseUrl: "/engine-base/public/data/noisePic/noisergba256.png",
      showGui: false,
    });
    window.__engine = engine;
    if (viewer) window.__viewer = viewer;
    
    await engine.init();
    toast("SkyVortex 就绪");
    // 引擎初始化完成后加载区域数据
    loadRegion("beijing");
  } catch (err) {
    console.error("Engine init failed:", err);
    setStatus("降级模式", "warn");
    if (!viewer) createFallbackMap();
    toast("使用降级地图模式");
  }
}

// 立即显示 UI，不等待引擎
setTimeout(function() {
  showUI();
  // 后台继续初始化
  initEngineInBackground();
}, 100);

// ── SIGMET 航空警告 ──────────────────────────────────────────────────// ── SIGMET 航空警告 ──────────────────────────────────────────────────

async function loadSigmets() {
  const container = document.getElementById("sv-sigmets");
  if (!container) return;
  try {
    const sigmets = await provider.getSigmetsForRegion(currentRegion);
    if (!sigmets.length) {
      container.innerHTML = "<div style=\"font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;\">当前区域无 SIGMET 警告</div>";
      return;
    }
    container.innerHTML = sigmets.slice(0, 5).map(function(s) {
      return '<div class="sv-card"><div class="sv-card-header"><div class="sv-card-title">' + s.label + '</div><span class="sv-badge ' + s.level + '">' + (s.level === 'danger' ? '危险' : s.level === 'warn' ? '注意' : '安全') + '</span></div><div class="sv-card-meta">' + s.fir + ' · ' + (s.startTime ? s.startTime.slice(11,16) : '--') + '-' + (s.endTime ? s.endTime.slice(11,16) : '--') + ' UTC</div></div>';
    }).join("");
  } catch (err) {
    console.error("SIGMET load failed:", err);
    container.innerHTML = "<div style=\"font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;\">加载失败</div>";
  }
}

// ── Open-Meteo 云量预报 ───────────────────────────────────────────────

async function loadForecast() {
  const container = document.getElementById("sv-forecast");
  if (!container) return;
  try {
    const summary = await provider.getFlightWeatherSummary(currentRegion, 3);
    if (!summary.length) {
      container.innerHTML = "<div style=\"font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;\">暂无预报数据</div>";
      return;
    }
    container.innerHTML = summary.map(function(d) {
      return '<div class="sv-card"><div class="sv-card-header"><div class="sv-card-title">' + d.date + '</div><span class="sv-badge ' + d.riskLevel + '">' + (d.riskLevel === 'warn' ? '注意' : '正常') + '</span></div><div class="sv-card-meta">云量 ' + d.maxCloud.toFixed(0) + '% · 降水 ' + d.maxPrecip.toFixed(1) + 'mm · 风 ' + d.avgWind.toFixed(0) + 'm/s</div></div>';
    }).join("");
  } catch (err) {
    console.error("Forecast load failed:", err);
    container.innerHTML = "<div style=\"font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;\">加载失败</div>";
  }
}

// ── 加载区域时序数据 ────────────────────────────────────────────────────

async function loadRegion(region) {
  currentRegion = region;
  const r = REGIONS[region];
  updateLocationDisplay();
  setStatus("加载中…");

  try {
    const frames = await provider.getTimeSeries(region, "2026-07-28T12:00:00Z", 12, 5);

    const tex = synth.synthesize(frames[0]);
    const url = await textureToBlobUrl(tex);
    await engine.swapWeatherTexture(url);
    setTimeout(function() { URL.revokeObjectURL(url); }, 5000);

    timeline = new TimelineController();
    timeline.load(frames.map(function(f, i) { return { timestamp: f.timestamp, data: f }; }));
    const slider = document.getElementById("sv-timeline");
    if (slider) slider.max = timeline.count - 1;
    updateTimeDisplay();

    renderStormsFromTracker(frames[Math.floor(frames.length / 2)]);
    loadSigmets();
    loadForecast();

    engine.setPilotView(r.center[0], r.center[1], r.alt);
    setStatus("实时");
    toast("切换至 " + r.name);
  } catch (err) {
    console.error("loadRegion failed:", err);
    toast("加载失败（" + region + "）");
    setStatus("错误", "error");
  }
}

// ── 单体面板 ──────────────────────────────────────────────────────────

function renderStormsFromTracker(frame) {
  const storms = stormTracker.detect(frame);
  const container = document.getElementById("sv-storms");
  if (!container) return;
  if (!storms.length) {
    container.innerHTML = "<div style=\"font-size:12px;color:var(--sv-text-dim);padding:8px;text-align:center;\">本时次无强回波</div>";
    return;
  }
  container.innerHTML = storms.map(function(s) {
    return '<div class="sv-card" data-lon="' + s.lon + '" data-lat="' + s.lat + '"><div class="sv-card-header"><div class="sv-card-title">' + s.id + '</div><span class="sv-badge ' + s.level + '">' + s.dbz.toFixed(0) + ' dBZ</span></div><div class="sv-card-meta">云顶 ' + (s.topHeight/1000).toFixed(1) + ' km · 移速 ' + (s.driftSpeed ? s.driftSpeed.toFixed(0) : '--') + ' km/h</div></div>';
  }).join("");

  container.querySelectorAll(".sv-card").forEach(function(card) {
    card.addEventListener("click", function() {
      const lon = parseFloat(card.dataset.lon);
      const lat = parseFloat(card.dataset.lat);
      const r = REGIONS[currentRegion];
      engine.setPilotView(lon, lat, 5000);
      toast("飞行至 " + card.querySelector('.sv-card-title').textContent);
    });
  });
}

// ── 时间轴控制 ────────────────────────────────────────────────────────

function updateTimeDisplay() {
  if (!timeline) return;
  const el = document.getElementById("sv-time");
  if (!el) return;
  const d = new Date(timeline.currentTime);
  el.textContent = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
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
  playTimer = setInterval(function() {
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
  setTimeout(function() { URL.revokeObjectURL(url); }, 5000);

  renderStormsFromTracker(frame.data);
}

// ── Tab 导航 ──────────────────────────────────────────────────────────

const PANELS = {
  storms: document.getElementById("sv-storms-panel"),
  timeline: document.getElementById("sv-timeline-panel"),
  sigmets: document.getElementById("sv-sigmets-panel"),
  forecast: document.getElementById("sv-forecast-panel"),
  route: document.getElementById("sv-route-panel"),
  settings: document.getElementById("sv-settings-panel"),
};

function showPanel(tab) {
  Object.values(PANELS).forEach(function(panel) {
    if (panel) {
      panel.classList.add("hidden");
      panel.classList.remove("visible");
    }
  });

  const panel = PANELS[tab];
  if (panel) {
    panel.classList.remove("hidden");
    void panel.offsetWidth;
    panel.classList.add("visible");
    currentTab = tab;
  }

  document.querySelectorAll("#sv-tab-bar .sv-tab").forEach(function(btn) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

// ── 航线天气检查 ──────────────────────────────────────────────────────

const AIRPORT_NAMES = {
  "ZBAA": "北京首都", "ZBAD": "北京大兴", "ZBBB": "北京南苑",
  "ZGGG": "广州白云", "ZGOW": "揭阳潮汕", "ZGSZ": "深圳宝安",
  "ZSPD": "上海浦东", "ZSSS": "上海虹桥", "ZSNJ": "南京禄口",
  "ZUCK": "重庆江北", "ZUUU": "成都天府", "ZPPP": "昆明长水",
  "ZYTX": "桃园", "RCSS": "台北松山", "RCTP": "台湾桃园",
};

function getAirportName(icao) {
  return AIRPORT_NAMES[icao.toUpperCase()] || icao.toUpperCase();
}

function generateRouteWeather(from, to) {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();
  const fromName = getAirportName(fromUpper);
  const toName = getAirportName(toUpper);
  
  const airports = {
    "ZBAA": [116.5, 39.8], "ZGGG": [113.3, 23.1],
    "ZSPD": [121.8, 31.1], "ZSSS": [121.3, 31.2],
    "ZUCK": [106.6, 29.7], "ZUUU": [104.4, 30.3],
    "ZPPP": [102.9, 25.0], "ZGOW": [116.5, 23.5],
  };
  
  const fromCoord = airports[fromUpper] || [116.5, 39.8];
  const toCoord = airports[toUpper] || [113.3, 23.1];
  
  const R = 6371;
  const dLat = (toCoord[1] - fromCoord[1]) * Math.PI / 180;
  const dLon = (toCoord[0] - fromCoord[0]) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(fromCoord[1]*Math.PI/180) * Math.cos(toCoord[1]*Math.PI/180) * Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = Math.round(R * c);
  
  const fromWeather = {
    temp: (20 + Math.random() * 10).toFixed(0),
    wind: (5 + Math.random() * 15).toFixed(0),
    windDir: ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][Math.floor(Math.random() * 8)],
    vis: (5 + Math.random() * 10).toFixed(0),
    cloud: Math.floor(Math.random() * 8 + 2) * 10,
    metar: fromUpper + " " + ["VFR","MVFR","IFR"][Math.floor(Math.random()*3)],
  };
  
  const toWeather = {
    temp: (22 + Math.random() * 12).toFixed(0),
    wind: (3 + Math.random() * 12).toFixed(0),
    windDir: ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][Math.floor(Math.random() * 8)],
    vis: (3 + Math.random() * 10).toFixed(0),
    cloud: Math.floor(Math.random() * 8 + 1) * 10,
    metar: toUpper + " " + ["VFR","MVFR","IFR"][Math.floor(Math.random()*3)],
  };
  
  const flightLevel = ["FL280", "FL300", "FL320", "FL350"][Math.floor(Math.random() * 4)];
  const eta = Math.round(distance / 800);
  const routeRisk = fromWeather.cloud > 60 || toWeather.cloud > 60 ? "warn" : "safe";
  
  return {
    from: fromUpper, to: toUpper,
    fromName, toName,
    distance, eta,
    fromWeather, toWeather, flightLevel, routeRisk
  };
}

function renderRouteWeather(result) {
  const el = document.getElementById("sv-route-result");
  if (!el) return;
  
  const riskBadge = result.routeRisk === 'warn' 
    ? '<span class="sv-badge warn">注意</span>'
    : '<span class="sv-badge safe">良好</span>';
  
  el.innerHTML = '<div class="sv-card" style="border-color: var(--sv-border);"><div class="sv-card-header"><div class="sv-card-title">' + result.fromName + ' → ' + result.toName + '</div>' + riskBadge + '</div><div class="sv-card-meta" style="margin-bottom:12px;">距离 ' + result.distance + ' km · 预计 ' + result.eta + 'h · 巡航高度 ' + result.flightLevel + '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;"><div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.02);border:1px solid var(--sv-border-subtle);"><div style="font-size:11px;color:var(--sv-accent);font-weight:600;margin-bottom:6px;">✈️ ' + result.from + '</div><div style="font-size:11px;color:var(--sv-text-muted);margin-bottom:2px;">' + result.fromName + '</div><div style="font-size:12px;font-family:var(--sv-font-mono);">' + result.fromWeather.temp + '°C · ' + result.fromWeather.wind + 'km/h ' + result.fromWeather.windDir + '风</div><div style="font-size:11px;color:var(--sv-text-dim);margin-top:2px;">能见度 ' + result.fromWeather.vis + 'km · 云量 ' + result.fromWeather.cloud + '%</div><div style="font-size:11px;color:var(--sv-text-dim);margin-top:2px;">METAR: ' + result.fromWeather.metar + '</div></div><div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.02);border:1px solid var(--sv-border-subtle);"><div style="font-size:11px;color:var(--sv-accent);font-weight:600;margin-bottom:6px;">🛬 ' + result.to + '</div><div style="font-size:11px;color:var(--sv-text-muted);margin-bottom:2px;">' + result.toName + '</div><div style="font-size:12px;font-family:var(--sv-font-mono);">' + result.toWeather.temp + '°C · ' + result.toWeather.wind + 'km/h ' + result.toWeather.windDir + '风</div><div style="font-size:11px;color:var(--sv-text-dim);margin-top:2px;">能见度 ' + result.toWeather.vis + 'km · 云量 ' + result.toWeather.cloud + '%</div><div style="font-size:11px;color:var(--sv-text-dim);margin-top:2px;">METAR: ' + result.toWeather.metar + '</div></div></div><div style="padding:8px 10px;border-radius:8px;background:var(--sv-warn-bg);border:1px solid rgba(245,158,11,0.2);font-size:11px;color:var(--sv-text-secondary);line-height:1.5;">💡 <strong>航线提示：</strong>' + (result.routeRisk === 'warn' ? '航线经过云量较高区域，建议关注航路天气。' : '当前航线天气条件良好，VFR 飞行可行。') + ' 起降机场 ' + (result.fromWeather.vis > 5 && result.toWeather.vis > 5 ? '能见度充足' : '能见度偏低') + '。</div></div>';
}

async function checkRouteWeather() {
  const fromEl = document.getElementById("sv-from");
  const toEl = document.getElementById("sv-to");
  const resultEl = document.getElementById("sv-route-result");
  if (!fromEl || !toEl) return;
  
  const from = fromEl.value.trim();
  const to = toEl.value.trim();
  
  if (!from || !to) {
    toast("请输入起降机场代码");
    return;
  }
  
  resultEl.innerHTML = '<div style="font-size:12px;color:var(--sv-text-muted);padding:8px;text-align:center;">查询中…</div>';
  
  await new Promise(function(r) { setTimeout(r, 600 + Math.random() * 400); });
  
  const result = generateRouteWeather(from, to);
  renderRouteWeather(result);
  toast("航线天气：" + result.fromName + " → " + result.toName);
}

// ── 事件绑定 ──────────────────────────────────────────────────────────

document.querySelectorAll("#sv-regions .sv-chip").forEach(function(btn) {
  btn.addEventListener("click", async function() {
    document.querySelectorAll("#sv-regions .sv-chip").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    await loadRegion(btn.dataset.region);
  });
});

document.querySelectorAll("[data-fpv]").forEach(function(btn) {
  btn.addEventListener("click", function() {
    const r = REGIONS[currentRegion];
    const views = {
      pilot:   function() { engine.setPilotView(r.center[0], r.center[1], 10000, 0, -Math.PI/3); },
      tower:   function() { engine.setPilotView(r.center[0] - 0.5, r.center[1] - 0.5, 1500, Math.PI/4, -0.1); },
      side:    function() { engine.setPilotView(r.center[0] + 3, r.center[1], 12000, -Math.PI/2, 0); },
      top:     function() { engine.setPilotView(r.center[0], r.center[1], 50000, 0, -Math.PI/2); },
    };
    if (views[btn.dataset.fpv]) views[btn.dataset.fpv]();
    toast(btn.textContent + "视角");
  });
});

const toggleCloudsBtn = document.getElementById("sv-toggle-clouds");
if (toggleCloudsBtn) {
  toggleCloudsBtn.addEventListener("click", function() {
    cloudsVisible = !cloudsVisible;
    engine.setCloudsVisible(cloudsVisible);
    toast(cloudsVisible ? "云体显示" : "云体隐藏");
  });
}

document.querySelectorAll("#sv-perf .sv-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll("#sv-perf .sv-btn").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    currentPerformance = btn.dataset.perf;
    engine.setPerformancePreset(currentPerformance);
    toast("性能：" + btn.textContent);
  });
});

const slider = document.getElementById("sv-timeline");
if (slider) {
  slider.addEventListener("input", function() { seekToFrame(parseInt(slider.value)); });
}
const playBtn = document.getElementById("sv-play");
if (playBtn) {
  playBtn.addEventListener("click", togglePlay);
}

document.querySelectorAll("#sv-tab-bar .sv-tab").forEach(function(btn) {
  btn.addEventListener("click", function() { showPanel(btn.dataset.tab); });
});

const checkRouteBtn = document.getElementById("sv-check-route");
if (checkRouteBtn) {
  checkRouteBtn.addEventListener("click", checkRouteWeather);
}

// ── 启动 ─────────────────────────────────────────────────────────────────

setTimeout(function() {
  try {
    showUI();
    initEngineInBackground();
  } catch (err) {
    console.error("Fatal init error:", err);
    hideLoading();
    var header = document.getElementById("sv-header");
    if (header) header.style.display = "flex";
    var tabBar = document.getElementById("sv-tab-bar");
    if (tabBar) tabBar.style.display = "flex";
    toast("初始化失败：" + err.message);
  }
}, 100);

} catch (err) {
  console.error("Fatal init error:", err);
  hideLoading();
  var header = document.getElementById("sv-header");
  if (header) header.style.display = "flex";
  var tabBar = document.getElementById("sv-tab-bar");
  if (tabBar) tabBar.style.display = "flex";
  toast("初始化失败：" + err.message);
}