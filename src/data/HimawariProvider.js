/**
 * HimawariProvider — 葵花 9 号（Himawari-9）B13 红外实况适配器
 *
 * 数据源：NICT Himawari Real-time Web 瓦片服务（免费、无 key）
 *   https://himawari8.nict.go.jp/img/FULL_24h/B13/{level}d/550/{YYYY}/{MM}/{DD}/{HHMMSS}_{x}_{y}.png
 *   - 全圆盘 10 分钟一帧，保留 24h
 *   - PNG 为灰度+alpha（colorType 4）：云信号编码在 **alpha 通道**
 *     alpha 0 = 无云/地表，alpha ~223 = 最冷云顶（深对流）
 *
 * 原理：红外亮温反演——云顶越冷（alpha 越大）→ 云顶越高 → 对流越强。
 * 输出与 MockProvider 相同的 WeatherFrame 契约（伪 dBZ CAPPI + cloudTop），
 * 下游合成/追踪/剖面模块零改动。
 *
 * 注意：浏览器直连 NICT 无 CORS 头，需经 vite 代理 /himawari → himawari8.nict.go.jp/img
 */

/** @import { WeatherFrame, GeoBounds } from './types.js' */

// ── GEOS 投影（纯函数，可单测） ────────────────────────────────────

/** Himawari 全圆盘标准网格：5500px 对应 CFAC/LFAC=20466275、COFF/LOFF=2750.5（HRIT 约定，扫描角单位为度） */
const GRID_PX = 5500;
const CFAC = 20466275;
const COFF = 2750.5;
const SUB_LON = 140.7;

/**
 * 经纬度 → 全圆盘像素坐标（GEOS 静止轨道投影）
 * @param {number} lonDeg 经度（度）
 * @param {number} latDeg 纬度（度）
 * @param {number} fullPx 圆盘图总边长（level*550）
 * @returns {{px:number, py:number} | null} 像素坐标；地球背面返回 null
 */
export function lonLatToDiskPixel(lonDeg, latDeg, fullPx) {
  const D2R = Math.PI / 180;
  const lon = lonDeg * D2R, lat = latDeg * D2R;
  // 地心纬度（扁率修正）
  const cLat = Math.atan(0.993243 * Math.tan(lat));
  const rl = 6356.7523 / Math.sqrt(1 - 0.00675701 * Math.cos(cLat) ** 2);
  const r1 = 42164 - rl * Math.cos(cLat) * Math.cos(lon - SUB_LON * D2R);
  const r2 = -rl * Math.cos(cLat) * Math.sin(lon - SUB_LON * D2R);
  const r3 = rl * Math.sin(cLat);
  // 可见性判定：视线与地球相交于背面时不可见
  if (r1 * (r1 - 42164) + r2 * r2 + r3 * r3 * 1.006739501 > 0) return null;
  const rn = Math.sqrt(r1 * r1 + r2 * r2 + r3 * r3);
  const x = Math.atan(-r2 / r1) / D2R; // 扫描角（度）
  const y = Math.asin(-r3 / rn) / D2R;
  const scale = fullPx / GRID_PX;
  return {
    px: (COFF + x * 2 ** -16 * CFAC) * scale,
    py: (COFF + y * 2 ** -16 * CFAC) * scale,
  };
}

// ── IR alpha → 伪雷达反演（纯函数，可单测） ─────────────────────────

/** 观测到的 B13 alpha 动态范围上限（最冷云顶） */
const ALPHA_MAX = 223;
/** 低于此归一化值视为无降水云（薄卷云/暖低云） */
const CONVECTIVE_FLOOR = 0.15;
/** 低于此归一化值视为晴空（地表噪声/薄难），避免全域糊一层背景云 */
const CLOUD_FLOOR = 0.08;

/**
 * alpha → 云顶高度（m）。线性近似：alpha 满值 ≈ 14km 深对流云顶；
 * 低于晴空地板的噪声不成云。
 * @param {number} alpha 0-255
 */
export function alphaToCloudTop(alpha) {
  const a = Math.min(1, alpha / ALPHA_MAX);
  if (a < CLOUD_FLOOR) return 0;
  return ((a - CLOUD_FLOOR) / (1 - CLOUD_FLOOR)) * 14000;
}

