/**
 * WeatherDataProvider — 数据层（接缝 1）
 *
 * 深度模块：调用者只需 `getFrame(region, time)` 即可获得标准化的
 * WeatherFrame，不需要知道数据来自 mock、CMA 拼图、还是商业 API。
 *
 * 接口：
 *   getFrame(region, time?) → WeatherFrame
 *   getTimeSeries(region, start, count, interval?) → WeatherFrame[]
 *   getRegions() → string[]
 *   getSigmets(lat?, lon?) → Sigmet[]
 *
 * 适配器：
 *   MockProvider    — 离线开发，合成雷暴数据
 *   CMAProvider     — 中国气象局雷达拼图（P1）
 *   CommercialProvider — 和风/象辑 API（P2）
 *   NoaaProvider    — NOAA 全球航空天气（SIGMET/METAR/雷达）
 */

/** @import { WeatherFrame, GeoBounds } from './types.js' */

import { NoaaCachedProvider } from "./NoaaProvider.js";

export class WeatherDataProvider {
  /** @type {Map<string, GeoBounds>} */
  #regions = new Map();

  /** @type {import('./MockProvider.js').MockProvider | null} */
  #adapter = null;

  /** @type {NoaaCachedProvider} */
  #noaa;

  constructor() {
    this.#regions.set("beijing", {
      west: 115.0, south: 39.0, east: 117.5, north: 41.0,
      center: [116.5, 39.8],
    });
    this.#regions.set("shanghai", {
      west: 120.5, south: 30.5, east: 122.5, north: 32.0,
      center: [121.5, 31.2],
    });
    this.#regions.set("guangzhou", {
      west: 112.5, south: 22.0, east: 114.5, north: 24.0,
      center: [113.3, 23.1],
    });
    this.#noaa = new NoaaCachedProvider();
  }

  /**
   * 设置数据适配器（mock / CMA / commercial）
   * @param {object} adapter - 满足 { getFrame, getTimeSeries } 接口的对象
   */
  setAdapter(adapter) {
    this.#adapter = adapter;
    return this;
  }

  /** @returns {string[]} 可用区域列表 */
  getRegions() {
    return [...this.#regions.keys()];
  }

  /** @returns {GeoBounds | undefined} */
  getBounds(region) {
    return this.#regions.get(region);
  }

  /**
   * 获取单帧天气数据
   * @param {string} region - 区域名
   * @param {string} [time] - ISO 时间，默认当前
   * @returns {Promise<WeatherFrame>}
   */
  async getFrame(region, time) {
    if (!this.#adapter) throw new Error("No data adapter set. Call setAdapter() first.");
    const bounds = this.#regions.get(region);
    if (!bounds) throw new Error(`Unknown region: ${region}`);
    return this.#adapter.getFrame(bounds, time);
  }

  /**
   * 获取时间序列
   * @param {string} region
   * @param {string} start - 起始 ISO 时间
   * @param {number} count - 帧数
   * @param {number} [intervalMin=5] - 帧间隔（分钟）
   * @returns {Promise<WeatherFrame[]>}
   */
  async getTimeSeries(region, start, count, intervalMin = 5) {
    if (!this.#adapter) throw new Error("No data adapter set.");
    const bounds = this.#regions.get(region);
    if (!bounds) throw new Error(`Unknown region: ${region}`);
    return this.#adapter.getTimeSeries(bounds, start, count, intervalMin);
  }

  // ── NOAA 航空天气（独立数据通道，5min 缓存）───────────────────────

  /**
   * 获取全球 SIGMET 列表
   * @returns {Promise<Array<{id,fir,label,level,startTime,endTime,geometry}>>}
   */
  async getSigmets() {
    return this.#noaa.fetchSigmets();
  }

  /**
   * 检查坐标是否在 SIGMET 区域内
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<Array>}
   */
  async checkSigmetsAt(lat, lon) {
    return this.#noaa.checkPoint(lat, lon);
  }

  /**
   * 获取区域附近的 SIGMET（返回区域内 + 邻近的）
   * @param {string} region
   * @returns {Promise<Array>}
   */
  async getSigmetsForRegion(region) {
    const bounds = this.#regions.get(region);
    if (!bounds) return [];
    // 中心 + 四角共 5 个探针点，单次 fetch 本地判断
    const probes = [
      [bounds.center[1], bounds.center[0]],
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
      [bounds.north, bounds.west],
      [bounds.south, bounds.east],
    ];
    return this.#noaa.checkPoints(probes);
  }

  // ── Open-Meteo 数值预报（全球云量/降水/风，30min 缓存）──────────────

  /** @type {OpenMeteoProvider | null} */
  #openMeteo = null;

  /**
   * 获取 Open-Meteo 云量预报（低/中/高云分层）
   * @param {string} region
   * @param {number} [days=3]
   * @returns {Promise<{lat,lon,layers:Array}>}
   */
  async getCloudForecast(region, days = 3) {
    if (!this.#openMeteo) {
      const { OpenMeteoProvider } = await import("./OpenMeteoProvider.js");
      this.#openMeteo = new OpenMeteoProvider();
    }
    const bounds = this.#regions.get(region);
    if (!bounds) throw new Error(`Unknown region: ${region}`);
    return this.#openMeteo.fetchForecast(bounds.center[1], bounds.center[0], days);
  }

  /**
   * 获取航线天气摘要（用于飞行计划）
   * @param {string} region
   * @param {number} [days=3]
   * @returns {Promise<Array<{date,maxCloud,maxPrecip,avgWind,riskLevel}>>}
   */
  async getFlightWeatherSummary(region, days = 3) {
    if (!this.#openMeteo) {
      const { OpenMeteoProvider } = await import("./OpenMeteoProvider.js");
      this.#openMeteo = new OpenMeteoProvider();
    }
    const bounds = this.#regions.get(region);
    if (!bounds) throw new Error(`Unknown region: ${region}`);
    return this.#openMeteo.getDailySummary(bounds.center[1], bounds.center[0], days);
  }

  /**
   * 获取任意坐标（如机场）的当前天气快照（航线 Tab 用）
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<{time,cloud,precipitation,windSpeed,windDir}>}
   */
  async getAirportSnapshot(lat, lon) {
    if (!this.#openMeteo) {
      const { OpenMeteoProvider } = await import("./OpenMeteoProvider.js");
      this.#openMeteo = new OpenMeteoProvider();
    }
    return this.#openMeteo.getSnapshot(lat, lon);
  }
}
