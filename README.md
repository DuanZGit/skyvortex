# SkyVortex — 飞行员立体天气云图引擎

基于 Cesium 体积云渲染的航空雷雨三维可视化引擎。将多高度雷达 CAPPI + 卫星云顶数据合成为三维体积云，叠加在数字地球上，供飞行员雷雨绕飞决策。

![Cesium](https://img.shields.io/badge/Cesium-1.132-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## 效果

- ☁️ 体积云 raymarch（多层云、形状/细节 3D 纹理、weather 图驱动）
- 🌅 Bruneton 预计算大气散射 + 空中透视
- 🌑 Beer Shadow Map 云影 + 丁达尔光束
- ✨ 镜头光晕泛光
- 📐 三层云高度映射：1km 低层 / 3.5km 对流核心 / 8km 卷云砧

## 架构

6 个深度模块，4 条接缝（详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)）：

```
UI Layer (TimelineController / StormPanel)
    │ 接缝 3: frame index / user intent
SkyVortexEngine (Cesium + 体积云 PostProcess)
    │ 接缝 2: CloudTexture { rgba, layerConfig }
CloudTextureSynthesizer (dBZ → RGBA 合成)
    │ 接缝 1: WeatherFrame { layers, bounds }
WeatherDataProvider ← MockProvider / CMAProvider / CommercialProvider

独立分析：StormTracker (单体识别+追踪) / FlightPathProfiler (航线剖面)
```

## 项目结构

```
skyvortex/
├─ src/                              # 核心模块
│  ├─ index.js                       # 统一出口
│  ├─ data/
│  │  ├─ types.js                    # JSDoc 类型契约
│  │  ├─ WeatherDataProvider.js      # 数据层（接缝 1）
│  │  └─ MockProvider.js             # mock 适配器
│  ├─ synthesis/
│  │  └─ CloudTextureSynthesizer.js  # 合成层（接缝 2）
│  ├─ analysis/
│  │  ├─ StormTracker.js             # 连通域识别 + 跨帧追踪 + 30min 外推
│  │  └─ FlightPathProfiler.js       # 航线垂直剖面
│  └─ ui/
│     └─ TimelineController.js       # 时间轴播放状态机
├─ skyvortex-engine.js               # 渲染层（接缝 3，依赖 Cesium）
├─ engine-base/                      # 体积云引擎（MIT，改编自 three-geospatial）
├─ data/pipeline/
│  └─ cappi_to_weather.py            # Python 离线数据管线
├─ demo/
│  ├─ pilot-app.html                 # 飞行员 Demo 页面
│  └─ main.js                        # Demo 逻辑
├─ public/weather/                   # 生成的天气纹理（4 通道 PNG）
├─ docs/
│  ├─ SPEC.md                        # MVP 产品规格
│  └─ ARCHITECTURE.md                # 模块架构图
└─ MAP.md                            # 开发路线图（wayfinder）
```

## 快速开始

```bash
# 安装依赖（three / dat.gui 已声明在根 package.json，无需单独安装 engine-base）
npm install

# 生成 mock 雷达数据（北京/上海/广州，仓库已附生成结果可跳过）
python3 data/pipeline/cappi_to_weather.py --region beijing
python3 data/pipeline/cappi_to_weather.py --region shanghai
python3 data/pipeline/cappi_to_weather.py --region guangzhou

# 启动 dev server
npm run dev
# → http://localhost:5174/pilot-app.html

# 单元测试（Vitest）
npm test

# 生产构建 / 预览
npm run build
npm run preview
```

> ⚠️ 体积云 raymarching 需要真实 GPU，headless 浏览器 / 虚拟机中可能渲染为黑屏。请在 Chrome / Safari 中打开。

## 模块使用

```js
import {
  WeatherDataProvider, MockProvider,
  CloudTextureSynthesizer,
  StormTracker, FlightPathProfiler,
  TimelineController,
} from "./src/index.js";

// 数据
const provider = new WeatherDataProvider();
provider.setAdapter(new MockProvider());
const frames = await provider.getTimeSeries("beijing", "2026-07-28T12:00:00Z", 12);

// 合成
const synth = new CloudTextureSynthesizer();
const texture = synth.synthesize(frames[0]);

// 分析
const tracker = new StormTracker();
const storms = tracker.detect(frames[6]);     // → [{id, lon, lat, dbz, topHeight, level}]
const tracks = tracker.track(frames);          // → [{storm, history, forecast}]

// 航线剖面
const profiler = new FlightPathProfiler();
profiler.setPath([{lon: 115.5, lat: 39.5}, {lon: 117.2, lat: 40.3}]);
const profile = profiler.getProfile(frames[6]); // → {distanceKm, dbz, heights}

// 时间轴
const tl = new TimelineController();
tl.load(frames.map(f => ({timestamp: f.timestamp, data: f})));
tl.onFrame((i, frame) => engine.setFrame(frame));
tl.play();
```

## 数据源

| 阶段 | 数据源 | 状态 |
|------|--------|------|
| P0 | Mock 生成器（离线，seed 可复现） | ✅ 已完成 |
| P1 | Open-Meteo（免费无 key，航线端点天气快照） | ✅ 已接入 |
| P1 | 葵花 9 号 B13 红外实况（NICT，免费无 key，云顶反演伪雷达） | ✅ 已接入 |
| P1 | CMA 雷达拼图（nmc.cn，公开） | 🔜 待接入 |
| P2 | 商业 API（和风 / 象辑） | 📋 规划中 |
| P3 | 风云四号 IR 云顶反演 | 📋 规划中 |

## 路线图

- [x] P0：引擎集成 + mock 数据管线 + 飞行员 Demo
- [x] 架构脚手架：6 模块 + 4 接缝 + 端到端测试
- [x] T1：时间轴动画（多帧播放 / 暂停 / 拖拽，TimelineController 接入 UI）
- [x] T3：雷暴单体识别（连通域 + 质心 + 移速 + 30min 外推）
- [x] T4：飞行路径垂直剖面（FlightPathProfiler + Open-Meteo 端点天气）
- [x] 工程化：Vitest 单测（32 用例）+ build/preview 脚本
- [x] T5'：葵花 9 号 IR 云顶反演实况（HimawariProvider，设置面板可切 Mock/卫星）
- [ ] T2：真实 CAPPI 雷达拼图接入（需数据源授权）
- [ ] T5：风云四号 IR 云顶反演（与葵花交叉验证）
- [ ] Capacitor 移动端打包

## 致谢

- [cesium-clouds-atmosphere](https://github.com/yuwoniu03/cesium-clouds-atmosphere)（MIT）— 体积云 + Bruneton 大气渲染
- [three-geospatial](https://github.com/takram-design-engineering/three-geospatial)（MIT）— 原始渲染实现

## License

MIT