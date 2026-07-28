/**
 * MockProvider — WeatherDataProvider 的 mock 适配器
 *
 * 在浏览器端生成合成雷暴数据，用于离线开发。
 * 与 Python 端 cappi_to_weather.py 的 synthesize_mock_tile 逻辑对齐。
 */

/** @import { WeatherFrame, GeoBounds } from './types.js' */

export class MockProvider {
  #seed;

  constructor(seed = 42) {
    this.#seed = seed;
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
   * @param {GeoBounds} bounds
   * @param {string} start
   * @param {number} count
   * @param {number} intervalMin
   * @returns {Promise<WeatherFrame[]>}
   */
  async getTimeSeries(bounds, start, count, intervalMin = 5) {
    const size = 256; // 浏览器端用较小尺寸，性能优先
    const t0 = new Date(start);
    const frames = [];

    // 生成 3 个单体参数（固定种子保证一致性）
    const rng = this.#createRng(this.#seed);
    const storms = [];
    for (let i = 0; i < 3; i++) {
      storms.push({
        lon0: bounds.center[0] + (rng() - 0.5) * 2.0,
        lat0: bounds.center[1] + (rng() - 0.5) * 1.5,
        driftLon: 0.01 + rng() * 0.03,
        driftLat: 0.005 + rng() * 0.015,
        peakDbz: 45 + rng() * 17,
        rx: 0.3 + rng() * 0.4,
        ry: 0.3 + rng() * 0.4,
        peakFrame: 3 + Math.floor(rng() * 5),
        lifecycle: 8 + Math.floor(rng() * 6),
        topPeak: 11000 + rng() * 3500,
      });
    }

    const w = size, h = size;
    const lonStep = (bounds.east - bounds.west) / w;
    const latStep = (bounds.north - bounds.south) / h;

    for (let fi = 0; fi < count; fi++) {
      const t = new Date(t0.getTime() + fi * intervalMin * 60000);
      const cappi1 = new Float32Array(w * h);
      const cappi3 = new Float32Array(w * h);
      const cappi6 = new Float32Array(w * h);
      const cloudTop = new Float32Array(w * h);

      for (const s of storms) {
        const age = fi;
        if (age >= s.lifecycle) continue;
        const phase = age / s.lifecycle;
        const intensity = Math.sin(phase * Math.PI);
        const dbz = s.peakDbz * intensity;
        const cx = s.lon0 + s.driftLon * age;
        const cy = s.lat0 + s.driftLat * age;
        const spread = 1.0 + 0.3 * intensity;
        const rx = s.rx * spread, ry = s.ry * spread;

        for (let y = 0; y < h; y++) {
          const lat = bounds.south + (y + 0.5) * latStep;
          for (let x = 0; x < w; x++) {
            const lon = bounds.west + (x + 0.5) * lonStep;
            const dx = (lon - cx) / rx;
            const dy = (lat - cy) / ry;
            const r2 = dx * dx + dy * dy;
            const idx = y * w + x;

            cappi1[idx] = Math.max(cappi1[idx], dbz * Math.exp(-r2 * 0.5));
            cappi3[idx] = Math.max(cappi3[idx], dbz * 1.1 * Math.exp(-r2 * 1.5));
            const highCore = dbz * 0.9 * Math.exp(-r2 * 2.5);
            const anvil = (dbz - 15) * Math.exp(-r2 * 0.3) * 0.6 * intensity;
            cappi6[idx] = Math.max(cappi6[idx], Math.max(highCore, anvil));

            const top = s.topPeak * intensity;
            cloudTop[idx] = Math.max(cloudTop[idx], top * 0.5 + top * 0.5 * Math.exp(-r2 * 1.2));
          }
        }
      }

      frames.push({
        timestamp: t.toISOString(),
        bounds: { west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north },
        width: w, height: h,
        layers: { cappi_1km: cappi1, cappi_3km: cappi3, cappi_6km: cappi6, cloudTop },
      });
    }

    return frames;
  }

  /** 简单 LCG 伪随机数 */
  #createRng(seed) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
}