/**
 * alpha → 伪反射率（dBZ）。冷云顶代理对流强度；暖云/薄云不计降水。
 * @param {number} alpha 0-255
 */
export function alphaToDbz(alpha) {
  const a = Math.min(1, alpha / ALPHA_MAX);
  if (a < CONVECTIVE_FLOOR) return 0;
  return ((a - CONVECTIVE_FLOOR) / (1 - CONVECTIVE_FLOOR)) * 52;
}

/**
 * 把任意时刻对齐到卫星 10 分钟槽位（向下取整）
 * @param {Date} date
 * @returns {Date}
 */
export function alignToSlot(date) {
  const t = new Date(date);
  t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10, 0, 0);
  return t;
}

/** 槽位时间 → NICT URL 路径片段 "YYYY/MM/DD/HHMMSS" */
export function slotToPath(date) {
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${date.getUTCFullYear()}/${p(date.getUTCMonth() + 1)}/${p(date.getUTCDate())}/` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}00`;
}

// ── 适配器 ─────────────────────────────────────────────────────────

export class HimawariProvider {
  #baseUrl;
  #level;
  #size;
  /** @type {Map<string, ImageData|null>} 瓦片马赛克缓存（key: 槽位路径+瓦片范围） */
  #mosaicCache = new Map();

  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl="/himawari"] - 代理前缀（生产环境可替换为自有代理）
   * @param {number} [opts.level=8] - 圆盘细分级别（8d = 4400px，中国区域 ~2.5km/px）
   * @param {number} [opts.size=256] - 输出网格边长
   */
  constructor({ baseUrl = "/himawari", level = 8, size = 256 } = {}) {
    this.#baseUrl = baseUrl;
    this.#level = level;
    this.#size = size;
  }

  /**
   * @param {GeoBounds} bounds
   * @param {string} [time]
   * @returns {Promise<WeatherFrame>}
   */
  async getFrame(bounds, time) {
    const frames = await this.getTimeSeries(bounds, time || new Date().toISOString(), 1);
    return frames[0];
  }

  /**
   * 取卫星最近 count 帧（10 分钟间隔，实况回溯；start 仅作为"不晚于"参考）
   * @param {GeoBounds} bounds
   * @param {string} start
   * @param {number} count
   * @param {number} [intervalMin=10] - 会向上对齐到 10 的倍数
   * @returns {Promise<WeatherFrame[]>}
   */
  async getTimeSeries(bounds, start, count, intervalMin = 10) {
    const step = Math.max(10, Math.round(intervalMin / 10) * 10);
    const latest = await this.#fetchLatestSlot();
    const slots = [];
    for (let i = count - 1; i >= 0; i--) {
      slots.push(new Date(latest.getTime() - i * step * 60000));
    }

    // 区域 → 圆盘像素包围盒 → 瓦片范围（对所有帧相同）
    const fullPx = this.#level * 550;
    const corners = [
      [bounds.west, bounds.south], [bounds.west, bounds.north],
      [bounds.east, bounds.south], [bounds.east, bounds.north],
    ].map(([lo, la]) => lonLatToDiskPixel(lo, la, fullPx));
    if (corners.some(c => !c)) throw new Error("Region outside Himawari disk");
    const tx0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.px)) / 550));
    const tx1 = Math.min(this.#level - 1, Math.floor(Math.max(...corners.map(c => c.px)) / 550));
    const ty0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.py)) / 550));
    const ty1 = Math.min(this.#level - 1, Math.floor(Math.max(...corners.map(c => c.py)) / 550));

    const frames = [];
    for (const slot of slots) {
      const mosaic = await this.#fetchMosaic(slot, tx0, tx1, ty0, ty1);
      frames.push(this.#sampleFrame(bounds, slot, mosaic, { tx0, ty0, fullPx }));
    }
    return frames;
  }

  /** 最新可用槽位（latest.json，UTC） */
  async #fetchLatestSlot() {
    const r = await fetch(`${this.#baseUrl}/FULL_24h/latest.json?_=${Date.now()}`);
    if (!r.ok) throw new Error(`Himawari latest.json HTTP ${r.status}`);
    const { date } = await r.json(); // "2026-07-29 09:20:00"（UTC）
    return alignToSlot(new Date(date.replace(" ", "T") + "Z"));
  }

  /**
   * 取一个槽位覆盖区域的瓦片并拼成马赛克
   * @returns {Promise<ImageData|null>} null = 该槽位无数据（全部 404）
   */
  async #fetchMosaic(slot, tx0, tx1, ty0, ty1) {
    const key = `${slotToPath(slot)}|${tx0},${tx1},${ty0},${ty1}`;
    if (this.#mosaicCache.has(key)) return this.#mosaicCache.get(key);

    const w = (tx1 - tx0 + 1) * 550, h = (ty1 - ty0 + 1) * 550;
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const url = `${this.#baseUrl}/FULL_24h/B13/${this.#level}d/550/${slotToPath(slot)}_${tx}_${ty}.png`;
        jobs.push(
          fetch(url)
            .then(r => (r.ok ? r.blob().then(createImageBitmap) : null))
            .then(bmp => { if (bmp) ctx.drawImage(bmp, (tx - tx0) * 550, (ty - ty0) * 550); return !!bmp; })
            .catch(() => false)
        );
      }
    }
    const results = await Promise.all(jobs);
    const mosaic = results.some(Boolean) ? ctx.getImageData(0, 0, w, h) : null;
    // 缓存上限：约 12 帧 × 1 马赛克，防切区域后无限增长
    if (this.#mosaicCache.size > 24) this.#mosaicCache.clear();
    this.#mosaicCache.set(key, mosaic);
    return mosaic;
  }

  /** 马赛克 alpha → WeatherFrame（双线性采样） */
  #sampleFrame(bounds, slot, mosaic, { tx0, ty0, fullPx }) {
    const size = this.#size;
    const cappi1 = new Float32Array(size * size);
    const cappi3 = new Float32Array(size * size);
    const cappi6 = new Float32Array(size * size);
    const cloudTop = new Float32Array(size * size);

    if (mosaic) {
      const { data, width: mw, height: mh } = mosaic;
      const lonStep = (bounds.east - bounds.west) / size;
      const latStep = (bounds.north - bounds.south) / size;
      for (let y = 0; y < size; y++) {
        // WeatherFrame 行序与 MockProvider 一致：y=0 为南边界
        const lat = bounds.south + (y + 0.5) * latStep;
        for (let x = 0; x < size; x++) {
          const lon = bounds.west + (x + 0.5) * lonStep;
          const p = lonLatToDiskPixel(lon, lat, fullPx);
          if (!p) continue;
          const mx = p.px - tx0 * 550, my = p.py - ty0 * 550;
          if (mx < 0 || my < 0 || mx >= mw - 1 || my >= mh - 1) continue;
          // 双线性插值 alpha
          const x0 = Math.floor(mx), y0 = Math.floor(my);
          const fx = mx - x0, fy = my - y0;
          const a00 = data[(y0 * mw + x0) * 4 + 3], a10 = data[(y0 * mw + x0 + 1) * 4 + 3];
          const a01 = data[((y0 + 1) * mw + x0) * 4 + 3], a11 = data[((y0 + 1) * mw + x0 + 1) * 4 + 3];
          const alpha = a00 * (1 - fx) * (1 - fy) + a10 * fx * (1 - fy) + a01 * (1 - fx) * fy + a11 * fx * fy;

          const idx = y * size + x;
          const dbz = alphaToDbz(alpha);
          const top = alphaToCloudTop(alpha);
          cloudTop[idx] = top;
          cappi1[idx] = dbz * 0.9;
          cappi3[idx] = dbz;
          cappi6[idx] = top > 6000 ? dbz * 0.8 : 0; // 云顶不足 6km 时高层无回波
        }
      }
    }

    return {
      timestamp: slot.toISOString(),
      bounds: { west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north },
      width: size, height: size,
      layers: { cappi_1km: cappi1, cappi_3km: cappi3, cappi_6km: cappi6, cloudTop },
    };
  }
}
