/**
 * NOAA AviationWeather 数据适配器
 *
 * 免费、无需认证、全球覆盖。
 * 数据源：api.weather.gov
 *
 * 提供：
 *  - SIGMET / AIRMET（积雨云、湍流、结冰区域）
 *  - 雷达站点元数据
 *  - 卫星缩略图
 */

const SIGMET_URL = "https://api.weather.gov/aviation/sigmets";
const RADAR_STATIONS_URL = "https://api.weather.gov/radar/stations";

// WMO 现象 → 飞行员可读标签
const PHENOMENON_LABELS = {
  "EMBD_TS":        "嵌入式雷暴",
  "EMBD_TS_GR":     "嵌入式雷暴+冰雹",
  "FRQ_TS":         "频繁雷暴",
  "SQL_TS":         "飑线",
  "TURB":           "湍流",
  "TURB_MOD":       "中度湍流",
  "TURB_SEV":       "严重湍流",
  "TURB_EXTREME":   "极端湍流",
  "ICE":            "结冰",
  "ICE_MOD":        "中度结冰",
  "ICE_SEV":        "严重结冰",
  "RDOACT_CLD":     "火山灰云",
  "RDOACT_DUST":    "放射性尘埃",
};

function classifyLevel(phenomenon) {
  if (!phenomenon) return "warn";
  const p = phenomenon.split("/").pop() || phenomenon;
  if (["EMBD_TS_GR", "TURB_EXTREME", "ICE_SEV"].includes(p)) return "danger";
  if (["EMBD_TS", "FRQ_TS", "SQL_TS", "TURB_SEV", "ICE_MOD"].includes(p)) return "warn";
  return "safe";
}

export class NoaaProvider {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 分钟
  }

  /** 获取全球 SIGMET 列表 */
  async fetchSigmets() {
    const resp = await fetch(SIGMET_URL, {
      headers: { "Accept": "application/geo+json", "User-Agent": "SkyVortex/0.1 (pilot weather app)" },
    });
    if (!resp.ok) throw new Error(`NOAA SIGMET ${resp.status}: ${resp.statusText}`);
    const geojson = await resp.json();
    return this._parseSigmets(geojson);
  }

  /** 获取指定 FIR 的 SIGMET */
  async fetchSigmetsByFir(firId) {
    const all = await this.fetchSigmets();
    return all.filter(s => s.fir === firId.toUpperCase());
  }

  /** 获取雷达站点列表 */
  async fetchRadarStations() {
    const resp = await fetch(RADAR_STATIONS_URL, {
      headers: { "Accept": "application/json", "User-Agent": "SkyVortex/0.1" },
    });
    if (!resp.ok) throw new Error(`NOAA Radar ${resp.status}`);
    const json = await resp.json();
    return json.features?.map(f => ({
      id: f.properties.station,
      name: f.properties.name,
      lat: f.properties.latitude,
      lon: f.properties.longitude,
      elevation: f.properties.elevation,
    })) || [];
  }

  /** 解析 GeoJSON → 飞行员可读格式 */
  _parseSigmets(geojson) {
    const sigmets = [];
    for (const feature of geojson.features || []) {
      const p = feature.properties || {};
      const phenomenon = p.phenomenon || "";
      const rawCode = phenomenon.split("/").pop() || phenomenon;
      const label = PHENOMENON_LABELS[rawCode] || rawCode || "天气现象";

      sigmets.push({
        id: p.id?.split("/").pop() || rawCode,
        fir: p.fir || "UNKNOWN",
        atsu: p.atsu || "",
        phenomenon: rawCode,
        label,
        level: classifyLevel(rawCode),
        issueTime: p.issueTime,
        startTime: p.start,
        endTime: p.end,
        geometry: feature.geometry, // GeoJSON Polygon/MultiPolygon
        raw: p,
      });
    }
    return sigmets;
  }

  /** 检查指定坐标是否在任一 SIGMET 区域内 */
  async checkPoint(lat, lon) {
    const sigmets = await this.fetchSigmets();
    const hits = [];
    for (const s of sigmets) {
      if (this._pointInPolygon(lat, lon, s.geometry)) {
        hits.push(s);
      }
    }
    return hits;
  }

  /** 点在多边形内判断（简化版，仅支持 Polygon） */
  _pointInPolygon(lat, lon, geometry) {
    if (!geometry || geometry.type !== "Polygon") return false;
    const coords = geometry.coordinates[0]; // 外环
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = coords[i][0], yi = coords[i][1];
      const xj = coords[j][0], yj = coords[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }
}

/**
 * 轻量 NOAA 数据缓存（避免频繁请求）
 * 实际部署应改用服务端缓存 + 定时拉取
 */
export class NoaaCachedProvider extends NoaaProvider {
  async fetchSigmets() {
    const key = "sigmets";
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.ts < this.cacheTTL) {
      return cached.data;
    }
    const data = await super.fetchSigmets();
    this.cache.set(key, { data, ts: Date.now() });
    return data;
  }
}
