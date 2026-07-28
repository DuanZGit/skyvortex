# SkyVortex — 飞行员立体天气云图引擎

> 基于 Cesium + 体积云的航空雷雨三维可视化引擎，用于飞行员雷雨绕飞决策。

## 架构

```
skyvortex/
├─ engine-base/             # 复刻自 cesium-clouds-atmosphere（MIT）
│  └─ 体积云 + Bruneton 大气 + 空中透视 + 镜头光晕渲染管线
├─ data/                    # P0 数据接入层（CAPPI 雷达 + 风云卫星 IR）
│  ├─ sources/              # 数据源适配器
│  ├─ pipeline/             # 处理管线：CAPPI → local_weather.png 4通道纹理
│  └─ cache/                # 缓存层
├─ public/
│  └─ weather/              # 生成的天气纹理（4 通道 PNG）
├─ demo/                    # 飞行员视角 Demo
│  └─ main.js
├─ tools/
│  └─ fetch_cappi.py        # CAPPI 雷达数据抓取与合成
└─ package.json
```

## 数据流

```
┌────────────────────────────────┐
│ 外部数据源                       │
│  ① CMA 雷达 CAPPI 拼图（公开）   │
│  ② 风云四号 IR 云顶温度          │
│  ③ 探空/模式（垂直订正）         │
└────────────────┬───────────────┘
                 ↓
┌────────────────────────────────┐
│ data/pipeline/cappi_to_weather.py│
│  · 下载/解码 CAPPI               │
│  · 按高度分 3 层 → R/G/B        │
│  · 风云 IR 标定云顶 → A         │
│  · 输出 4 通道 PNG                │
└────────────────┬───────────────┘
                 ↓
┌────────────────────────────────┐
│ engine-base 渲染管线             │
│  · local_weather.png 喂入        │
│  · 每层云高度/厚度映射            │
│  · Cesium 球体上呈现三维云体      │
└────────────────────────────────┘
```

## P0 目标（MVP）

- [x] 跑通 cesium-clouds-atmosphere demo
- [x] 接入中国气象局 CAPPI 雷达拼图（1km/3km/6km 高度）
- [x] CAPPI → 4 通道 local_weather.png 转换
- [x] Demo：飞行员视角，北京区域，雷雨云体实时刷新
- [ ] 多时刻时间轴（后续迭代）

## 运行

```bash
# 1. 启动引擎 dev server（含 Demo）
cd engine-base && npm install && npm run demo

# 2. 拉取并合成真实雷达数据（需联网）
cd ../tools && python3 fetch_cappi.py --region beijing

# 3. 离线 Demo（无需联网，使用本地 mock 数据）
cd engine-base && npm run demo -- --mock
```

## 数据源参考

- CMA 雷达拼图：`http://www.nmc.cn/publish/radar/chinaall.html`
- CMA 探空：每日 02/14 UTC 两次
- 风云四号 IR：1km 分辨率，5min 更新（CMA 部分开放）