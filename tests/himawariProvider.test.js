import { describe, it, expect } from "vitest";
import {
  lonLatToDiskPixel, alphaToDbz, alphaToCloudTop, alignToSlot, slotToPath,
} from "../src/data/HimawariProvider.js";

// 5500px 标准网格基准点（实测验证：ASCII 圆盘图上北京/东京/悉尼/广州标记位置正确）
const FULL = 5500;

describe("HimawariProvider · GEOS 投影", () => {
  it("星下点（140.7E, 0N）投影到圆盘中心", () => {
    const p = lonLatToDiskPixel(140.7, 0, FULL);
    expect(p.px).toBeCloseTo(2750.5, 0);
    expect(p.py).toBeCloseTo(2750.5, 0);
  });

  it("北京在圆盘西北象限（已实测基准：约 1794, 829 @5500px）", () => {
    const p = lonLatToDiskPixel(116.4, 39.9, FULL);
    expect(p.px).toBeGreaterThan(1700);
    expect(p.px).toBeLessThan(1900);
    expect(p.py).toBeGreaterThan(750);
    expect(p.py).toBeLessThan(900);
    // 西北象限：x/y 均小于中心
    expect(p.px).toBeLessThan(2750.5);
    expect(p.py).toBeLessThan(2750.5);
  });

  it("悉尼在圆盘东南象限", () => {
    const p = lonLatToDiskPixel(151.2, -33.9, FULL);
    expect(p.px).toBeGreaterThan(2750.5);
    expect(p.py).toBeGreaterThan(2750.5);
  });

  it("地球背面（如 60W）不可见，返回 null", () => {
    expect(lonLatToDiskPixel(-60, 0, FULL)).toBeNull();
    expect(lonLatToDiskPixel(320.7, 0, FULL)).toBeNull();
  });

  it("像素坐标随 fullPx 线性缩放", () => {
    const a = lonLatToDiskPixel(116.4, 39.9, 5500);
    const b = lonLatToDiskPixel(116.4, 39.9, 2200); // 4d 级别
    expect(b.px).toBeCloseTo(a.px * 2200 / 5500, 5);
    expect(b.py).toBeCloseTo(a.py * 2200 / 5500, 5);
  });
});

describe("HimawariProvider · IR alpha 反演", () => {
  it("alpha=0（无云）→ 0 dBZ、0 云顶", () => {
    expect(alphaToDbz(0)).toBe(0);
    expect(alphaToCloudTop(0)).toBe(0);
  });

  it("薄云/暖云（低 alpha）不产生降水回波", () => {
    expect(alphaToDbz(20)).toBe(0); // 20/223 ≈ 0.09 < 0.15 地板
    expect(alphaToCloudTop(20)).toBeGreaterThan(0); // 但云顶仍有值
  });

  it("最冷云顶（alpha=223）→ 满值 52 dBZ、14km 云顶", () => {
    expect(alphaToDbz(223)).toBeCloseTo(52, 5);
    expect(alphaToCloudTop(223)).toBeCloseTo(14000, 5);
  });

  it("alpha 超出动态范围时 clamp（不溢出）", () => {
    expect(alphaToDbz(255)).toBeCloseTo(52, 5);
    expect(alphaToCloudTop(255)).toBeCloseTo(14000, 5);
  });

  it("映射单调递增（对流越强回波越强）", () => {
    let prev = -1;
    for (let a = 0; a <= 255; a += 16) {
      const dbz = alphaToDbz(a);
      expect(dbz).toBeGreaterThanOrEqual(prev);
      prev = dbz;
    }
  });
});

describe("HimawariProvider · 卫星槽位时间", () => {
  it("任意时刻向下对齐到 10 分钟槽位", () => {
    const t = alignToSlot(new Date("2026-07-29T09:27:43Z"));
    expect(t.toISOString()).toBe("2026-07-29T09:20:00.000Z");
  });

  it("整 10 分钟时刻保持不变", () => {
    const t = alignToSlot(new Date("2026-07-29T09:20:00Z"));
    expect(t.toISOString()).toBe("2026-07-29T09:20:00.000Z");
  });

  it("槽位 → NICT URL 路径（UTC，跨日正确）", () => {
    expect(slotToPath(new Date("2026-07-29T09:20:00Z"))).toBe("2026/07/29/092000");
    expect(slotToPath(new Date("2026-01-05T00:00:00Z"))).toBe("2026/01/05/000000");
  });
});
