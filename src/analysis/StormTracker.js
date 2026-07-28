/**
 * StormTracker — 雷暴单体识别与追踪
 *
 * 深度模块：调用者传入 WeatherFrame（或序列），获得识别出的单体列表（或轨迹）。
 * 内部隐藏：连通域标记、质心计算、强度统计、移速估算、生命周期分类。
 *
 * 接口：
 *   detect(frame) → Storm[]
 *   track(frames) → StormTrack[]
 */

/** @import { WeatherFrame, Storm, StormTrack } from '../data/types.js' */

/** 反射率阈值 (dBZ)，超过此值视为对流 */
const DBZ_THRESHOLD = 25;
/** 最小单体面积（像素），低于此值视为噪声 */
const MIN_AREA_PX = 20;

export class StormTracker {
  /**
   * 从单帧中识别雷暴单体
   * @param {WeatherFrame} frame
   * @returns {Storm[]}
   */
  detect(frame) {
    const { width: w, height: h, layers, bounds } = frame;
    // 用 3km CAPPI 作为主检测层（对流核心最明显）
    const data = layers.cappi_3km;
    const top = layers.cloudTop;

    // 1. 二值化
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      mask[i] = data[i] >= DBZ_THRESHOLD ? 1 : 0;
    }

    // 2. 连通域标记 (flood fill, 4-邻域)
    const labels = new Int32Array(w * h).fill(-1);
    let labelCount = 0;
    const stack = [];

    for (let i = 0; i < w * h; i++) {
      if (mask[i] === 1 && labels[i] === -1) {
        // BFS flood fill
        labels[i] = labelCount;
        stack.push(i);
        while (stack.length > 0) {
          const cur = stack.pop();
          const cx = cur % w, cy = (cur / w) | 0;
          const neighbors = [
            cy > 0 ? cur - w : -1,
            cy < h - 1 ? cur + w : -1,
            cx > 0 ? cur - 1 : -1,
            cx < w - 1 ? cur + 1 : -1,
          ];
          for (const n of neighbors) {
            if (n >= 0 && mask[n] === 1 && labels[n] === -1) {
              labels[n] = labelCount;
              stack.push(n);
            }
          }
        }
        labelCount++;
      }
    }

    // 3. 统计每个连通域
    /** @type {Map<number, {sumX:number, sumY:number, sumDbz:number, maxDbz:number, maxTop:number, count:number}>} */
    const stats = new Map();
    for (let i = 0; i < w * h; i++) {
      const lb = labels[i];
      if (lb < 0) continue;
      if (!stats.has(lb)) stats.set(lb, { sumX: 0, sumY: 0, sumDbz: 0, maxDbz: 0, maxTop: 0, count: 0 });
      const s = stats.get(lb);
      const x = i % w, y = (i / w) | 0;
      s.sumX += x; s.sumY += y;
      s.sumDbz += data[i];
      s.maxDbz = Math.max(s.maxDbz, data[i]);
      if (top) s.maxTop = Math.max(s.maxTop, top[i]);
      s.count++;
    }

    // 4. 过滤 + 转换为 Storm
    const lonStep = (bounds.east - bounds.west) / w;
    const latStep = (bounds.north - bounds.south) / h;
    const storms = [];
    let idx = 1;

    for (const [, s] of stats) {
      if (s.count < MIN_AREA_PX) continue;
      const cx = s.sumX / s.count;
      const cy = s.sumY / s.count;
      const lon = bounds.west + (cx + 0.5) * lonStep;
      const lat = bounds.south + (cy + 0.5) * latStep;
      const dbz = s.maxDbz;

      storms.push({
        id: `CB-${String(idx++).padStart(2, "0")}`,
        lon: round3(lon),
        lat: round3(lat),
        dbz: round1(dbz),
        topHeight: Math.round(s.maxTop),
        level: dbz > 45 ? "danger" : dbz > 30 ? "warn" : "safe",
      });
    }

    // 按强度降序
    storms.sort((a, b) => b.dbz - a.dbz);
    return storms;
  }

  /**
   * 跨帧追踪单体，估算移速和外推
   * @param {WeatherFrame[]} frames - 时间序列（按时间升序）
   * @returns {StormTrack[]}
   */
  track(frames) {
    if (frames.length === 0) return [];

    // 简化版：对每帧做 detect，然后用最近邻匹配跨帧关联
    const detections = frames.map(f => ({ time: f.timestamp, storms: this.detect(f) }));
    const tracks = [];
    const active = new Map(); // id → StormTrack

    for (const det of detections) {
      const matched = new Set();

      for (const storm of det.storms) {
        // 找最近的已有轨迹
        let bestId = null, bestDist = Infinity;
        for (const [id, track] of active) {
          const last = track.history[track.history.length - 1];
          const d = Math.hypot(storm.lon - last.lon, storm.lat - last.lat);
          if (d < bestDist && d < 0.5) { // 0.5 度匹配半径
            bestDist = d;
            bestId = id;
          }
        }

        if (bestId !== null) {
          const track = active.get(bestId);
          track.history.push({ time: det.time, lon: storm.lon, lat: storm.lat });
          track.storm = storm;
          matched.add(bestId);
        } else {
          // 新轨迹
          const id = storm.id;
          active.set(id, {
            storm,
            history: [{ time: det.time, lon: storm.lon, lat: storm.lat }],
            forecast: [],
          });
        }
      }
    }

    // 对每条轨迹做线性外推（30 min）
    for (const [, track] of active) {
      const hist = track.history;
      if (hist.length >= 2) {
        const last = hist[hist.length - 1];
        const prev = hist[hist.length - 2];
        const dLon = last.lon - prev.lon;
        const dLat = last.lat - prev.lat;
        // 假设帧间隔 5 min，外推 6 步 = 30 min
        for (let i = 1; i <= 6; i++) {
          track.forecast.push({
            time: new Date(new Date(last.time).getTime() + i * 5 * 60000).toISOString(),
            lon: round3(last.lon + dLon * i),
            lat: round3(last.lat + dLat * i),
          });
        }
        // 估算移速
        const dtH = 5 / 60; // 小时
        const distKm = Math.hypot(dLon * 111 * Math.cos(last.lat * Math.PI / 180), dLat * 111);
        track.storm.driftSpeed = Math.round(distKm / dtH);
        track.storm.driftDir = Math.round((Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360);
      }
      tracks.push(track);
    }

    return tracks;
  }
}

function round3(v) { return Math.round(v * 1000) / 1000; }
function round1(v) { return Math.round(v * 10) / 10; }