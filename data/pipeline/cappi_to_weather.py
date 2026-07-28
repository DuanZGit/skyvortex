"""
SkyVortex CAPPI → 体积云纹理转换器

将多个高度的 CAPPI 雷达反射率合成 4 通道 PNG，喂给 Cesium 体积云管线
（替换 engine-base 的 local_weather.png）。

通道映射：
  R = 1km CAPPI 反射率   （低层云）
  G = 3km CAPPI 反射率   （中层云，对流核心）
  B = 6km CAPPI 反射率   （高层云/卷云）
  A = 云顶高度场          （风云 IR 反演或简单代数估算）
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("skyvortex.cappi")


@dataclass
class WeatherTile:
    """一个时刻的合成天气纹理"""
    timestamp: str          # ISO 时间
    bounds: dict            # {west, south, east, north} 经纬度边界
    width: int              # 像素宽
    height: int             # 像素高
    layers: dict            # 各高度层反射率（dBZ）
    cloud_top_height: Optional[np.ndarray] = None  # 云顶高度 (m)

    def to_rgba(self) -> np.ndarray:
        """合成 RGBA 数组，R/G/B = 各层反射率归一化，A = 云顶高度归一化"""
        h, w = self.height, self.width
        rgba = np.zeros((h, w, 4), dtype=np.float32)

        for ch, key in enumerate(["cappi_1km", "cappi_3km", "cappi_6km"]):
            layer = self.layers.get(key)
            if layer is None:
                continue
            # 反射率范围 0-70 dBZ → 归一化 0-1
            rgba[..., ch] = np.clip(layer / 70.0, 0.0, 1.0)

        if self.cloud_top_height is not None:
            # 云顶 0-15km → 0-1
            rgba[..., 3] = np.clip(self.cloud_top_height / 15000.0, 0.0, 1.0)
        else:
            # 没云顶数据时用各层 max 估算
            stack = np.stack([
                rgba[..., 0], rgba[..., 1], rgba[..., 2]
            ], axis=-1).max(axis=-1)
            rgba[..., 3] = stack * 0.85

        return rgba

    def save_png(self, path: Path) -> None:
        rgba = self.to_rgba()
        arr8 = (rgba * 255).clip(0, 255).astype(np.uint8)
        Image.fromarray(arr8, mode="RGBA").save(path, optimize=True)
        # 同时存 metadata
        meta_path = path.with_suffix(".json")
        meta = {
            "timestamp": self.timestamp,
            "bounds": self.bounds,
            "width": self.width,
            "height": self.height,
            "layers_keys": list(self.layers.keys()),
        }
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
        log.info(f"  -> {path.name} ({path.stat().st_size//1024} KB, "
                 f"{self.width}x{self.height})")


def synthesize_mock_tile(
    bounds: dict,
    timestamp: str,
    size: int = 512,
    storm_center: tuple = (116.5, 39.8),
    storm_radius_deg: float = 1.5,
    n_storms: int = 3,
    seed: int = 42,
) -> WeatherTile:
    """
    生成模拟雷达数据，用于离线开发。
    
    在指定位置生成若干雷暴单体，模拟典型对流云结构：
    - 低层 CAPPI 范围广、强度中等（层状云）
    - 中层 CAPPI 集中在单体核心（强对流）
    - 高层 CAPPI 集中在卷云砧部
    """
    rng = np.random.default_rng(seed)
    w, h = size, size
    west, south = bounds["west"], bounds["south"]
    east, north = bounds["east"], bounds["north"]

    # 经纬度 → 像素坐标
    lon_grid = np.linspace(west, east, w)
    lat_grid = np.linspace(south, north, h)
    lon2d, lat2d = np.meshgrid(lon_grid, lat_grid)

    cappi_1km = np.zeros((h, w), dtype=np.float32)
    cappi_3km = np.zeros((h, w), dtype=np.float32)
    cappi_6km = np.zeros((h, w), dtype=np.float32)
    cloud_top = np.zeros((h, w), dtype=np.float32)

    # 模拟 3 个雷暴单体
    for i in range(n_storms):
        cx, cy = storm_center
        cx += rng.uniform(-1.0, 1.0) * storm_radius_deg
        cy += rng.uniform(-0.8, 0.8) * storm_radius_deg

        # 单体中心强度
        core_dbz = rng.uniform(45, 60)
        # 单体半径（度）
        rx = rng.uniform(0.3, 0.8)
        ry = rng.uniform(0.3, 0.8)

        # 椭圆高斯衰减
        dx = (lon2d - cx) / rx
        dy = (lat2d - cy) / ry
        r2 = dx * dx + dy * dy

        # 低层：范围广，强度衰减慢
        low = core_dbz * np.exp(-r2 * 0.5)
        # 中层：集中在核心
        mid = core_dbz * 1.1 * np.exp(-r2 * 1.5)
        # 高层：核心更尖锐，外延成砧（砧部比中层大）
        high_core = core_dbz * 0.9 * np.exp(-r2 * 2.5)
        anvil = (core_dbz - 15) * np.exp(-r2 * 0.3) * 0.6
        high = np.maximum(high_core, anvil)

        cappi_1km = np.maximum(cappi_1km, low)
        cappi_3km = np.maximum(cappi_3km, mid)
        cappi_6km = np.maximum(cappi_6km, high)

        # 云顶高度：核心高，外延低
        core_top = rng.uniform(11000, 14000)  # 11-14km
        edge_top = rng.uniform(6000, 8000)
        local_top = edge_top + (core_top - edge_top) * np.exp(-r2 * 1.2)
        cloud_top = np.maximum(cloud_top, local_top)

    # 加点底噪（薄云）
    base_noise = rng.normal(8, 2, (h, w)).astype(np.float32)
    cappi_1km += np.maximum(base_noise, 0)

    return WeatherTile(
        timestamp=timestamp,
        bounds=bounds,
        width=w,
        height=h,
        layers={
            "cappi_1km": cappi_1km,
            "cappi_3km": cappi_3km,
            "cappi_6km": cappi_6km,
        },
        cloud_top_height=cloud_top,
    )


def fetch_cma_cappi(region: str = "beijing") -> Optional[WeatherTile]:
    """
    从中国气象局下载雷达 CAPPI 拼图。
    
    数据源：http://www.nmc.cn/publish/radar/chinaall.html
    返回拼图是单层（反射率最大投影），需要配合小时级时序。
    
    注：CMA 没有开放按高度的 CAPPI 三维切片，需联系省级气象局或商业渠道。
    本函数尝试下载拼图 PNG，然后以合成方式分层。
    """
    import urllib.request

    # 实际工程中应替换为省局 / 商业 API
    # 这里先做占位：如果失败返回 None，调用方走 mock
    log.warning("CMA CAPPI 三维数据未公开，P0 阶段以 mock 数据开发；"
                "真实接入需走省级气象局或和风/象辑商业接口")
    return None


def main():
    parser = argparse.ArgumentParser(description="SkyVortex CAPPI → 体积云纹理")
    parser.add_argument("--region", default="beijing",
                        choices=["beijing", "shanghai", "guangzhou"],
                        help="目标区域")
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[2] / "public/weather",
                        help="输出目录")
    parser.add_argument("--size", type=int, default=512,
                        help="输出 PNG 尺寸（正方形）")
    parser.add_argument("--timestamp", default=None,
                        help="ISO 时间，默认当前时刻")
    parser.add_argument("--no-mock", action="store_true",
                        help="禁用 mock，强制走真实数据（需付费API）")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)

    regions = {
        "beijing":   {"west": 115.0, "south": 39.0, "east": 117.5, "north": 41.0,
                       "center": (116.5, 39.8)},
        "shanghai":  {"west": 120.5, "south": 30.5, "east": 122.5, "north": 32.0,
                       "center": (121.5, 31.2)},
        "guangzhou": {"west": 112.5, "south": 22.0, "east": 114.5, "north": 24.0,
                       "center": (113.3, 23.1)},
    }
    bounds = regions[args.region]
    timestamp = args.timestamp or "2026-07-28T20:00:00Z"

    log.info(f"=== SkyVortex CAPPI pipeline ===")
    log.info(f"region   : {args.region}")
    log.info(f"bounds   : {bounds}")
    log.info(f"timestamp: {timestamp}")
    log.info(f"output   : {args.output}")

    # 1. 尝试真实数据
    real = None if args.no_mock else None  # fetch_cma_cappi(args.region)  # 待接入
    tile = real

    # 2. 退化到 mock
    if tile is None:
        log.info("使用 mock 数据（离线开发模式）")
        tile = synthesize_mock_tile(
            bounds=bounds,
            timestamp=timestamp,
            size=args.size,
            storm_center=bounds["center"],
        )

    # 输出按区域命名，便于前端按需加载
    out_path = args.output / f"{args.region}.png"
    tile.save_png(out_path)
    # 始终同步一份 local_weather.png 作为默认入口（首屏）
    default_path = args.output / "local_weather.png"
    if out_path != default_path:
        import shutil
        shutil.copy2(out_path, default_path)
    log.info(f"✅ 已生成 {out_path}")
    log.info(f"   通道R 范围: {tile.layers['cappi_1km'].min():.1f} - {tile.layers['cappi_1km'].max():.1f} dBZ")
    log.info(f"   通道G 范围: {tile.layers['cappi_3km'].min():.1f} - {tile.layers['cappi_3km'].max():.1f} dBZ")
    log.info(f"   通道B 范围: {tile.layers['cappi_6km'].min():.1f} - {tile.layers['cappi_6km'].max():.1f} dBZ")
    if tile.cloud_top_height is not None:
        log.info(f"   云顶高度  : {tile.cloud_top_height.min():.0f} - {tile.cloud_top_height.max():.0f} m")


if __name__ == "__main__":
    main()