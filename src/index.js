/**
 * SkyVortex — 飞行员立体天气云图引擎
 *
 * 统一出口。按深度模块分层：
 *
 *   数据层 (接缝 1)     WeatherDataProvider / MockProvider
 *   合成层 (接缝 2)     CloudTextureSynthesizer
 *   渲染层 (接缝 3)     SkyVortexEngine (→ engine-base)
 *   分析层              StormTracker / FlightPathProfiler
 *   UI 层               TimelineController
 */

// ── 数据层 ──
export { WeatherDataProvider } from "./data/WeatherDataProvider.js";
export { MockProvider } from "./data/MockProvider.js";

// ── 合成层 ──
export { CloudTextureSynthesizer, DEFAULT_LAYERS } from "./synthesis/CloudTextureSynthesizer.js";

// ── 分析层 ──
export { StormTracker } from "./analysis/StormTracker.js";
export { FlightPathProfiler } from "./analysis/FlightPathProfiler.js";

// ── UI 层 ──
export { TimelineController } from "./ui/TimelineController.js";

// ── 渲染层（依赖 Cesium 全局，按需 import）──
// SkyVortexEngine 在 ../skyvortex-engine.js，因为依赖 window.Cesium
// 不在此处 re-export，避免在无 Cesium 环境下 import 报错