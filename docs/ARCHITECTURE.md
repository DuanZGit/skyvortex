# SkyVortex 架构

## 模块图

```
                    ┌─────────────────────────┐
                    │      UI Layer            │
                    │  pilot-app.html          │
                    │  TimelineController      │
                    │  StormPanel / FPV        │
                    └────────┬────────────────┘
                             │ 接缝 3: frame index / user intent
                    ┌────────▼────────────────┐
                    │   SkyVortexEngine        │
                    │   (渲染层)               │
                    │   Cesium + PostProcess   │
                    │   体积云 raymarch        │
                    └────────▲────────────────┘
                             │ 接缝 2: CloudTexture { rgba, layerConfig }
                    ┌────────┴────────────────┐
                    │ CloudTextureSynthesizer  │
                    │ (合成层)                 │
                    │ dBZ→RGBA / 云顶估算      │
                    └────────▲────────────────┘
                             │ 接缝 1: WeatherFrame { layers, bounds }
                    ┌────────┴────────────────┐
                    │  WeatherDataProvider     │
                    │  (数据层)                │
                    │  ┌──────────────────┐    │
                    │  │ MockProvider     │    │
                    │  │ CMAProvider (P1) │    │
                    │  │ Commercial (P2)  │    │
                    │  └──────────────────┘    │
                    └─────────────────────────┘

        独立消费接缝 1:
        ┌──────────────────┐  ┌──────────────────────┐
        │  StormTracker    │  │ FlightPathProfiler   │
        │  detect(frame)   │  │ setPath(waypoints)   │
        │  track(frames)   │  │ getProfile(frame)    │
        └──────────────────┘  └──────────────────────┘
```

## 接缝契约

| 接缝 | 上游 | 下游 | 数据 |
|------|------|------|------|
| 1 | WeatherDataProvider | CloudTextureSynthesizer / StormTracker / FlightPathProfiler | `WeatherFrame` |
| 2 | CloudTextureSynthesizer | SkyVortexEngine | `CloudTexture { rgba, layerConfig }` |
| 3 | TimelineController / UI | SkyVortexEngine | frame index → `setFrame()` |

## 文件结构

```
src/
├─ index.js                          # 统一出口
├─ data/
│  ├─ types.js                       # JSDoc 类型定义
│  ├─ WeatherDataProvider.js         # 数据层（接缝 1）
│  └─ MockProvider.js                # mock 适配器
├─ synthesis/
│  └─ CloudTextureSynthesizer.js     # 合成层（接缝 2）
├─ analysis/
│  ├─ StormTracker.js                # 单体识别 + 追踪
│  └─ FlightPathProfiler.js          # 航线垂直剖面
└─ ui/
   └─ TimelineController.js          # 时间轴播放控制

skyvortex-engine.js                  # 渲染层（接缝 3，依赖 Cesium）
engine-base/                         # 体积云引擎（MIT，第三方）
data/pipeline/cappi_to_weather.py    # Python 离线数据管线
demo/                                # Demo 页面
```

## 设计原则

- **深度模块**：每个模块接口 ≤ 5 个方法，实现隐藏所有复杂性
- **接缝处测试**：测试穿过接口，不测实现内部
- **适配器可换**：MockProvider → CMAProvider → CommercialProvider，调用者无感
- **渲染层隔离**：SkyVortexEngine 依赖 window.Cesium，不在 src/index.js 中 re-export