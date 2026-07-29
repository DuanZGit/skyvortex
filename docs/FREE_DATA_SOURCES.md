# SkyVortex 免费天气数据源汇总

> 最后更新：2026-07-29（增补：葵花卫星已接入，RainViewer 停服预警）
> 按优先级排序，标注了接入难度和 SkyVortex P0 适用性

---

## 0. 葵花 8/9 号（Himawari）— ✅ 已接入（HimawariProvider）

| 项目 | 详情 |
|------|------|
| **平台** | NICT Himawari Real-time Web（`himawari8.nict.go.jp`）/ AWS Open Data（`noaa-himawari9`） |
| **数据类型** | B13 红外亮温瓦片、真彩色全圆盘（D531106）、L1b/L2 云产品（AWS） |
| **覆盖范围** | 东亚全圆盘（星下点 140.7°E），**含中国全境** |
| **更新频率** | 10 分钟，NICT 保留 24h |
| **认证** | **无需注册、无需 key** |
| **限制** | NICT 无 CORS 头，浏览器端需代理；非官方 SLA |

**实测接入细节（重要，网上无文档）**
```
最新帧：GET /img/FULL_24h/latest.json → {"date":"2026-07-29 09:20:00"}（UTC）
B13 瓦片：GET /img/FULL_24h/B13/{level}d/550/{YYYY}/{MM}/{DD}/{HHMMSS}_{x}_{y}.png
  - level ∈ {4, 8}（16d 无 B13），全盘边长 = level × 550 px
  - PNG 为灰度+alpha（colorType 4）：**云信号在 alpha 通道**（0=晴空，~223=最冷云顶）
  - INFRARED_FULL 旧路径已下线（404）
坐标：GEOS 静止轨道投影，HRIT 常量 CFAC/LFAC=20466275、COFF/LOFF=2750.5（@5500px，扫描角单位为度）
```

**SkyVortex 适用性**：⭐⭐⭐⭐⭐（已落地）
- IR 亮温 → 云顶高度 → 伪 dBZ，驱动体积云实况渲染（`src/data/HimawariProvider.js`）
- 10 分钟一帧，时间轴回放天然支持
- 局限：不是雷达反射率，无法区分降水强度层次；薄卷云会高估对流

---

## ⚠️ 时效预警（2026-07）

- **RainViewer API 已于 2026 年 1 月停服**——大量教程仍在推荐，勿踩坑。社区替代：LibreWXR
- **LibreWXR**（`librewxr.net`）：开源自托管雷达 API，聚合 NOAA MRMS（北美）+ OPERA（欧洲）；**不覆盖中国**，国际航线可用
- **NASA GIBS**：WMTS 全球卫星影像瓦片（MODIS/VIIRS 真彩色 + 云顶产品），免费无 key，Cesium 原生支持
- **met.no**：挪威气象局全球预报 API，免费无 key（需 User-Agent 头），可作 Open-Meteo 备份

---

## 1. 中国气象局（CMA）— 国内首选

| 项目 | 详情 |
|------|------|
| **平台** | `data.cma.cn`（国家气象信息中心） |
| **数据类型** | 雷达探测实况、卫星遥感产品、高空探空、海洋观测、数值模式、城镇预报 |
| **API 风格** | RESTful WebService，JSON 格式 |
| **费用** | 免费注册后可用，部分高频数据需申请 |
| **注册** | 需注册账号 |
| **限制** | 有 QPS 限制，高频雷达/卫星数据可能需要商务合作 |
| **官网** | https://data.cma.cn |

**关键接口**
- 雷达探测实况：基于新一代天气雷达的降水、风场反演数据
- 卫星遥感产品：风云卫星云图、气溶胶、海表温度等
- 高空天气监测：探空气球、风廓线雷达数据
- 全国城镇预报：未来 7 天县级预报

**SkyVortex 适用性**：⭐⭐⭐⭐⭐
- 国内数据最权威
- 雷达拼图可做 CAPPI 三维展示
- 风云卫星红外云图可反演云顶高度
- **需要先注册账号，部分数据需要申请权限**

---

## 2. 星图云开放平台 — 风云卫星云图

