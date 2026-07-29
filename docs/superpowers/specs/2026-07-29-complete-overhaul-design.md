# SkyVortex 完整体开发设计（修复 + 性能 + 功能接通 + 工程化）

> 2026-07-29 · 已获用户确认：全面整治，开发到完整体

## 背景

调查发现（详见"现状问题清单"）：最近提交 `7e1c10c` 误删了 `demo/main.js` 的整个定义段，
应用当前无法运行；性能档位的 `resolutionScale` 是死代码；时间轴每帧走
"CPU 合成 → PNG 编码 → fetch 解码 → GPU 上传"重型链路；航线 Tab 是纯 `Math.random`
假数据而 `FlightPathProfiler` 已写完零接入；`StormTracker.track()` 已实现但未启用。

## 目标

飞行员 MVP 完整体：三维雷暴云体 + 时间轴丝滑回放 + 真实单体识别/追踪/移速 +
航线垂直剖面可视化 + 真实机场天气 + SIGMET 警告 + 真正生效的性能档位 + 测试与构建。

## 范围边界

- **包含**：demo/main.js 重写、渲染性能优化、FlightPathProfiler / StormTracker.track /
  TimelineController 全接通、Open-Meteo 真实机场天气、一致性清理、Vitest 单测、build 脚本。
- **不包含**（数据可得性限制，非代码问题）：T2 真实 CAPPI 雷达接入、T5 风云四号 IR
  云顶反演（均需外部数据源权限，适配器接口已预留）；Capacitor 移动端打包。
- 体积云数据源仍为 MockProvider 合成雷暴（含生命周期演变），接缝 1 接口不变。

## 现状问题清单（调查结论）

1. 【致命】`demo/main.js` 缺失定义段（`REGIONS`/`provider`/`synth`/`stormTracker`/`viewer`/
   `engine`/`toast`/`setStatus`/`textureToBlobUrl`/`initCesiumWithTimeout`/`createFallbackMap`
   等），ES Module 严格模式必抛 ReferenceError；启动块与事件绑定各写两遍（引擎双重初始化、
   滑块一次输入两次纹理切换）。定义在上一提交 `88d89c3` 中存在，可恢复。
2. 【性能】每次 seek：合成 → PNG 编码 → blob URL → fetch 解码 → 新建纹理；blob URL 5 秒
   定时回收有竞态。
3. 【性能】`setPerformancePreset` 的 resolutionScale 分支是空循环死代码。
4. 【性能】云影 pass 的 maxSteps/minStepSize 烘焙进 shader 字符串，切档无效。
5. 【性能】`getSigmetsForRegion` 最多 5 次串行全量 fetch；`NoaaCachedProvider` 存在但无人用。
6. 【假数据】航线 Tab 温度/风/METAR 全部 `Math.random`；`FlightPathProfiler` 零接入。
7. 【半成品】demo 只调 `StormTracker.detect` 不调 `track`，移速永远 `--`；`track()` 的
   `matched` 集合是死代码；外推硬编码 5 分钟间隔。
8. 【半成品】播放循环用自建 `setInterval(800ms)` 架空 `TimelineController`。
9. 【重复】`DEFAULT_LAYERS` 在 engine / Synthesizer / Python 管线三处重复；
   `layerConfig`（接缝 2 契约）从未传入引擎。
10. 【工程化】零测试、无 build/preview 脚本、`python3` 在 Windows 不可用；
    `types.js` 的 `VerticalProfile` 契约与实现不符；接缝编号漂移（文档说 4 条，代码注释
    出现"接缝 5/6"）。

## 设计

### 1. 总体原则

- 模块分层不变（数据 → 合成 → 渲染 → UI + 独立分析），本次让代码兑现架构承诺。
- engine-base 只做一处外科手术（云影 pass 质量重建），其余改动在封装层与应用层。
- 假数据一律消灭或明确标注，不允许 `Math.random` 冒充天气数据。

### 2. demo/main.js 重写（方案 A：干净接线层）

从 `88d89c3` 恢复定义素材，重写为单向结构：

```
常量/状态 → DOM 工具(toast/setStatus) → 引擎初始化(仅一次)
→ loadRegion → 事件绑定(仅一次) → 启动(仅一次)
```

- 播放收敛到 `TimelineController.play()/pause()/onFrame()`；复用单一 timeline 实例
  （`load()` 自带 `stop()`），消灭 `setInterval` 泄漏。
- seek 并发守卫：帧版本号递增，异步替换完成时版本过期则丢弃。
- 错误降级只写一份：Cesium 初始化失败 → fallback 地图 + UI 照常可用。

### 3. 渲染与数据性能

