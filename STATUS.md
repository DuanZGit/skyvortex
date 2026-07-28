# SkyVortex P0 状态报告

> 2026-07-28 · 基于 GitHub 现成轮子 `cesium-clouds-atmosphere` 改造

## ✅ 已完成

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

## 🚀 真机运行

```bash
cd /var/minis/workspace/skyvortex

# 1. 生成雷达纹理（已生成，可跳过）
python3 data/pipeline/cappi_to_weather.py --region beijing

# 2. 启动 dev server
npm run dev
# → http://localhost:5174/pilot-app.html

# 3. 在真实浏览器（Chrome/Safari）打开即可看到体积云渲染
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

## 🔜 下一步（P0.5）

1. **真机验证**：在 Chrome/Safari 打开确认体积云渲染效果
2. **接入真实 CAPPI**：替换 mock 为中国气象局雷达拼图（需解决数据获取）
3. **时间轴**：多时刻 CAPPI 序列播放（5min 间隔）
4. **风云四号 IR**：云顶温度反演 → A 通道
5. **Capacitor 打包**：iOS/Android 原生壳