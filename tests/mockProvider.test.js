import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/data/MockProvider.js";

const BOUNDS = { west: 115.0, south: 39.0, east: 117.5, north: 41.0, center: [116.5, 39.8] };

describe("MockProvider", () => {
  it("相同种子输出确定性帧序列", async () => {
    const a = await new MockProvider(42).getTimeSeries(BOUNDS, "2026-07-29T00:00:00Z", 2);
    const b = await new MockProvider(42).getTimeSeries(BOUNDS, "2026-07-29T00:00:00Z", 2);
    expect(a.length).toBe(2);
    expect(a[0].layers.cappi_3km).toEqual(b[0].layers.cappi_3km);
    expect(a[1].layers.cloudTop).toEqual(b[1].layers.cloudTop);
  });

  it("帧结构符合 WeatherFrame 契约", async () => {
    const frame = await new MockProvider(42).getFrame(BOUNDS, "2026-07-29T00:00:00Z");
    expect(frame.width).toBe(256);
    expect(frame.height).toBe(256);
    expect(frame.bounds.west).toBe(115.0);
    expect(frame.timestamp).toBe("2026-07-29T00:00:00.000Z");
    for (const key of ["cappi_1km", "cappi_3km", "cappi_6km", "cloudTop"]) {
      expect(frame.layers[key]).toBeInstanceOf(Float32Array);
      expect(frame.layers[key].length).toBe(256 * 256);
    }
  });

  it("帧间隔与时间戳一致", async () => {
    const frames = await new MockProvider(42).getTimeSeries(BOUNDS, "2026-07-29T00:00:00Z", 3, 5);
    const dt = new Date(frames[1].timestamp) - new Date(frames[0].timestamp);
    expect(dt).toBe(5 * 60000);
  });

  it("包围盒裁剪后单体核心仍存在且有回波（首帧 sin(0)=0 无回波，取第 2 帧）", async () => {
    const frames = await new MockProvider(42).getTimeSeries(BOUNDS, "2026-07-29T00:00:00Z", 2, 5);
    const layer = frames[1].layers.cappi_3km;
    let maxDbz = 0;
    for (let i = 0; i < layer.length; i++) {
      maxDbz = Math.max(maxDbz, layer[i]);
    }
    expect(maxDbz).toBeGreaterThan(0);
  });

  it("生命周期中段帧有明显对流核心（>40 dBZ）", async () => {
    const frames = await new MockProvider(42).getTimeSeries(BOUNDS, "2026-07-29T00:00:00Z", 6, 5);
    const mid = frames[4].layers.cappi_3km;
    let maxDbz = 0;
    for (let i = 0; i < mid.length; i++) maxDbz = Math.max(maxDbz, mid[i]);
    expect(maxDbz).toBeGreaterThan(40);
  });
});
