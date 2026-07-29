# SkyVortex 状态报告

> 2026-07-29 · 完整体开发（修复 + 性能 + 功能接通 + 工程化）

## ✅ 2026-07-29 完整体（设计文档：docs/superpowers/）

### 修复
- StormTracker 跨帧追踪：轨迹改用独立 trk-N 编号（storm.id 每帧重编号导致 Map key 冲突）
- NoaaProvider/OpenMeteoProvider/MockProvider 接口对齐 types.js 契约
- three / dat.gui 补声明为正式依赖（此前从未安装，build 必败）
- vite 中间件回源 /engine-base/** 静态资产（大气 LUT .bin 404 修复）+ build 时复制到 dist

### 功能接通（demo/main.js 重写为干净接线层）
- 时间轴：TimelineController 驱动多帧播放/暂停/拖拽，纹理热替换
- 风暴追踪：StormTracker 真算法驱动单体卡片（dBZ/云顶/移速/威胁分级）+ SIGMET 告警
- 航线剖面：FlightPathProfiler 真算法 + Open-Meteo 真实 API 端点天气快照
- 引擎：Canvas 纹理直传（免 PNG 编解码）、resolutionScale/setQuality 性能档位、showGui 开关透传链（默认关闭 dat.gui 面板）

### 工程化
- Vitest 单测 19/19 绿（tests/：mockProvider / cloudTextureSynthesizer / stormTracker / flightPathProfiler）
- npm scripts：dev / test / build / preview；生产构建主包 313KB（gzip 89KB）

### 验证证据
- 真实浏览器交互验证：区域切换/时间轴/风暴卡片/航线剖面/SIGMET/预报全部通过，零 console 错误
- 3D 体积云渲染截图：docs/superpowers/verify-app.png（北京上空 10km 积云场）

## ✅ P0 已完成（2026-07-28）

### 1. 引擎底座（engine-base/）
- 来源：`yuwoniu03/cesium-clouds-atmosphere`（MIT，2026-07-27 最后更新）
- 改编自 `takram-design-engineering/three-geospatial`
- 能力：体积云 raymarch + Bruneton 大气 + 空中透视 + BSM 云影 + 镜头光晕
- Cesium 1.132 + Three.js（仅用于解析 .bin 3D 纹理）

### 2. SkyVortex 引擎封装（skyvortex-engine.js）
- `SkyVortexEngine` 类：封装管线初始化、纹理热替换、云层高度配置
- 飞行员专用 API：`setPilotView()`, `swapWeatherTexture()`, `setCloudsVisible()`
- 默认三层云高度映射：
  - R 通道 → 1.5km（低层云）
  - G 通道 → 3.5km（对流核心）
  - B 通道 → 8.0km（卷云砧）

### 3. CAPPI 数据管线（data/pipeline/cappi_to_weather.py）
- 多高度 CAPPI 反射率 → 4 通道 PNG（R/G/B/A）
- 内置 mock 雷暴生成器（3 个单体，椭圆高斯衰减，含砧部结构）
- 支持北京/上海/广州三区域
- 输出：512×512 RGBA PNG + JSON 元数据

### 4. 飞行员 Demo（demo/pilot-app.html + demo/main.js）
- HUD 界面：区域切换、雷暴单体列表（含 dBZ/云顶/移速）、4 种飞行视角
- 离线底图：Cesium NaturalEarthII（无需 ion token）
- dat.gui 调参面板：实时调整三层云高度/厚度/覆盖度

### 5. 初始化验证
- ✅ 6/6 纹理加载（shape, shapeDetail, stbn, weather, turbulence, blueNoise）
- ✅ 4/4 后处理阶段就绪（Atmosphere, AerialPerspective, VolumetricClouds, LensFlare）
- ✅ WebGL2 + 3D 纹理支持确认
- ✅ 太阳方向计算正常
- ⚠️ 体积云渲染效果无法在 headless 浏览器验证（GPU shader 限制），需真机测试

## 🚀 运行

```bash
npm install          # three/dat.gui 已在根依赖
npm run dev          # → http://localhost:5174/pilot-app.html
npm test             # Vitest 19 用例
npm run build        # → dist/（含 engine-base 资产复制）
```

## 📁 关键文件

| 文件 | 作用 |
|------|------|
| `skyvortex-engine.js` | 引擎封装层（飞行员 API） |
| `demo/pilot-app.html` | 飞行员 Demo 页面 |
| `demo/main.js` | Demo 逻辑（区域/视角/单体列表） |
| `data/pipeline/cappi_to_weather.py` | CAPPI → 4 通道纹理 |
| `public/weather/*.png` | 生成的天气纹理 |
| `engine-base/` | 体积云渲染引擎（MIT） |

## 🔜 下一步

1. **T2 真实 CAPPI**：接入中国气象局雷达拼图（需解决数据获取授权）
2. **风云四号 IR**：云顶温度反演 → A 通道
3. **Capacitor 打包**：iOS/Android 原生壳