import { describe, it, expect } from "vitest";
import { CloudTextureSynthesizer, DEFAULT_LAYERS } from "../src/synthesis/CloudTextureSynthesizer.js";

function makeFrame({ withTop = true } = {}) {
  const w = 4, h = 4;
  const mk = (v) => { const a = new Float32Array(w * h); a.fill(v); return a; };
  return {
    timestamp: "2026-07-29T00:00:00Z",
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    width: w, height: h,
    layers: {
      cappi_1km: mk(35),  // 35/70 → 127.5 → 127
      cappi_3km: mk(70),  // 70/70 → 255
      cappi_6km: mk(0),
      ...(withTop ? { cloudTop: mk(7500) } : {}), // 7500/15000 → 127
    },
  };
}

describe("CloudTextureSynthesizer", () => {
  it("R/G/B 通道按 dBZ/70 归一化，A 通道按 cloudTop/15000", () => {
    const tex = new CloudTextureSynthesizer().synthesize(makeFrame());
    expect(tex.width).toBe(4);
    expect(tex.height).toBe(4);
    expect(tex.rgba.length).toBe(4 * 4 * 4);
    expect(tex.rgba[0]).toBe(127); // R = 35/70*255 = 127.5 | 0
    expect(tex.rgba[1]).toBe(255); // G = 70/70*255
    expect(tex.rgba[2]).toBe(0);   // B = 0
    expect(tex.rgba[3]).toBe(127); // A = 7500/15000*255 = 127.5 | 0
  });

  it("无 cloudTop 时 A 通道用层最大值 ×0.85 估算", () => {
    const tex = new CloudTextureSynthesizer().synthesize(makeFrame({ withTop: false }));
    // max(35,70,0)=70 → 70/70*0.85*255 = 216.75 | 0 = 216
    expect(tex.rgba[3]).toBe(216);
  });

  it("超范围 dBZ 值被钳制到 0-255", () => {
    const frame = makeFrame();
    frame.layers.cappi_3km.fill(140); // 2× 上限
    const tex = new CloudTextureSynthesizer().synthesize(frame);
    expect(tex.rgba[1]).toBe(255);
  });

  it("layerConfig 返回副本且默认含 4 层通道映射", () => {
    const synth = new CloudTextureSynthesizer();
    const tex = synth.synthesize(makeFrame());
    expect(tex.layerConfig.map(l => l.channel)).toEqual(["r", "g", "b", "a"]);
    tex.layerConfig[0].altitude = 999;
    expect(DEFAULT_LAYERS[0].altitude).toBe(1500); // 不影响默认配置
  });
});
