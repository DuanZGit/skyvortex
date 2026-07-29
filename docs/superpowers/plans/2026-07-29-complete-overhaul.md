# 完整体开发实施计划

> 依据：`docs/superpowers/specs/2026-07-29-complete-overhaul-design.md`（commit 2bdd6e0）
> 执行方式：Inline（用户已指示"开发到完整体"，直接实施）

## 任务 1：src 模块修复与清理

- **NoaaProvider**：`_pointInPolygon` 支持 Polygon + MultiPolygon；新增 `checkPoints(points)`（单次 fetch，本地判断多点）
- **WeatherDataProvider**：改用 `NoaaCachedProvider`（5min 缓存）；删除死 import MockProvider；`getSigmetsForRegion` 用单次 fetch + 5 点本地判断；新增 `getAirportSnapshot(lat, lon)` 供航线 Tab 用
- **OpenMeteoProvider**：`fetchHistorical` 改用 archive 端点（`archive-api.open-meteo.com/v1/archive`）
- **MockProvider**：单体循环加 3σ 包围盒裁剪（含砧状云 0.3 系数的宽扩散，用 4× 半径保守裁剪）
- **StormTracker**：删除 `matched` 死代码；帧间隔从 timestamps 实际推导（fallback 5min）
- **types.js**：修正 `VerticalProfile` 契约（heights/dbz 为 sampleCount×3 扁平数组）

## 任务 2：引擎优化

- **CloudShadowPass**（engine-base，小幅修改）：新增 `setQuality({maxSteps, minStepSize, maxStepSize})` → 更新 params → deleteProgram → createProgram
- **skyvortex-engine.js**：
  - `createWeatherTexture({rgba,width,height})`：ImageData→canvas→Cesium.Texture（直传，无 PNG/blob 往返）
  - `setWeatherTexture(tex, {destroyOld})`：安装纹理；旧纹理 postRender 后延迟销毁；`destroyOld:false` 支持外部缓存（12 帧预合成）
  - `swapWeatherTextureFromData(data)` = createWeatherTexture + setWeatherTexture(destroyOld:true)
  - `swapWeatherTexture(url)` 保留兼容，内部走同一安装路径
  - shadowPass 引用修正为 `pipeline._bsm?.pass`（textures 对象共享引用，weather 替换自动生效）
  - `setPerformancePreset`：删除死代码分支，改 `viewer.resolutionScale` + `shadowPass.setQuality()`
  - DEFAULT_LAYERS 改为 import 自 `src/synthesis/CloudTextureSynthesizer.js`（去重）
  - dat.gui 改动态 import（仅 showGui 时加载）

## 任务 3：重写 demo/main.js（方案 A）

单一职责接线层，结构：
1. 配置区：REGIONS / AIRPORTS（ICAO→坐标）/ provider(Mock seed=42) / synth / stormTracker / profiler
2. 工具区：toast / setStatus / fmtTime
3. Cesium Viewer + SkyVortexEngine 初始化（单一启动路径，try/catch + loading 隐藏）
4. 帧管线：`loadRegion(region)` → getTimeSeries(12帧) → 每帧 synthesize + engine.createWeatherTexture 预缓存 → TimelineController.load → onFrame 回调 setWeatherTexture(cached, destroyOld:false)；区域切换销毁旧缓存；seek 版本号守卫
5. 面板渲染：storms（StormTracker.detect + track 移速）/ timeline / sigmets / forecast / route / settings
6. 航线 Tab：FlightPathProfiler 真剖面（canvas 绘制 3 层 dbz 色块图）+ Open-Meteo 机场实时快照（getAirportSnapshot）
7. 事件绑定：单次 bindEvents()（区域 chip / perf chip `.sv-chip` / fpv / tab / timeline / play / clouds / refresh / route check）
8. 启动：单一 main() 入口

## 任务 4：工程化

- `package.json`：`test`(vitest run) / `build`(vite build) / `preview`(vite preview) / data:* 改 `python`；devDep + vitest
- `vitest.config.js`：独立配置（不能复用 vite.config.js，其 root=demo）
- 单测（tests/*.test.js）：StormTracker（detect 连通域/track 移速）、FlightPathProfiler（距离/采样/dbz）、CloudTextureSynthesizer（通道映射/A 通道 fallback）、MockProvider（确定性/包围盒等价性）、NoaaProvider（parse/Polygon/MultiPolygon 点判断）、OpenMeteoProvider（parse/DailySummary 风险分级）

## 任务 5：验证与收尾

- `npm test` 全绿；`npm run build` 成功
- dev server + 浏览器验证（截图）：加载完成、云渲染、Tab 切换、时间轴播放、航线剖面
- README/STATUS 同步；删除 `.tmp-main-old.js`；分任务 git commit