| 项目 | 详情 |
|------|------|
| **平台** | `open.geovisearth.com` |
| **数据类型** | 风云四号卫星云图（红外、水汽、可见光） |
| **覆盖范围** | 61~137°E，6~54°N（包含中国全境） |
| **更新频率** | 每小时 |
| **光谱带** | LW（红外）、WV（水汽）、VIS（可见光） |
| **费用** | 有免费额度，超出按量计费 |
| **注册** | 需注册获取 API Key |

**SkyVortex 适用性**：⭐⭐⭐⭐⭐
- 风云四号红外云图可直接反演云顶温度 → 云顶高度
- 与雷达 CAPPI 结合可实现垂直方向天气展示
- 数据格式友好，适合做卫星云图图层

---

## 3. NOAA AviationWeather — 国际航空天气首选

| 项目 | 详情 |
|------|------|
| **平台** | `api.weather.gov` |
| **数据类型** | METAR、TAF、SIGMET、AIRMET、PIREP、雷达、卫星 |
| **认证** | **无需认证** |
| **费用** | 完全免费 |
| **官网** | https://api.weather.gov |
| **OpenAPI** | https://api.weather.gov/openapi.json |

**关键接口**
- `GET /aviation/sigmets` — 全球 SIGMET 报文
- `GET /radar/stations/{stationId}` — 雷达站点信息
- `GET /thumbnails/satellite/{area}` — 卫星图像缩略图
- `GET /stations/{stationId}/observations` — 机场天气实况
- `GET /points/{lat},{lon}/stations` — 坐标附近机场

**SkyVortex 适用性**：⭐⭐⭐⭐
- 航空天气数据最全（SIGMET/CB 云报告）
- 雷达站点元数据可用
- 卫星图像可直接用作底图
- **美国为主，中国覆盖有限**

---

## 4. AVWX — 轻量航空气象解析

| 项目 | 详情 |
|------|------|
| **平台** | `avwx.rest` |
| **数据类型** | METAR、TAF、PIREP、AIR/SIGMET、NOTAM、NBM 预报 |
| **认证** | **无需认证**（基础功能） |
| **费用** | 免费（hobby tier） |
| **格式** | JSON / XML / YAML |
| **源码** | https://github.com/avwx/avwx-engine |

**SkyVortex 适用性**：⭐⭐⭐⭐
- 解析后的 METAR/TAF 可直接展示
- SIGMET 中有积雨云（CB）位置、强度、移动方向
- 适合做飞行员简报面板
- **免费 tier 有速率限制**

---

## 5. Open-Meteo — 开源全球天气模型

| 项目 | 详情 |
|------|------|
| **平台** | `open-meteo.com` |
| **数据类型** | 逐小时预报、历史天气、云量、降水、风 |
| **认证** | **无需 API Key** |
| **费用** | 非商业免费（<10,000 次/天） |
| **模型** | 支持 CMA China（GFS GRAPES，15km，10 天） |
| **源码** | https://github.com/open-meteo/open-meteo |

**示例请求**
```
https://api.open-meteo.com/v1/forecast?latitude=39.9&longitude=116.4
  &hourly=cloud_cover_total,cloud_cover_low,cloud_cover_mid,cloud_cover_high
  &timezone=Asia/Shanghai&forecast_days=3
```

**SkyVortex 适用性**：⭐⭐⭐⭐
- 云量分层数据（低/中/高云）可直接映射到体积云图层
- 无需注册，开箱即用
- 支持 CMA 模型，中国区域可用
- **不是实时雷达，是数值预报**

---

## 6. OpenWeatherMap — 综合天气平台

| 项目 | 详情 |
|------|------|
| **平台** | `openweathermap.org` |
| **数据类型** | 实时天气、预报、天气地图、卫星云图、空气质量 |
| **认证** | 需要 API Key |
| **费用** | 免费 tier：1,000 次/天 |
| **注册** | https://openweathermap.org/api |

**SkyVortex 适用性**：⭐⭐⭐
- 天气地图 API 可获取全球云图
- 免费额度有限，适合 prototyping
- 生产环境建议升级 paid tier

---

