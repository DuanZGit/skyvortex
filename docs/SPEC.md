# SkyVortex MVP Spec

## Problem Statement

飞行员在雷雨季节需要快速感知航路周边的三维对流天气结构，但现有工具（RadarScope、ForeFlight）只提供 2D 雷达拼图，无法直观呈现云体的垂直结构、顶高、和时空演变。飞行员必须在脑中把多张 2D 图"拼"成 3D 画面，决策慢、易误判。

## Solution

一个 Web/移动端应用，将多高度雷达 CAPPI + 卫星云顶数据合成为三维体积云，叠加在 Cesium 地球上。飞行员可以：旋转/倾斜查看云体立体结构，拖动时间轴看演变，点击单体看详情，导入航线看剖面。

## User Stories

1. As a 航线飞行员, I want to 看到当前区域雷暴的三维云体, so that 我能直观判断绕飞方向
2. As a 航线飞行员, I want to 拖动时间轴回放过去 1 小时的云体演变, so that 我能判断对流发展趋势
3. As a 航线飞行员, I want to 点击一个雷暴单体查看其顶高/强度/移速, so that 我能评估绕飞安全裕度
4. As a 航线飞行员, I want to 切换不同区域（北京/上海/广州）, so that 我能查看目的地天气
5. As a 航线飞行员, I want to 从飞行员视角（10km 俯瞰）和塔台视角（1km 平视）查看云体, so that 我能获得不同维度的感知
6. As a 签派员, I want to 导入飞行计划航线, so that 我能看到航路上的垂直天气剖面
7. As a 签派员, I want to 看到沿航线的 CAPPI 垂直切片, so that 我能判断是否需要改航
8. As a 通航飞行员, I want to 在低空视角看到云底高度, so that 我能判断是否能目视飞行
9. As a 飞行员, I want to 看到雷暴单体的移动方向箭头, so that 我能预判 30 分钟后的位置
10. As a 飞行员, I want to 收到"前方 30km 有强雷暴"的提示, so that 我能提前准备绕飞
11. As a 飞行员, I want to 在弱网环境下使用预加载的离线数据, so that 我在低空飞行时仍有天气参考
12. As a 飞行员, I want to 调节云层透明度/高度参数, so that 我能聚焦关注的层次

## Implementation Decisions

### 模块架构（深度模块设计）

系统由 6 个深度模块组成，通过 4 条接缝连接：

```
┌──────────────────────────────────────────────────────────────┐
│                        UI Layer (HTML/CSS)                    │
│   TimelineController ←→ FlightPathUI ←→ StormPanel          │
└──────────────┬───────────────────────────────────────────────┘
               │ 接缝 3: frame index / time / user intent
┌──────────────▼───────────────────────────────────────────────┐
│                   SkyVortexEngine (渲染)                      │
│   init() / setFrame(tex) / setLayers() / setPilotView()      │
│   内部: Cesium Viewer + PostProcess Pipeline + 相机控制       │
└──────────────▲───────────────────────────────────────────────┘
               │ 接缝 2: RGBA texture + LayerConfig
┌──────────────┴───────────────────────────────────────────────┐
│               CloudTextureSynthesizer (合成)                  │
│   synthesize(frame) → { texture, layerConfig }               │
│   内部: dBZ 归一化 / 多层映射 / 云顶估算 / PNG 编码           │
└──────────────▲───────────────────────────────────────────────┘
               │ 接缝 1: WeatherFrame (normalized)
┌──────────────┴───────────────────────────────────────────────┐
│                WeatherDataProvider (数据)                     │
│   getFrame(region, time) → WeatherFrame                      │
│   getTimeSeries(region, start, count) → WeatherFrame[]       │
│   内部: 数据源适配 / 解码 / 缓存 / mock 生成                  │
└──────────────────────────────────────────────────────────────┘

独立分析模块（消费接缝 1 的数据）：
┌──────────────────────────────────────────────────────────────┐
│  StormTracker                    FlightPathProfiler          │
│  detect(frame) → Storm[]         setPath(waypoints)          │
│  track(frames) → StormTrack[]    getProfile(frame) → Profile │
└──────────────────────────────────────────────────────────────┘
```

### 核心数据类型

```typescript
// 接缝 1: 数据层 → 合成层
interface WeatherFrame {
  timestamp: string;           // ISO 8601
  bounds: GeoBounds;           // {west, south, east, north}
  width: number;
  height: number;
  layers: {
    cappi_1km: Float32Array;   // dBZ, 0-70
    cappi_3km: Float32Array;
    cappi_6km: Float32Array;
  };
  cloudTopHeight?: Float32Array;  // meters, 0-15000
}

// 接缝 2: 合成层 → 渲染层
interface CloudTexture {
  imageData: ImageData;        // RGBA, 4 通道
  layerConfig: LayerConfig[];  // 每层高度/厚度/覆盖度
}

interface LayerConfig {
  channel: 'r' | 'g' | 'b' | 'a';
  altitude: number;            // meters
  height: number;              // meters
  densityScale: number;
  coverage: number;
}

// 分析输出
interface Storm {
  id: string;
  lon: number; lat: number;
  dbz: number;                 // 峰值反射率
  topHeight: number;           // 云顶高度 m
  driftSpeed?: number;         // km/h
  driftDir?: number;           // degrees
  level: 'safe' | 'warn' | 'danger';
}

interface StormTrack {
  storm: Storm;
  positions: {time: string, lon: number, lat: number}[];
  forecast: {time: string, lon: number, lat: number}[];  // 30min 外推
}
```

### 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 渲染引擎 | Cesium 1.132 + cesium-clouds-atmosphere | 已有轮子，体积云 raymarch |
| 前端框架 | 无框架，原生 JS + ES Modules | MVP 阶段不需要 React/Vue 的复杂度 |
| 构建工具 | Vite 5 | 快速 HMR，ES module 原生支持 |
| 数据管线 | Python 3 + NumPy + PIL | 气象数据处理标准栈 |
| 数据格式 | 4 通道 PNG + JSON manifest | 浏览器原生解码，无需 WASM |
| 跨端 | Capacitor 7（后期） | 一套代码 → iOS/Android |

### 数据源策略

| 阶段 | 数据源 | 说明 |
|---|---|---|
| P0（当前） | Mock 生成器 | 离线开发，验证渲染管线 |
| P1 | CMA 雷达拼图 PNG | nmc.cn 公开，5min 更新，2D 最大投影 |
| P2 | 商业 API（和风/象辑） | 多高度 CAPPI，需付费 |
| P3 | 风云四号 IR | 云顶温度反演，补充 A 通道 |

## Testing Decisions

- **WeatherDataProvider**: 测试 mock 生成器的输出范围（dBZ 0-70, 云顶 0-15km）、时序连续性
- **CloudTextureSynthesizer**: 测试归一化正确性（dBZ→0-1 映射）、通道对应关系
- **StormTracker**: 测试连通域识别（已知输入→已知单体数）、质心精度
- **TimelineController**: 测试播放/暂停/seek 状态机
- 不测试渲染输出（WebGL 不可断言），通过真机截图验证

## Out of Scope

- 机载 EFB 适航认证
- 全球覆盖（MVP 仅中国区域）
- AI 短临预报（0-2h 外推）
- 多用户协作 / ATC 集成
- 后端服务（MVP 为纯前端 + 静态数据）

## Further Notes

- 引擎底座 cesium-clouds-atmosphere 为 MIT 协议，可商用
- headless 浏览器无法渲染体积云 raymarching shader，CI 中不做视觉回归测试
- 移动端性能是关键约束：体渲染在手机上发热严重，需动态 LOD