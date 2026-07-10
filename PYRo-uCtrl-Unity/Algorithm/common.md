Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_algo_common.h"/><Badge type = "info" text="pyro_algo_common.cpp"/>

# PYRo Algorithm Common

**机器人控制常用数学工具函数集**

提供角度规范化、单位换算、多项式求值、循环限幅等基础数学运算。所有函数均为 `pyro` 命名空间下的独立函数，零依赖（仅依赖 CMSIS-DSP `arm_math.h` 的 `PI` 常量），可直接在控制循环中内联使用。

------

## Part 1: 函数详解

### 1. `wrap2pi_f32(float input)`

将任意角度映射到 `(-2π, 2π)` 范围，使用 `std::fmod` 实现。

```c++
float angle = wrap2pi_f32(7.0f);  // → 7.0 - 2π ≈ 0.717
```

### 2. `radps_to_rpm(float radps)`

弧度/秒 → 转/分钟转换。系数 `9.5492966 = 60 / (2π)`。

```c++
float rpm = radps_to_rpm(104.72f);  // → ~1000 RPM
```

### 3. `calculate_angle_diff(float current, float target)`

计算两点间最短角距离（绝对值），自动处理圆周环绕。

```c++
float d = calculate_angle_diff(3.0f, -3.0f);  // → min(|6|, |2π-6|) ≈ 0.283
```

### 4. `evaluate_polynomial(float x, const float *coeffs, uint32_t degree)`

Horner 法多项式求值。`coeffs[0]` 为最高次系数。

```c++
float c[] = {2, 1, 3};  // 2x² + x + 3
float y = evaluate_polynomial(2.0f, c, 2);  // → 2*4 + 2 + 3 = 13
```

### 5. `mps_to_rpm(float mps, float radius)` / `rpm_to_mps(float rpm, float radius)`

线速度 ↔ 转速转换。内置 `radius < 1e-4` 防零除保护。

```c++
float rpm = mps_to_rpm(2.0f, 0.05f);  // 2m/s 在半径 5cm 轮上的转速
```

### 6. `loop_fp32_constrain(float val, float min, float max)`

循环限幅：将值限制在 `[min, max]` 区间，超出时通过加减区间长度回绕。适用于角度归一化等环形值域场景。

```c++
float a = loop_fp32_constrain(7.0f, -PI, PI);  // → 7.0 - 2π
```

------

## Part 2: 快速使用

```c++
#include "pyro_algo_common.h"

float target_radps = pyro::mps_to_rpm(target_mps, WHEEL_RADIUS) / 9.5492966f;
// 等价于:
float target_radps = target_mps / WHEEL_RADIUS;

float angle_error = pyro::calculate_angle_diff(current_yaw, desired_yaw);
float wrapped = pyro::wrap2pi_f32(raw_imu_angle);
```

## Q&A