## 7. 中央气象台雷达拼图（nmc.cn）

| 项目 | 详情 |
|------|------|
| **平台** | `nmc.cn` / `weather.com.cn` |
| **数据类型** | 全国雷达拼图（基本反射率） |
| **更新频率** | ~6 分钟 |
| **访问方式** | 网页展示 + 图片 URL（未公开 API） |
| **认证** | 无需认证 |

**图片 URL 规律**
```
https://nmc.cn/publish/radar/chinaall.html
实际图片：http://image.nmc.cn/product/2026/07/29/ACMC/medium/SEVP_NSMC_RRA1_TES_ACMC_LNO_PY_20260729000000.jpg
```

**SkyVortex 适用性**：⭐⭐⭐⭐
- 可爬取雷达拼图图片用于 CAPPI 展示
- 数据权威，更新及时
- **没有正式 API，需要逆向图片 URL 规律**

---

## 8. 和风天气（QWeather）

| 项目 | 详情 |
|------|------|
| **平台** | `dev.qweather.com` |
| **数据类型** | 实时天气、预报、分钟降水、灾害预警、空气质量 |
| **认证** | 需要 API Key |
| **费用** | 有免费开发版 |
| **注册** | https://dev.qweather.com |

**SkyVortex 适用性**：⭐⭐⭐⭐
- 国内数据质量高
- 分钟级降水预报适合雷暴预警
- 有免费开发额度
- **雷达/卫星数据需付费**

---

## 推荐组合

### 方案 A：国内飞行员（中国空域）
```
data.cma.cn（雷达拼图）+ 星图云（风云四号红外）+ Open-Meteo（CMA 云量预报）
```
- 成本：免费（需注册 CMA）
- 数据：国内权威雷达 + 国产卫星 + 数值预报

### 方案 B：全球飞行
```
NOAA AviationWeather（SIGMET/METAR）+ Open-Meteo（全球云量）+ AVWX（航空报文解析）
```
- 成本：完全免费
- 数据：全球航空天气 + 开源气象模型

### 方案 C：混合（推荐）
```
国内：CMA 雷达 + 风云卫星
国际：NOAA SIGMET + Open-Meteo
```
- 国内用最权威数据，国际用免费开源数据
- 成本最优，覆盖面最广

---

## 下一步行动

1. ~~接入葵花 B13 伪雷达~~ ✅ 已完成（HimawariProvider，设置面板可切换）
2. **注册 data.cma.cn** — 申请雷达 + 卫星数据权限（真反射率，替换伪雷达）
3. **注册星图云** — 获取风云四号 API Key（与葵花交叉验证云顶）
4. ~~接入 NOAA SIGMET~~ ✅ 已完成
5. ~~写数据适配器~~ ✅ 已完成（Mock / Himawari / NOAA / Open-Meteo 四适配器）

---

## 数据对比表

| 数据源 | 雷达 | 卫星云图 | METAR/TAF | SIGMET | 费用 | 难度 |
|--------|------|----------|-----------|--------|------|------|
| 葵花 NICT | 伪雷达(IR) ✅已接入 | ✅ (B13/真彩) | ❌ | ❌ | 完全免费无注册 | 中（需代理+投影） |
| CMA | ✅ | ✅ | ✅ | ✅ | 免费注册 | 中 |
| 星图云 | ❌ | ✅ (FY4) | ❌ | ❌ | 免费额度 | 低 |
| NOAA | ✅ (美) | ✅ | ✅ | ✅ | 完全免费 | 低 |
| AVWX | ❌ | ❌ | ✅ | ✅ | 免费 | 低 |
| Open-Meteo | ❌ | ❌ | ❌ | ❌ | 完全免费 | 低 |
| OpenWeatherMap | ❌ | ✅ | ✅ | ❌ | 1K/天免费 | 低 |
| 和风天气 | ❌ | ❌ | ✅ | ✅ | 免费开发版 | 低 |
| LibreWXR | ✅ (欧美) | ❌ | ❌ | ❌ | 免费自托管 | 中 |
| NASA GIBS | ❌ | ✅ (全球) | ❌ | ❌ | 完全免费 | 低 |
