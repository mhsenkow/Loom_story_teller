#!/usr/bin/env python3
"""
🧵 Loom — Sample Data Generator
Generates synthetic datasets for testing the data explorer.

Usage:
    python3 scripts/generate_data.py              # default (10K + 100K + 1M)
    python3 scripts/generate_data.py --size small  # 1K rows
    python3 scripts/generate_data.py --size mega   # 5M rows

Output goes to .loom-data/ — mount this folder in Loom to explore.
"""

import argparse
import csv
import math
import os
import random
import struct
import sys
import time

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".loom-data")

CITIES = [
    "San Francisco", "New York", "London", "Tokyo", "Berlin",
    "Paris", "Sydney", "Toronto", "Seoul", "Mumbai",
    "Lagos", "São Paulo", "Mexico City", "Cairo", "Bangkok",
]

CATEGORIES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]

PRODUCTS = [
    "Widget A", "Widget B", "Gadget Pro", "Gadget Lite",
    "Module X", "Module Y", "Sensor V1", "Sensor V2",
    "Board Rev3", "Board Rev4", "Cable Kit", "Power Unit",
]

STATUS = ["active", "inactive", "pending", "archived"]


def make_scatter_csv(path: str, n: int):
    """Multi-cluster scatterplot data with noise — great for WebGPU stress test."""
    print(f"  Generating scatter data: {n:,} rows → {os.path.basename(path)}")
    centers = [(random.uniform(-50, 50), random.uniform(-50, 50)) for _ in range(8)]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["x", "y", "cluster", "magnitude", "label"])
        for i in range(n):
            cx, cy = random.choice(centers)
            x = cx + random.gauss(0, 8)
            y = cy + random.gauss(0, 8)
            mag = math.sqrt(x * x + y * y) + random.gauss(0, 2)
            cluster = CATEGORIES[centers.index((cx, cy)) % len(CATEGORIES)]
            label = f"pt_{i}"
            w.writerow([round(x, 4), round(y, 4), cluster, round(mag, 4), label])


def make_sales_csv(path: str, n: int):
    """Fake sales data with time series — good for bar/line charts."""
    print(f"  Generating sales data:   {n:,} rows → {os.path.basename(path)}")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "city", "product", "units", "revenue", "status"])
        base_ts = 1672531200  # 2023-01-01
        for i in range(n):
            ts = base_ts + random.randint(0, 63072000)  # ~2 years
            date = time.strftime("%Y-%m-%d", time.gmtime(ts))
            city = random.choice(CITIES)
            product = random.choice(PRODUCTS)
            units = random.randint(1, 500)
            price = random.uniform(9.99, 299.99)
            revenue = round(units * price, 2)
            status = random.choice(STATUS)
            w.writerow([date, city, product, units, revenue, status])


def make_timeseries_csv(path: str, n: int):
    """Sensor-style time series with seasonal patterns."""
    print(f"  Generating timeseries:   {n:,} rows → {os.path.basename(path)}")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "sensor_id", "temperature", "humidity", "pressure", "anomaly"])
        sensors = [f"sensor_{i:03d}" for i in range(12)]
        base_ts = 1672531200
        for i in range(n):
            ts = base_ts + i * 60  # 1-minute intervals
            dt = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts))
            sensor = sensors[i % len(sensors)]
            hour_frac = (ts % 86400) / 86400.0
            seasonal = math.sin(hour_frac * 2 * math.pi) * 10
            temp = 20 + seasonal + random.gauss(0, 2)
            humidity = 55 + math.cos(hour_frac * 2 * math.pi) * 15 + random.gauss(0, 3)
            pressure = 1013.25 + random.gauss(0, 5)
            anomaly = 1 if random.random() < 0.02 else 0
            w.writerow([dt, sensor, round(temp, 2), round(humidity, 2), round(pressure, 2), anomaly])


def generate(size: str):
    os.makedirs(DATA_DIR, exist_ok=True)

    configs = {
        "small":   {"scatter": 1_000,     "sales": 500,       "timeseries": 2_000},
        "default": {"scatter": 100_000,   "sales": 50_000,    "timeseries": 200_000},
        "mega":    {"scatter": 5_000_000, "sales": 2_000_000, "timeseries": 5_000_000},
    }

    if size not in configs:
        print(f"Unknown size: {size}. Use: small, default, mega")
        sys.exit(1)

    c = configs[size]
    tag = "" if size == "default" else f"_{size}"

    print(f"\n🧵 Loom Data Generator — size={size}")
    print(f"   Output: {DATA_DIR}\n")

    t0 = time.time()

    make_scatter_csv(os.path.join(DATA_DIR, f"scatter{tag}.csv"), c["scatter"])
    make_sales_csv(os.path.join(DATA_DIR, f"sales{tag}.csv"), c["sales"])
    make_timeseries_csv(os.path.join(DATA_DIR, f"timeseries{tag}.csv"), c["timeseries"])

    elapsed = time.time() - t0
    total = sum(c.values())
    print(f"\n✓ Generated {total:,} total rows in {elapsed:.1f}s")
    print(f"  Mount .loom-data/ in Loom to explore.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Loom sample data generator")
    parser.add_argument("--size", default="default", choices=["small", "default", "mega"])
    args = parser.parse_args()
    generate(args.size)
