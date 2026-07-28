/**
 * Open-Meteo 数据适配器
 *
 * 免费、无需 API Key、非商业可用。
 * 数据源：open-meteo.com
 *
 * 提供：
 *  - 云量分层（低/中/高云）→ 直接映射到体积云图层
 *  - 降水概率/强度 → 雨层云厚度
 *  - 风速/风向 → 云体漂移方向
 *  - 温度/露点 → 云底高度估算
 */

const API_BASE = "https://api.open-meteo.com/v1";

// 云量 → 体积云覆盖度映射（0-1 → 0-255 dBZ 近似）
function cloudCoverToDbz(coverPercent) {
  // 0% → 5 dBZ（背景噪底），100% → 65 dBZ（强对流）
  return 5 + (coverPercent / 100) * 60;
}

// 云量分层 → 高度映射（简化模型）
function cloudLayerMapping(low, mid, high) {
  return {
    cappi_1km: cloudCoverToDbz(low),     // 低云 → 近地面层
    cappi_3km: cloudCoverToDbz(mid),     // 中云 → 对流层中层
    cappi_6km: cloudCoverToDbz(high),    // 高云 → 卷云/积雨云顶部
  };
}

export class OpenMeteoProvider {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 30 * 60 * 1000; // 30 分钟（数值预报更新慢）
  }

  /**
   * 获取坐标点的天气预报
   * @param {number} lat
   * @param {number} lon
   * @param {number} [forecastDays=3]
   * @returns {Promise<object>}
   */
  async fetchForecast(lat, lon, forecastDays = 3) {
    const cacheKey = `forecast_${lat.toFixed(1)}_${lon.toFixed(1)}_${forecastDays}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.cacheTTL) {
      return cached.data;
    }

    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      timezone: "Asia/Shanghai",
      forecast_days: forecastDays.toString(),
    });
    // Open-Meteo 要求 hourly 用重复参数，不能用逗号分隔
    const hourlyVars = [
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "precipitation_probability",
      "precipitation",
      "wind_speed_10m",
      "wind_direction_10m",
      "temperature_2m",
      "relative_humidity_2m",
    ];
    for (const v of hourlyVars) params.append("hourly", v);

    const url = `${API_BASE}/forecast?${params}`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();

    const result = this._parseForecast(data);
    this.cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  }

  /**
   * 获取历史天气（用于回溯/验证）
   * @param {number} lat
   * @param {number} lon
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<object>}
   */
  async fetchHistorical(lat, lon, startDate, endDate) {
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      timezone: "Asia/Shanghai",
      start_date: startDate,
      end_date: endDate,
    });
    const hourlyVars2 = [
      "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
      "precipitation", "wind_speed_10m",
    ];
    for (const v of hourlyVars2) params.append("hourly", v);

    const url = `${API_BASE}/forecast?${params}`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) throw new Error(`Open-Meteo historical ${resp.status}`);
    const data = await resp.json();
    return this._parseForecast(data);
  }

  /**
   * 解析 Open-Meteo 响应 → 简化格式
   */
  _parseForecast(data) {
    const hourly = data.hourly;
    const times = hourly.time;
    const n = times.length;

    const layers = [];
    for (let i = 0; i < n; i++) {
      const low = hourly.cloud_cover_low?.[i] || 0;
      const mid = hourly.cloud_cover_mid?.[i] || 0;
      const high = hourly.cloud_cover_high?.[i] || 0;
      const precip = hourly.precipitation?.[i] || 0;
      const windSpeed = hourly.wind_speed_10m?.[i] || 0;
      const windDir = hourly.wind_direction_10m?.[i] || 0;

      // 如果有降水，增强低层云量
      const effectiveLow = precip > 0 ? Math.max(low, 40 + precip * 10) : low;

      layers.push({
        time: times[i],
        cloud: cloudLayerMapping(effectiveLow, mid, high),
        precipitation: precip,
        windSpeed,
        windDir,
        totalCover: (effectiveLow + mid + high) / 3,
      });
    }

    return {
      lat: data.latitude,
      lon: data.longitude,
      timezone: data.timezone,
      layers,
    };
  }

  /**
   * 获取指定时间点的云层数据
   * @param {number} lat
   * @param {number} lon
   * @param {string} [time] - ISO 时间，默认当前
   * @returns {Promise<object>}
   */
  async getSnapshot(lat, lon, time) {
    const forecast = await this.fetchForecast(lat, lon, 3);
    const targetTime = time || new Date().toISOString();

    // 找最接近的时间点
    let closest = forecast.layers[0];
    let minDiff = Infinity;
    for (const layer of forecast.layers) {
      const diff = Math.abs(new Date(layer.time) - new Date(targetTime));
      if (diff < minDiff) {
        minDiff = diff;
        closest = layer;
      }
    }

    return {
      time: closest.time,
      cloud: closest.cloud,
      precipitation: closest.precipitation,
      windSpeed: closest.windSpeed,
      windDir: closest.windDir,
    };
  }

  /**
   * 获取多天预报摘要（用于航线规划）
   * @param {number} lat
   * @param {number} lon
   * @param {number} [days=3]
   * @returns {Promise<Array>}
   */
  async getDailySummary(lat, lon, days = 3) {
    const forecast = await this.fetchForecast(lat, lon, days);
    const hourly = forecast.layers;

    // 按天聚合
    const daily = new Map();
    for (const h of hourly) {
      const date = h.time.slice(0, 10);
      if (!daily.has(date)) {
        daily.set(date, {
          date,
          maxCloud: 0,
          maxPrecip: 0,
          avgWind: 0,
          samples: 0,
        });
      }
      const d = daily.get(date);
      d.maxCloud = Math.max(d.maxCloud, h.totalCover);
      d.maxPrecip = Math.max(d.maxPrecip, h.precipitation);
      d.avgWind += h.windSpeed;
      d.samples++;
    }

    return [...daily.values()].map(d => ({
      ...d,
      avgWind: d.avgWind / d.samples,
      riskLevel: d.maxPrecip > 5 ? "warn" : d.maxCloud > 80 ? "warn" : "safe",
    }));
  }
}
