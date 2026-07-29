import { describe, it, expect } from "vitest";
import { StormTracker } from "../src/analysis/StormTracker.js";

const BOUNDS = { west: 100, south: 30, east: 102, north: 32 };

/** 构造 64×64 测试帧，在 (cx, cy) 像素处放一个 radius 半径的方形回波块 */
function makeFrame(timestamp, blobs) {
  const w = 64, h = 64;
  const cappi3 = new Float32Array(w * h);
  const cloudTop = new Float32Array(w * h);
  for (const { cx, cy, radius, dbz, top } of blobs) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        cappi3[i] = dbz;
        cloudTop[i] = top ?? 12000;
      }
    }
  }
  return {
    timestamp,
    bounds: BOUNDS,
    width: w, height: h,
    layers: {
      cappi_1km: new Float32Array(w * h),
      cappi_3km: cappi3,
      cappi_6km: new Float32Array(w * h),
      cloudTop,
    },
  };
}

describe("StormTracker.detect", () => {
  it("识别超过阈值的连通域并计算质心/强度/等级", () => {
    const frame = makeFrame("2026-07-29T00:00:00Z", [
      { cx: 20, cy: 20, radius: 4, dbz: 50 },
    ]);
    const storms = new StormTracker().detect(frame);
    expect(storms).toHaveLength(1);
    const s = storms[0];
    expect(s.dbz).toBe(50);
    expect(s.level).toBe("danger");
    expect(s.topHeight).toBe(12000);
    // 质心：像素 (20,20) → lon = west + (20+0.5)*(2/64)
    expect(s.lon).toBeCloseTo(100 + 20.5 * (2 / 64), 1);
    expect(s.lat).toBeCloseTo(30 + 20.5 * (2 / 64), 1);
  });

  it("过滤小于 MIN_AREA_PX 的噪声块", () => {
    const frame = makeFrame("2026-07-29T00:00:00Z", [
      { cx: 10, cy: 10, radius: 1, dbz: 60 }, // 9 px < 20
    ]);
    expect(new StormTracker().detect(frame)).toHaveLength(0);
  });

  it("低于 25 dBZ 阈值的区域不识别", () => {
    const frame = makeFrame("2026-07-29T00:00:00Z", [
      { cx: 30, cy: 30, radius: 5, dbz: 20 },
    ]);
    expect(new StormTracker().detect(frame)).toHaveLength(0);
  });
});

describe("StormTracker.track", () => {
  it("跨帧关联并按实际帧间隔（10min）估算移速与外推", () => {
    const f0 = makeFrame("2026-07-29T00:00:00Z", [{ cx: 20, cy: 20, radius: 4, dbz: 50 }]);
    const f1 = makeFrame("2026-07-29T00:10:00Z", [{ cx: 24, cy: 20, radius: 4, dbz: 52 }]);
    const tracks = new StormTracker().track([f0, f1]);
    expect(tracks).toHaveLength(1);
    const t = tracks[0];
    expect(t.history).toHaveLength(2);
    expect(t.storm.driftSpeed).toBeGreaterThan(0);
    // 外推按 30/10=3 步，每步 10 分钟
    expect(t.forecast).toHaveLength(3);
    const dt = new Date(t.forecast[0].time) - new Date(t.history[1].time);
    expect(dt).toBe(10 * 60000);
  });

  it("超出 0.5 度匹配半径的单体开新轨迹", () => {
    const f0 = makeFrame("2026-07-29T00:00:00Z", [{ cx: 8, cy: 8, radius: 4, dbz: 50 }]);
    const f1 = makeFrame("2026-07-29T00:05:00Z", [{ cx: 56, cy: 56, radius: 4, dbz: 50 }]);
    const tracks = new StormTracker().track([f0, f1]);
    expect(tracks).toHaveLength(2);
  });

  it("空输入返回空数组", () => {
    expect(new StormTracker().track([])).toEqual([]);
  });
});
