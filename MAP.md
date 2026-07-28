# SkyVortex 开发地图

> wayfinder:map

## 目的地

飞行员可用的 MVP：打开 App → 看到当前区域三维雷暴云体 → 时间轴回放/预报 → 点击单体看详情 → 获得绕飞参考。

## 笔记

- 引擎底座：cesium-clouds-atmosphere（MIT），体积云 raymarch
- 数据管线：Python CAPPI → 4 通道 PNG
- 前端：Vite + 原生 JS（无框架），Cesium 1.132
- 无 ion token，用 NaturalEarthII 离线底图
- headless 浏览器无法渲染体积云，真机验证由用户完成
- 技能：implement / tdd / code-review / prototype

## 决策记录

- [P0 引擎集成](https://github.com/DuanZGit/skyvortex/commit/8fd2c57) — cesium-clouds-atmosphere 跑通，SkyVortexEngine 封装完成，mock CAPPI 管线就绪

## 活跃 Tickets

### T1: 时间轴动画系统 `wayfinder:task` (AFK)
**问题**：飞行员需要看不同时刻的云体演变。当前只有单帧静态纹理。
需要：多帧 CAPPI 序列 → 时间轴 UI → 纹理热切换 → 播放/暂停/拖拽。
**blocking**: 无

### T2: 真实 CAPPI 数据接入 `wayfinder:research` (AFK)
**问题**：mock 数据无法验证产品价值。需要找到可免费/低成本获取的雷达数据源。
候选：CMA 雷达拼图 PNG（nmc.cn）、和风天气 API、象辑科技。
**blocking**: 无

### T3: 雷暴单体识别算法 `wayfinder:prototype` (AFK)
**问题**：当前单体列表是随机数。需要从 CAPPI 反射率场中真正识别连通域、计算质心/顶高/移速。
**blocking**: T1（需要多帧数据才能算移速）

### T4: 飞行路径剖面 `wayfinder:prototype` (AFK)
**问题**：飞行员最核心的需求是"我的航路上天气如何"。需要：导入航线 → 沿航线切垂直剖面 → 叠加到 3D 场景。
**blocking**: T1

### T5: 风云四号 IR 云顶反演 `wayfinder:research` (AFK)
**问题**：A 通道当前是估算值。需要接入 FY-4 IR 数据反演真实云顶高度。
**blocking**: T2

## 尚未指定

- 移动端打包（Capacitor）— 等核心功能稳定后再决定
- 离线缓存策略 — 取决于数据源和更新频率
- AI 短临预报（0-2h 外推）— 远期
- EFB 适航认证 — 超出 MVP 范围

## 超出范围

- 机载硬件集成 — 需要适航认证，非 MVP
- 全球覆盖 — MVP 先做中国区域