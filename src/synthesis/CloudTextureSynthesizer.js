/**
 * CloudTextureSynthesizer — 合成层（接缝 2）
 *
 * 深度模块：调用者传入 WeatherFrame，获得 GPU 就绪的 RGBA 纹理 + 图层配置。
 * 内部隐藏：dBZ 归一化、多层映射、云顶估算、像素编码。
 *
 * 接口：
 *   synthesize(frame) → CloudTexture
 *   synthesizeToCanvas(frame, canvas) → void   // 直接绘制到 canvas（调试用）
 */

/** @import { WeatherFrame, CloudTexture, LayerConfig } from '../data/types.js' */

/** 默认三层云高度配置 */
export const DEFAULT_LAYERS = [
  { channel: 'r', altitude: 1500, height: 1500, densityScale: 0.20, coverage: 0.40, coverageFilterWidth: 0.6 },
  { channel: 'g', altitude: 3500, height: 2500, densityScale: 0.35, coverage: 0.50, coverageFilterWidth: 0.6 },
  { channel: 'b', altitude: 8000, height: 2500, densityScale: 0.05, coverage: 0.35, coverageFilterWidth: 0.5 },
  { channel: 'a' },
];

/** dBZ 归一化上限 */
const DBZ_MAX = 70;
/** 云顶归一化上限 (m) */
const TOP_MAX = 15000;

export class CloudTextureSynthesizer {
  /** @type {LayerConfig[]} */
  #layers;

  /**
   * @param {LayerConfig[]} [layers] - 自定义图层配置，默认 DEFAULT_LAYERS
   */
  constructor(layers) {
    this.#layers = layers || DEFAULT_LAYERS.map(l => ({ ...l }));
  }

  /** @returns {LayerConfig[]} 当前图层配置（副本） */
  getLayers() {
    return this.#layers.map(l => ({ ...l }));
  }

  /**
   * 将 WeatherFrame 合成为 RGBA 纹理
   *
   * 通道映射：
   *   R = cappi_1km / 70  (低层云)
   *   G = cappi_3km / 70  (中层对流核心)
   *   B = cappi_6km / 70  (高层卷云砧)
   *   A = cloudTop / 15000 (云顶高度)
   *
   * @param {WeatherFrame} frame
   * @returns {CloudTexture}
   */
  synthesize(frame) {
    const { width: w, height: h, layers } = frame;
    const rgba = new Uint8ClampedArray(w * h * 4);

    const l1 = layers.cappi_1km;
    const l3 = layers.cappi_3km;
    const l6 = layers.cappi_6km;
    const top = layers.cloudTop;

    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      rgba[p]     = clamp255((l1[i] / DBZ_MAX) * 255);
      rgba[p + 1] = clamp255((l3[i] / DBZ_MAX) * 255);
      rgba[p + 2] = clamp255((l6[i] / DBZ_MAX) * 255);

      if (top) {
        rgba[p + 3] = clamp255((top[i] / TOP_MAX) * 255);
      } else {
        // 无云顶数据时用各层 max 估算
        const mx = Math.max(l1[i], l3[i], l6[i]);
        rgba[p + 3] = clamp255((mx / DBZ_MAX) * 0.85 * 255);
      }
    }

    return {
      rgba,
      width: w,
      height: h,
      layerConfig: this.#layers.map(l => ({ ...l })),
    };
  }

  /**
   * 将合成结果绘制到 canvas（调试 / 缩略图用）
   * @param {WeatherFrame} frame
   * @param {HTMLCanvasElement} canvas
   */
  synthesizeToCanvas(frame, canvas) {
    const tex = this.synthesize(frame);
    canvas.width = tex.width;
    canvas.height = tex.height;
    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(tex.rgba, tex.width, tex.height);
    ctx.putImageData(imgData, 0, 0);
  }
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}