| 优化项 | 做法 |
|---|---|
| 纹理直传 | `SkyVortexEngine.swapWeatherTextureFromData(rgba, w, h)`：ImageData → canvas → Cesium.Texture，删除 PNG/blob 往返 |
| 帧缓存 | `loadRegion` 预合成 12 帧缓存为 `Cesium.Texture`（≈3MB 显存）；seek/播放零合成零上传；切区域统一 destroy |
| 旧纹理销毁 | 延迟到下一次 `scene.postRender` 后销毁，避免撕裂 |
| resolutionScale | 改用 Cesium 原生 `viewer.resolutionScale`，删除空循环 |
| 云影 pass | engine-base `CloudShadowPass.setQuality({maxSteps, minStepSize})` 按档重建 shader；`setPerformancePreset` 联动 |
| SIGMET | 用 `NoaaCachedProvider`；`getSigmetsForRegion` 一次 fetch + 本地判 5 个点；支持 MultiPolygon；删无效 User-Agent 头 |
| MockProvider | 单体高斯加 3σ 包围盒裁剪，内层计算量降约一个数量级 |

### 4. 功能接通（完整体核心）

- **航线 Tab**：`FlightPathProfiler.setPath(机场坐标)` → `getProfile(当前帧)` →
  canvas 剖面热力图（距离 × 3 层高度，dBZ 红黄绿分级）；两端机场天气改调
  `OpenMeteoProvider.fetchForecast()`（温度/风速/风向/云量）；API 失败显示"暂不可用"，
  不回退假数据；METAR 假字段删除。
- **单体追踪**：`loadRegion` 对帧序列调 `track()`，卡片显示真实移速/移向；`track()`
  实现轨迹淘汰（原 `matched` 死代码），外推与移速用真实帧时间戳。
- **时间轴**：播放/暂停/拖拽全走 `TimelineController`；帧间隔取自档位无关的固定节奏
  （默认 500ms/帧，倍速可调）。

### 5. 一致性清理

- `DEFAULT_LAYERS` 单源于 `src/synthesis/CloudTextureSynthesizer.js`，
  `skyvortex-engine.js` 改为 import；`synthesize()` 输出的 `layerConfig` 真正传入
  `engine.applyLayers()`（接缝 2 落地）；Python 管线注释指向 JS 单源。
- 接缝编号统一为一套体系并同步 README / ARCHITECTURE / 代码注释：
  接缝 1（数据→合成）、接缝 2（合成→渲染）、接缝 3（UI→渲染）、
  辅助通道 A（NOAA SIGMET）、辅助通道 B（Open-Meteo）。
- `types.js` 的 `VerticalProfile` 修正为实际的 `sampleCount×3` 扁平数组描述。
- 死代码清理：`WeatherDataProvider` 未用的 MockProvider import、resolutionScale 空循环、
  `StormTracker` 死集合；`dat.gui` 深路径 import 改为 `showGui` 时动态加载。
- `PerformanceAdapter`：iPhone 结合 GPU tier 判档（Apple GPU → low 而非一律 ultra）。
- `OpenMeteoProvider.fetchHistorical` 改用 archive 端点（`archive-api.open-meteo.com`）。

### 6. 工程化

- Vitest：单测 StormTracker（detect/track）、CloudTextureSynthesizer、FlightPathProfiler、
  TimelineController（fake timers）、MockProvider（形状与确定性）。
- `package.json`：补 `build`/`preview`/`test` 脚本；`python3` → `python`。
- 文档同步：README 路线图真实状态（去掉不实的"端到端测试"勾选）、MAP.md 过时描述
  （T3"随机数"说法已过时）、STATUS.md 刷新。

## 错误处理

- 网络 API（NOAA/Open-Meteo）失败：面板显示"暂不可用"，不影响雷达主链路。
- Cesium/引擎初始化失败：降级地图 + UI 可用 + toast 提示。
- seek 竞态：版本号守卫丢弃过期结果。

## 测试计划

1. `npm test` 全绿（Vitest 单测覆盖 5 个纯逻辑模块）。
2. `npm run dev` 打开 `pilot-app.html`：控制台无 ReferenceError；区域切换、时间轴
   播放/拖拽、单体卡片（含真实移速）、航线剖面图、性能档位切换全部可操作。
3. 体积云渲染视觉效果需真实 GPU，由用户在 Chrome/Safari 真机确认。

## 假设

- 体积云数据源继续用 mock（真实 CAPPI 数据源待 T2 研究解决）。
- Open-Meteo / NOAA 免费 API 在用户网络环境可达；不可达时按错误处理降级。
- 不引入 lint 工具（用户已选择保持轻量）。
