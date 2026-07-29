/**
 * 移动端性能优化配置
 */
import { PERFORMANCE_PRESETS } from "./src/performance/PerformanceAdapter.js";
export { detectDevicePerformance, getRecommendedPreset } from "./src/performance/PerformanceAdapter.js";

/**
 * SkyVortex Engine
 *
 * 面向飞行员的 3D 立体天气云图引擎。
 * 基于 cesium-clouds-atmosphere（MIT）的体积云渲染能力，
 * 注入真实雷达 CAPPI 数据作为云体密度场。
 *
 * 通道映射约定（与 cappi_to_weather.py 保持一致）：
 *   R = CAPPI 1km 反射率  →  低层云（层状云、积云）
 *   G = CAPPI 3km 反射率  →  中层云（对流核心，强回波）
 *   B = CAPPI 6km 反射率  →  高层云（卷云砧部）
 *   A = 云顶高度场        →  通道 A（保留）
 *
 * 默认云层海拔（米）映射到三层云，对应典型雷暴结构：
 *   Layer R:  altitude=1500, height=1500   1km CAPPI 主体
 *   Layer G:  altitude=3500, height=2500   3km CAPPI（对流核心）覆盖最广
 *   Layer B:  altitude=8000, height=2500   6km CAPPI（卷云砧）
 */

import {
  createCloudAtmosphere,
  LensFlareBloomStage,
  AtmosphereParameters,
} from "./engine-base/src/index.js";
import { DEFAULT_LAYERS as SYNTH_DEFAULT_LAYERS } from "./src/synthesis/CloudTextureSynthesizer.js";

const Cesium = window.Cesium;

/** 默认云层高度配置（米）—— 与合成层 DEFAULT_LAYERS 单一来源，避免双处维护漂移 */
const DEFAULT_LAYERS = SYNTH_DEFAULT_LAYERS;

export class SkyVortexEngine {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {object} [opts]
   * @param {string} [opts.weatherTextureUrl] - 4 通道 PNG URL
   * @param {object[]} [opts.layers] - 自定义云层高度配置
   * @param {AtmosphereParameters} [opts.atmosphereParams]
      * @param {boolean} [opts.showGui] - 是否显示 dat.gui 调参面板
   * @param {number} [opts.weatherRepeat] - 纹理重复倍数
   */
  constructor(viewer, opts = {}) {
    this.viewer = viewer;
    this.opts = opts;
    this.pipeline = null;
    this.lensFlare = null;
    this.gui = null;
  }

  /**
   * 初始化：加载云 + 大气 + 空中透视管线
   */
  async init() {
    const atmos = this.opts.atmosphereParams || new AtmosphereParameters();

    // 透传所有资产路径覆盖项
    const assetOverrides = {};
    for (const key of [
      "cloudsAssetsBase", "atmosphereAssetsBase", "atmosphereShaderBase",
      "brunetonShaderBase", "blueNoiseUrl",
    ]) {
      if (this.opts[key]) assetOverrides[key] = this.opts[key];
    }

    this.pipeline = await createCloudAtmosphere(this.viewer, {
      assets: { mode: "local" },
      atmosphereParams: atmos,
      showGui: !!this.opts.showGui, // pipeline 内置调参面板与引擎 GUI 同开关
      ...assetOverrides,
    });

    // 应用 SkyVortex 默认云层高度
    this.applyLayers(this.opts.layers || DEFAULT_LAYERS);

    // 自动检测并应用性能配置
    this._applyPerformancePreset(this.opts.performance);

    // 应用自定义 weather 纹理（如果提供）
    if (this.opts.weatherTextureUrl) {
      await this.swapWeatherTexture(this.opts.weatherTextureUrl);
    }

    // 镜头光晕
    this.lensFlare = new LensFlareBloomStage(this.viewer, {
      bloomIntensity: 0.6,
      ghostIntensity: 1.1,
      haloIntensity: 0.2,
    });
    this.lensFlare.init();

    if (this.opts.showGui) {
      await this._setupGui();
    }

    return this;
  }

  /**
   * 从合成层输出直接创建 Cesium 纹理（无 PNG/blob 编解码往返）
   * @param {{rgba: Uint8ClampedArray, width: number, height: number}} tex
   * @returns {Cesium.Texture}
   */
  createWeatherTexture(tex) {
    const canvas = document.createElement("canvas");
    canvas.width = tex.width;
    canvas.height = tex.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(new ImageData(tex.rgba, tex.width, tex.height), 0, 0);
    return new Cesium.Texture({
      context: this.viewer.scene.context,
      source: canvas,
      sampler: new Cesium.Sampler({
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        wrapS: Cesium.TextureWrap.REPEAT, wrapT: Cesium.TextureWrap.REPEAT,
      }),
    });
  }

  /**
   * 安装 weather 纹理。textures 对象与云影 pass 共享引用，替换后自动生效。
   * @param {Cesium.Texture} newTex
   * @param {{destroyOld?: boolean}} [opts] - destroyOld=false 时旧纹理归调用方管理（外部帧缓存场景）
   * @returns {Cesium.Texture|undefined} 被替下的旧纹理
   */
  setWeatherTexture(newTex, { destroyOld = true } = {}) {
    if (!this.pipeline) throw new Error("Engine not initialized");
    const old = this.pipeline.textures.weather;
    this.pipeline.textures.weather = newTex;
    if (this.pipeline._renderState) {
      this.pipeline._renderState.weather = newTex;
    }
    if (old && old !== newTex && destroyOld) {
      this._destroyTextureDeferred(old);
    }
    return old;
  }

  /** 延迟到下一帧渲染后销毁，避免销毁仍被当前帧引用的纹理 */
  _destroyTextureDeferred(tex) {
    const remove = this.viewer.scene.postRender.addEventListener(() => {
      remove();
      try { tex.destroy?.(); } catch (e) { /* ignore */ }
    });
  }

