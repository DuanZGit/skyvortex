import { describe, it, expect } from "vitest";
import { FlightPathProfiler } from "../src/analysis/FlightPathProfiler.js";

const BOUNDS = { west: 100, south: 30, east: 102, north: 32 };

function makeFrame() {
  const w = 64, h = 64;
  const mk = (v) => {
    const a = new Float32Array(w * h);
    a.fill(v);
    return a;
  };
  return {
    timestamp: "2026-07-29T00:00:00Z",
    bounds: BOUNDS,
    width: w, height: h,
    layers: { cappi_1km: mk(10), cappi_3km: mk(35), cappi_6km: mk(20), cloudTop: mk(9000) },
  };
}

describe("FlightPathProfiler", () => {
  it("未设航线时 getProfile 抛错", () => {
    expect(() => new FlightPathProfiler().getProfile(makeFrame())).toThrow(/No flight path/);
  });

  it("hasPath 需要至少 2 个航点", () => {
    const p = new FlightPathProfiler();
    p.setPath([{ lon: 100.5, lat: 30.5 }]);
    expect(p.hasPath()).toBe(false);
    p.setPath([{ lon: 100.5, lat: 30.5 }, { lon: 101.5, lat: 31.5 }]);
    expect(p.hasPath()).toBe(true);
  });

  it("输出 sampleCount×3 扁平数组，高度层固定 1/3/6km", () => {
    const p = new FlightPathProfiler();
    p.setPath([{ lon: 100.5, lat: 31 }, { lon: 101.5, lat: 31 }]);
    const prof = p.getProfile(makeFrame());

    // 100.5→101.5 经度 @31°N ≈ 95 km
    expect(prof.distanceKm).toBeGreaterThan(90);
    expect(prof.distanceKm).toBeLessThan(100);
    expect(prof.sampleCount).toBe(Math.max(2, Math.ceil(prof.distanceKm / 2)));
    expect(prof.heights.length).toBe(prof.sampleCount * 3);
    expect(prof.dbz.length).toBe(prof.sampleCount * 3);
    expect(prof.distances.length).toBe(prof.sampleCount);

    // 每个采样点三层高度与 dbz（均匀场：10/35/20）
    for (let si = 0; si < prof.sampleCount; si++) {
      expect(prof.heights[si * 3]).toBe(1000);
      expect(prof.heights[si * 3 + 1]).toBe(3000);
      expect(prof.heights[si * 3 + 2]).toBe(6000);
      expect(prof.dbz[si * 3]).toBe(10);
      expect(prof.dbz[si * 3 + 1]).toBe(35);
      expect(prof.dbz[si * 3 + 2]).toBe(20);
    }

    // distances 单调递增且首尾正确
    expect(prof.distances[0]).toBe(0);
    expect(prof.distances[prof.sampleCount - 1]).toBeCloseTo(prof.distanceKm, 0);
  });

  it("航点在帧边界外时钳制到边缘像素而不越界", () => {
    const p = new FlightPathProfiler();
    p.setPath([{ lon: 99, lat: 29 }, { lon: 103, lat: 33 }]); // 两端都出界
    const prof = p.getProfile(makeFrame());
    for (let i = 0; i < prof.dbz.length; i++) {
      expect(Number.isFinite(prof.dbz[i])).toBe(true);
    }
  });
});
