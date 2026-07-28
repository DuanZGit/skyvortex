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
import dat from "./engine-base/node_modules/dat.gui/build/dat.gui.module.js";

const Cesium = window.Cesium;

/** 默认云层高度配置（米） */
const DEFAULT_LAYERS = [
  { channel: 'r', altitude: 1500, height: 1500, densityScale: 0.20,
    coverage: 0.4, coverageFilterWidth: 0.6 },
  { channel: 'g', altitude: 3500, height: 2500, densityScale: 0.35,
    coverage: 0.5, coverageFilterWidth: 0.6 },
  { channel: 'b', altitude: 8000, height: 2500, densityScale: 0.05,
    coverage: 0.35, coverageFilterWidth: 0.5 },
  { channel: 'a' }
];

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
      ...assetOverrides,
    });

    // 应用 SkyVortex 默认云层高度
    this.applyLayers(this.opts.layers || DEFAULT_LAYERS);

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
   * 替换 4 通道 weather 纹理（接入新一帧雷达数据）
   * @param {string} url - 新 PNG 的 URL
   */
  async swapWeatherTexture(url) {
    if (!this.pipeline) throw new Error("Engine not initialized");
    const newTex = await this.pipeline._load2DTexture(url);
    if (!newTex) throw new Error(`Failed to load weather texture: ${url}`);

    const old = this.pipeline.textures.weather;
    this.pipeline.textures.weather = newTex;

    // 同步到 shader uniform（_renderTexture 重设）
    if (this.pipeline._renderState) {
      this.pipeline._renderState.weather = newTex;
    }
    // 同时同步 BSM pass（如果存在）
    if (this.pipeline.shadowPass?.params) {
      // BSM 内部缓存 weather 纹理引用，需重新解析
      this.pipeline.shadowPass.params.weatherTexture = newTex;
    }

    if (old && old.destroy) {
      try { old.destroy(); } catch (e) { /* ignore */ }
    }
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
}

export { DEFAULT_LAYERS };