/**
 * FlightPathProfiler — 航线垂直剖面
 *
 * 深度模块：调用者设定航线 waypoints，传入 WeatherFrame，
 * 获得沿航线的垂直反射率剖面。
 *
 * 接口：
 *   setPath(waypoints) → void
 *   getProfile(frame) → VerticalProfile
 */

/** @import { WeatherFrame, VerticalProfile } from '../data/types.js' */

/** 剖面采样间距 (km) */
const SAMPLE_INTERVAL_KM = 2;
/** 垂直层数 */
const VERTICAL_LEVELS = 3; // 对应 1km / 3km / 6km CAPPI
const LEVEL_HEIGHTS = [1000, 3000, 6000]; // m

export class FlightPathProfiler {
  /** @type {Array<{lon:number, lat:number}>} */
  #waypoints = [];

  /**
   * 设定航线
   * @param {Array<{lon:number, lat:number, alt?:number}>} waypoints
   */
  setPath(waypoints) {
    this.#waypoints = waypoints.map(w => ({ lon: w.lon, lat: w.lat }));
  }

  /** @returns {boolean} 是否已设定航线 */
  hasPath() {
    return this.#waypoints.length >= 2;
  }

  /**
   * 沿航线切垂直剖面
   * @param {WeatherFrame} frame
   * @returns {VerticalProfile}
   */
  getProfile(frame) {
    if (!this.hasPath()) throw new Error("No flight path set. Call setPath() first.");

    const { width: w, height: h, bounds, layers } = frame;
    const lonStep = (bounds.east - bounds.west) / w;
    const latStep = (bounds.north - bounds.south) / h;

    // 1. 计算航线总长和采样点
    const segments = [];
    let totalKm = 0;
    for (let i = 1; i < this.#waypoints.length; i++) {
      const a = this.#waypoints[i - 1], b = this.#waypoints[i];
      const dKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
      segments.push({ a, b, dKm, startKm: totalKm });
      totalKm += dKm;
    }

    const sampleCount = Math.max(2, Math.ceil(totalKm / SAMPLE_INTERVAL_KM));
    const distances = new Float32Array(sampleCount);
    const heights = new Float32Array(sampleCount * VERTICAL_LEVELS);
    const dbz = new Float32Array(sampleCount * VERTICAL_LEVELS);

    const cappiLayers = [layers.cappi_1km, layers.cappi_3km, layers.cappi_6km];

    for (let si = 0; si < sampleCount; si++) {
      const dKm = (si / (sampleCount - 1)) * totalKm;
      distances[si] = dKm;

      // 找到当前距离所在的线段
      const { lon, lat } = this.#interpolate(segments, dKm);

      // 经纬度 → 像素
      const px = clampInt((lon - bounds.west) / lonStep, 0, w - 1);
      const py = clampInt((lat - bounds.south) / latStep, 0, h - 1);
      const idx = py * w + px;

      for (let lv = 0; lv < VERTICAL_LEVELS; lv++) {
        heights[si * VERTICAL_LEVELS + lv] = LEVEL_HEIGHTS[lv];
        dbz[si * VERTICAL_LEVELS + lv] = cappiLayers[lv][idx] || 0;
      }
    }

    return { distanceKm: round1(totalKm), sampleCount, distances, heights, dbz };
  }

  /** 在折线段上按距离插值经纬度 */
  #interpolate(segments, dKm) {
    for (const seg of segments) {
      if (dKm <= seg.startKm + seg.dKm) {
        const t = seg.dKm > 0 ? (dKm - seg.startKm) / seg.dKm : 0;
        return {
          lon: seg.a.lon + (seg.b.lon - seg.a.lon) * t,
          lat: seg.a.lat + (seg.b.lat - seg.a.lat) * t,
        };
      }
    }
    const last = segments[segments.length - 1];
    return { lon: last.b.lon, lat: last.b.lat };
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clampInt(v, min, max) {
  const i = Math.round(v);
  return i < min ? min : i > max ? max : i;
}

function round1(v) { return Math.round(v * 10) / 10; }