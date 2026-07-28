/**
 * PerformanceAdapter — 移动端性能优化配置
 *
 * 根据设备类型自动调整渲染参数，在移动端降低 raymarching 质量
 * 以换取帧率和电池续航。
 */

// 性能配置档位
export const PERFORMANCE_PRESETS = {
  high: {
    label: "高 (桌面)",
    maxSteps: 500,
    maxStepsToSun: 8,
    minStepSize: 20.0,
    maxStepSize: 1000.0,
    minSecondaryStepSize: 100.0,
    secondaryStepScale: 2.0,
    multiScatteringOctaves: 8,
    resolutionScale: 1.0,
  },
  medium: {
    label: "中 (平板/高性能手机)",
    maxSteps: 300,
    maxStepsToSun: 6,
    minStepSize: 30.0,
    maxStepSize: 1000.0,
    minSecondaryStepSize: 150.0,
    secondaryStepScale: 2.5,
    multiScatteringOctaves: 6,
    resolutionScale: 0.75,
  },
  low: {
    label: "低 (普通手机)",
    maxSteps: 200,
    maxStepsToSun: 4,
    minStepSize: 40.0,
    maxStepSize: 1500.0,
    minSecondaryStepSize: 200.0,
    secondaryStepScale: 3.0,
    multiScatteringOctaves: 4,
    resolutionScale: 0.5,
  },
  ultra: {
    label: "极低 (老旧设备)",
    maxSteps: 100,
    maxStepsToSun: 3,
    minStepSize: 60.0,
    maxStepSize: 2000.0,
    minSecondaryStepSize: 300.0,
    secondaryStepScale: 4.0,
    multiScatteringOctaves: 2,
    resolutionScale: 0.4,
  },
};

/**
 * 检测设备类型并返回推荐配置
 */
export function detectDevicePerformance() {
  const ua = navigator.userAgent || "";
  const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(ua);
  const isIPad = /iPad|Macintosh/.test(ua) && "ontouchend" in document;
  const isAndroid = /Android/i.test(ua);
  const isIPhone = /iPhone|iPod/i.test(ua);
  
  // 获取 GPU 信息（如果可用）
  let gpuTier = "unknown";
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
        // 检测集成显卡 / 低功耗 GPU
        if (/Mali|Adreno [1-5][0-9][0-9]|Intel HD|PowerVR/i.test(renderer)) {
          gpuTier = "low";
        } else if (/NVIDIA|AMD|Adreno [6-9][0-9][0-9]|Apple GPU/i.test(renderer)) {
          gpuTier = "high";
        }
      }
      const maxTexture = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      if (maxTexture && maxTexture < 512) gpuTier = "low";
    }
  } catch (e) {
    // WebGL2 不可用，默认为低端
    gpuTier = "low";
  }

  // 综合判断
  if (isIPhone || (isAndroid && gpuTier === "low")) {
    return "ultra";
  } else if (isMobile || isIPad) {
    return gpuTier === "high" ? "medium" : "low";
  } else {
    return "high";
  }
}

/**
 * 获取推荐性能配置
 */
export function getRecommendedPreset() {
  const tier = detectDevicePerformance();
  return PERFORMANCE_PRESETS[tier];
}
