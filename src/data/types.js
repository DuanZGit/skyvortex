/**
 * SkyVortex 核心数据类型定义
 *
 * 这些类型定义了模块间接缝的数据契约。
 * 运行时不做类型检查（纯 JS），但 JSDoc 供 IDE 和开发者参考。
 */

/**
 * @typedef {Object} GeoBounds
 * @property {number} west   - 西经边界（度）
 * @property {number} south  - 南纬边界（度）
 * @property {number} east   - 东经边界（度）
 * @property {number} north  - 北纬边界（度）
 */

/**
 * @typedef {Object} WeatherFrame
 * 接缝 1 的数据契约：数据层 → 合成层
 * @property {string} timestamp        - ISO 8601 时间
 * @property {GeoBounds} bounds        - 地理边界
 * @property {number} width            - 像素宽
 * @property {number} height           - 像素高
 * @property {Object} layers           - 各高度层反射率
 * @property {Float32Array} layers.cappi_1km  - 1km CAPPI (dBZ, 0-70)
 * @property {Float32Array} layers.cappi_3km  - 3km CAPPI (dBZ, 0-70)
 * @property {Float32Array} layers.cappi_6km  - 6km CAPPI (dBZ, 0-70)
 * @property {Float32Array} [layers.cloudTop] - 云顶高度 (m, 0-15000)
 */

/**
 * @typedef {Object} LayerConfig
 * 单层云的渲染参数
 * @property {'r'|'g'|'b'|'a'} channel - 对应纹理通道
 * @property {number} altitude         - 云底海拔 (m)
 * @property {number} height           - 云层厚度 (m)
 * @property {number} densityScale     - 密度缩放
 * @property {number} coverage         - 覆盖度 (0-1)
 * @property {number} coverageFilterWidth - 覆盖过滤宽度
 */

/**
 * @typedef {Object} CloudTexture
 * 接缝 2 的数据契约：合成层 → 渲染层
 * @property {Uint8ClampedArray} rgba  - RGBA 像素数据 (width*height*4)
 * @property {number} width
 * @property {number} height
 * @property {LayerConfig[]} layerConfig - 每层云的渲染参数
 */

/**
 * @typedef {Object} Storm
 * @property {string} id               - 单体编号 (e.g. "CB-01")
 * @property {number} lon              - 质心经度
 * @property {number} lat              - 质心纬度
 * @property {number} dbz              - 峰值反射率 (dBZ)
 * @property {number} topHeight        - 云顶高度 (m)
 * @property {number} [driftSpeed]     - 移速 (km/h)
 * @property {number} [driftDir]       - 移向 (度, 气象 convention)
 * @property {'safe'|'warn'|'danger'} level - 威胁等级
 */

/**
 * @typedef {Object} StormTrack
 * @property {Storm} storm             - 当前状态
 * @property {Array<{time:string, lon:number, lat:number}>} history - 历史轨迹
 * @property {Array<{time:string, lon:number, lat:number}>} forecast - 30min 外推
 */

/**
 * @typedef {Object} VerticalProfile
 * 沿航线的垂直剖面
 * @property {number} distanceKm       - 剖面总长 (km)
 * @property {number} sampleCount      - 采样点数
 * @property {Float32Array} distances  - 各采样点距起点距离 (km)，长度 sampleCount
 * @property {Float32Array} heights    - 扫层高度 (m)，扁平数组 sampleCount×3（每采样点 1/3/6km 三层）
 * @property {Float32Array} dbz        - 反射率 (dBZ)，扁平数组 sampleCount×3，与 heights 对齐
 */

export {};