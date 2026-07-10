Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_dwt_drv.h"/><Badge type = "info" text="pyro_dwt_drv.cpp"/>

# PYRo DWT Driver (High-Resolution Timer)

这是一个基于 ARM Cortex-M 核心 **DWT (Data Watchpoint and Trace)** 外设的高精度计时器驱动。该库采用 C++ 静态类封装，利用 CPU 的 `CYCCNT` 寄存器提供纳秒级的时间测量、阻塞延时以及系统运行时间统计功能。

> 嵌入式开发前置知识：了解 DWT 外设

## Part 1:代码详解 (Code Explanation)

### 1. 核心设计理念

- **静态类封装 (`Static Class`)**: `pyro::dwt_drv_t` 被设计为纯静态类（构造函数被 `delete`）。这是因为 DWT 是唯一的硬件资源，全局只需要一个实例来管理，避免了对象实例化的开销和多实例冲突。

### 2. 关键实现机制

#### A. 初始化 (`init`)

- **启用外设**: 直接操作寄存器开启 `CoreDebug->DEMCR` 和 `DWT->CTRL`，使能 `CYCCNT` 计数器。
- **频率预算**: 在初始化时将传入的 `cpu_freq_mhz` 转换为 Hz、kHz、MHz 的整型变量存储 (`_cpu_freq_hz` 等)，避免在运行时进行昂贵的浮点除法运算，提高 `delay` 和 `get_timeline` 的效率。

#### B. 增量时间测量 (`get_delta_t`)

- **溢出处理**: DWT 计数器是 32 位的。驱动利用了无符号整数 (`uint32_t`) 减法的回绕特性。
  - 即使 `cnt_now` (当前值) 小于 `cnt_last` (上次值) —— 即发生了溢出，`cnt_now - *cnt_last` 仍然能得到正确的 tick 差值（前提是两次采样间隔不超过 32 位计数器的最大周期（480MHz下约为8.94s））。
- **指针更新**: 函数接收 `uint32_t *cnt_last` 指针，计算完差值后自动更新该变量，方便循环调用。

#### C. 全局时间轴 (`get_timeline_*`)

- **软件扩展 64 位**: DWT 硬件只有 32 位。为了统计系统启动后的总时间，驱动内部维护了 `_cyccnt_round_count` (溢出次数) 和 `_cyccnt_64` (总周期数)。
- **逻辑**: `update_cycle_count()` 比较当前计数值与上一次记录的值。如果当前值变小了，说明发生了一次溢出，圈数 +1。

#### D. 精确延时 (`delay_s`, `delay_us`)

- **实现**: 阻塞延时
- **计算**: `目标 ticks = 时间 * 频率`。通过 `while` 循环不断查询 `DWT->CYCCNT` 直到差值达到目标 ticks。

## Part 2:快速使用 (Quick Start)

### 1. 准备工作

确保您的工程是基于 ARM Cortex-M (M3/M4/M7) 架构，并且已经包含了对应的 CMSIS 头文件（代码中引用了 `main.h`，请确保其中包含 `stm32xxxx.h` 或 `core_cmx.h` 以访问 `CoreDebug` 和 `DWT` 结构体）。

### 2. 初始化

在 `main` 函数的最开始（时钟配置完成后）调用初始化函数。

```c++
#include "pyro_dwt_drv.h"

int main()
{
    // 假设系统时钟配置为 480 MHz
    // 必须首先调用 init，否则 DWT 计数器不会启动
    pyro::dwt_drv_t::init(480); 

    while (1)
    {
        // loop
    }
}
```

### 3. 功能示例

#### 场景 A：测量间隔时间

这是 DWT 最常用的功能，用于测试算法耗时。

```c++
void test_algorithm_performance()
{
    // 1. 获取当前 tick 作为基准
    uint32_t last_tick = pyro::dwt_drv_t::get_current_ticks();

    // 2. 运行待测代码
    // . . .

    // 3. 计算耗时 (秒) 并自动更新 last_tick
    float elapsed_sec = pyro::dwt_drv_t::get_delta_t(&last_tick);
}
```

#### 场景 B：高精度阻塞延时

替代不准的 `HAL_Delay` 或空循环。

```c++
void sensor_read_sequence()
{
    // 拉低引脚
    set_gpio_low();
    
    // 精确延时 10 微秒
    pyro::dwt_drv_t::delay_us(10);
    
    // 拉高引脚
    set_gpio_high();
    
    // 延时 0.5 秒
    pyro::dwt_drv_t::delay_s(0.5f);
}
```

#### 场景 C：获取系统运行总时间 (Timestamp)

获取自 `init()` 调用以来的总时间。

```c++
void log_status()
{
    // 获取时间结构体 (s, ms, us)
    auto sys_time = pyro::dwt_drv_t::get_timeline();
           
    // 或者直接获取浮点数毫秒
    float total_ms = pyro::dwt_drv_t::get_timeline_ms();
}
```

### 4. 注意事项 (Caveats)

1. **时间轴维护**: `get_timeline` 系列函数依赖于轮询来检测计数器溢出。如果您的程序长时间（超过 1 个溢出周期，例如 480MHz CPU 下约 8.94 秒）没有调用任何 `timeline` 相关接口，时间轴计算可能会丢失圈数。

## Q&A