  /**
   * 推荐路径：直接用合成层输出替换 weather 纹理
   * @param {{rgba: Uint8ClampedArray, width: number, height: number}} tex
   */
  swapWeatherTextureFromData(tex) {
    const newTex = this.createWeatherTexture(tex);
    this.setWeatherTexture(newTex, { destroyOld: true });
    return newTex;
  }

  /**
   * 替换 4 通道 weather 纹理（PNG URL 兼容路径）
   * @param {string} url - 新 PNG 的 URL
   */
  async swapWeatherTexture(url) {
    if (!this.pipeline) throw new Error("Engine not initialized");
    const resp = await fetch(url);
    const blob = await resp.blob();

    // 使用 createImageBitmap + HTMLCanvasElement，绕过 headless 浏览器 blob URL 限制
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const newTex = new Cesium.Texture({
      context: this.viewer.scene.context, source: canvas,
      sampler: new Cesium.Sampler({
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        wrapS: Cesium.TextureWrap.REPEAT, wrapT: Cesium.TextureWrap.REPEAT,
      }),
    });
    this.setWeatherTexture(newTex, { destroyOld: true });
    console.log(`[SkyVortex] weather texture swapped → ${url}`);
  }

  /**
   * 应用云层高度配置
   */
  applyLayers(layers) {
    if (!this.pipeline) return;
    for (let i = 0; i < layers.length; i++) {
      Object.assign(this.pipeline.params.layers[i], layers[i]);
    }
  }

  /**
   * 设置全局云可见性
   */
  setCloudsVisible(v) {
    this.pipeline.params.cloudsVisible = v;
  }

  /**
   * 飞行视角：设到云层上方俯视
   */
  setPilotView(lon, lat, alt = 12000, heading = 0, pitch = -Math.PI/3) {
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation: { heading, pitch, roll: 0 },
    });
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this.gui) this.gui.destroy();
    if (this.lensFlare) this.lensFlare.destroy?.();
    if (this.pipeline) this.pipeline.destroy?.();
  }

  async _setupGui() {
    // dat.gui 仅在 showGui 时按需加载，避免非调试场景多一份 bundle；加载失败仅降级无 GUI
    let dat;
    try {
      dat = await import("dat.gui");
    } catch (e) {
      console.warn("[SkyVortex] dat.gui 加载失败，跳过调参面板", e);
      return;
    }
    this.gui = new dat.GUI({ width: 280 });
    this.gui.domElement.style.zIndex = "999";

    const f = this.gui.addFolder("SkyVortex · Cloud Layers");
    f.add(this.pipeline.params.layers[0], "altitude", 500, 10000, 100).name("低层云高度");
    f.add(this.pipeline.params.layers[0], "height", 100, 5000, 50).name("低层云厚度");
    f.add(this.pipeline.params.layers[0], "coverage", 0, 1, 0.01).name("低层覆盖度");

    f.add(this.pipeline.params.layers[1], "altitude", 500, 12000, 100).name("中层云高度");
    f.add(this.pipeline.params.layers[1], "height", 100, 8000, 50).name("中层云厚度");
    f.add(this.pipeline.params.layers[1], "coverage", 0, 1, 0.01).name("中层覆盖度");

    f.add(this.pipeline.params.layers[2], "altitude", 5000, 15000, 100).name("高层云高度");
    f.add(this.pipeline.params.layers[2], "height", 100, 5000, 50).name("高层云厚度");
    f.add(this.pipeline.params.layers[2], "coverage", 0, 1, 0.01).name("高层覆盖度");
    f.open();
  }

  /**
   * 设置性能配置档位
   * @param {string|object} preset - 档位名 (high/medium/low/ultra) 或配置对象
   */
  setPerformancePreset(preset) {
    if (!this.pipeline) return;
    const p = this.pipeline.params;

    if (typeof preset === "string") {
      preset = PERFORMANCE_PRESETS[preset] || PERFORMANCE_PRESETS.medium;
    }

    // 应用到 shader uniforms
    p.maxSteps = preset.maxSteps;
    p.maxStepsToSun = preset.maxStepsToSun;
    p.minStepSize = preset.minStepSize;
    p.maxStepSize = preset.maxStepSize;
    p.minSecondaryStepSize = preset.minSecondaryStepSize;
    p.secondaryStepScale = preset.secondaryStepScale;
    p.multiScatteringOctaves = preset.multiScatteringOctaves;

    // 渲染分辨率缩放（raymarch 像素数随之下降，移动端收益最大）
    if (preset.resolutionScale !== undefined && this.viewer) {
      this.viewer.resolutionScale = preset.resolutionScale;
    }

    // BSM 云影 pass 的步进参数烘焙在 shader 源码里，需重建 program
    const shadowPass = this.pipeline._bsm?.pass;
    shadowPass?.setQuality?.({
      maxSteps: preset.maxSteps,
      minStepSize: preset.minStepSize,
      maxStepSize: preset.maxStepSize,
    });

    console.log(`[SkyVortex] performance preset applied:`, preset.label || preset);
    return this;
  }

  /**
   * 自动检测设备性能并应用推荐配置
   * @param {string|object} [userPreset] - 用户指定的配置
   */
  async _applyPerformancePreset(userPreset) {
    if (userPreset) {
      this.setPerformancePreset(userPreset);
      return;
    }
    // 自动检测
    try {
      const { getRecommendedPreset } = await import("./src/performance/PerformanceAdapter.js");
      const preset = getRecommendedPreset();
      this.setPerformancePreset(preset);
    } catch (e) {
      console.warn("[SkyVortex] performance detection failed:", e);
    }
  }
}

export { DEFAULT_LAYERS };