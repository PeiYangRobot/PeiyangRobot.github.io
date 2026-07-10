Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_bsp_uart.h"/><Badge type = "info" text="pyro_bsp_uart.cpp"/><Badge type = "info" text="pyro_uart_drv.h"/><Badge type = "info" text="pyro_uart_drv.cpp"/>
# PYRo UART Driver

**基于 STM32H7 HAL 库与 FreeRTOS 的 C++ 串口驱动**

该模块 (`pyro_uart_drv`) 解决 C++ 对象与底层 C 语言中断（ISR）的交互问题。它采用 DMA 双缓冲机制实现不定长数据的高效接收，将底层中断与上层业务逻辑完全解耦，并针对 FreeRTOS 的任务调度进行了适配。

> 语法前置知识：了解Lambda表达式、std::function、std::map、std::vector的基础概念，局部静态变量的初始化机制，单例模式的实现原理。
> 嵌入式开发前置知识：熟悉 STM32 系列的 UART 外设及其 HAL 库使用。

## Part 1: 代码全解 (Code Deep Dive)

### 1. 核心架构与内存策略

#### 1.1 内存分配接口

为确保接收缓冲区位于 DMA 可访问的内存区域（非 DTCM），构造函数摒弃了标准的 `new`，转而调用 `pvPortDmaMalloc` 分配双缓冲区。

> **注意**：具体的内存区域划分及 `.dma_heap` 的链接脚本配置，请参阅项目内的 Core/Memory。

#### 1.2 静态映射 (Static Map) 与 BSP 隔离

HAL 库的中断回调（如 `HAL_UART_RxCpltCallback`）属于全局 C 符号，无法直接访问 C++ 类的 `this` 指针。本驱动引入了 **“句柄-实例映射表”** 机制：

- **实现原理**：封装一个静态 `std::map`，键为 `UART_HandleTypeDef*`，值为 `uart_drv_t*`。
- **注册流程**：由于驱动的构造函数是私有的，只允许通过板级支持包 (`bsp_uart`) 获取实例并触发首次构造。构造函数执行时，会自动将当前的 HAL 句柄与 `this` 指针注册到 Map 中。
- **查找流程**：中断触发时，ISR 通过传入的 HAL 句柄在 Map 中查找对应的驱动实例。

### 2. 接收回调系统详解 (Callback System Internals)

这是驱动最核心的业务解耦机制，允许上层应用注册多个回调函数处理同一数据流。

#### 2.1 存储结构与类型擦除

驱动内部使用 `std::vector` 维护回调列表。为了同时支持 **普通函数**、**静态成员函数** 和 **Lambda 表达式（闭包）**，使用了 `std::function` 进行类型擦除。

> **回调函数** ：所有回调必须符合 `rx_event_func` 的签名，接受数据指针、长度和 FreeRTOS 的上下文切换标志引用，并返回 `bool` 表示是否消费了数据。一般地，函数内通过判断数据帧特征（如长度、帧头等）来决定是否处理该数据，处理后返回 `true` 阻止后续回调获取。

```c++
// 定义回调签名：支持返回 bool 用于中断冒泡控制
using rx_event_func = std::function<bool(uint8_t *p, uint16_t size, BaseType_t& xHigherPriorityTaskWoken)>;

typedef struct rx_event_callback_t
{
    uint32_t owner;     // 唯一标识符（通常为调用者的 this 指针）
    rx_event_func func; // 存储实际的调用目标
} rx_event_callback_t;
```

#### 2.2 注册与移除机制 (`add/remove`)

由于 `std::function` 对象本身不支持相等性比较（`operator==`），无法直接通过函数对象来删除回调。因此，设计了 `owner` ID 机制：

- **注册 (`add_rx_event_callback`)**：用户传入 `func` 的同时，必须传入一个 `owner`（通常是 `this` 的地址）。驱动将两者打包存入 vector。
- **移除 (`remove_rx_event_callback`)**：通过遍历 vector 匹配 `owner` 字段，找到对应的回调并擦除。这解决了 C++ 回调难以注销的痛点。

### 3. 数据流与中断处理 (ISR Workflow)

#### 3.1 DMA 双缓冲逻辑

为了实现无缝接收，驱动维护了两个缓冲区指针 `rx_buf[2]` 和一个索引 `rx_buf_switch`。

当发生 IDLE 中断（一帧结束）或 DMA 传输完成时：

1. 当前缓冲区被锁定，数据传给回调处理。
2. 缓冲区切换：`rx_buf_switch ^= 0x01U`。
3. 立即使用新缓冲区重启 DMA。

#### 3.2 全局中断回调 (`HAL_UARTEx_RxEventCallback`)

这是数据分发的枢纽，其执行流程如下：

1. **上下文查找**：通过 `huart` 在 Map 中找到 `uart_drv_t` 实例。
2. **回调遍历**：依次执行注册的 `rx_event_callbacks`。
3. **消费机制**：如果某个回调返回 `true`，表示数据已被该模块消费，循环终止，不再传递给后续回调。
4. **任务唤醒**：回调中修改 `xHigherPriorityTaskWoken`，若置位，ISR 退出时将调用 `portYIELD_FROM_ISR` 触发 FreeRTOS 上下文切换，保证高优先级任务即时响应。

#### 3.3 自动错误恢复

本驱动重写了 `HAL_UART_ErrorCallback`，在检测到错误时自动清除标志位（如 `UART_CLEAR_PEF | UART_CLEAR_FEF` 等）并强制重启 DMA 接收，实现了硬件错误的“自愈”。

## Part 2: 快速上手 (Quick Start)

### 1. 硬件初始化与获取实例

驱动的实例获取与核心逻辑现已隔离。你可以通过板级支持包 `pyro::bsp_uart` 直接获取特定硬件外设的单例引用。

```c++
#include "pyro_bsp_uart.h"

// [可选] 在系统启动阶段，可以一次性初始化并启动所有注册的串口 DMA 接收
pyro::bsp_uart::init_all();

// 获取 UART1 的驱动单例引用
pyro::uart_drv_t &uart1 = pyro::bsp_uart::get_uart1();
```

如果你包含了pyro_core_config.h，可以直接使用其宏定义PYRO_UARTx来获取实例：

```c++
#include "pyro_core_config.h"
// 获取 UART1 的驱动单例引用
PYRO_UART1; // 等价于 pyro::bsp_uart::get_uart1();
PYRO_UART2.write(...); // 直接使用实例调用方法

```

### 2. 注册接收回调 (推荐模式)

利用 C++ Lambda 表达式捕获 `this` 指针，将类的成员函数注册为回调。
在不需要额外传参的情况下也可以直接注册静态函数或 `std::function` 类型的变量。

> **Tip**：回调函数必须符合 `rx_event_func` 的签名，返回 `bool` 用于控制数据流向。
> **Warning**：注册的回调会在硬件回调中执行，请勿注册长耗时函数或包含延时等。

```c++
void RC_Receiver::init() {
    auto &uart_drv = pyro::bsp_uart::get_uart1();
    
    // 注册回调
    uart_drv.add_rx_event_callback(
        // Lambda 捕获 this，调用成员函数
        [this](uint8_t *buf, uint16_t len, BaseType_t &xHigherPriorityTaskWoken) -> bool {
            return this->parse_data(buf, len, xHigherPriorityTaskWoken);
        },
        reinterpret_cast<uint32_t>(this) // 传入 Owner ID (this) 用于后续移除
    );
    
    // 若未调用过 bsp_uart::init_all()，请务必显式开启 DMA 接收
    uart_drv.enable_rx_dma();
}

bool RC_Receiver::parse_data(uint8_t *buf, uint16_t len, BaseType_t &xHigherPriorityTaskWoken) {
    // 处理逻辑...
    return true; // 返回 true 表示数据已处理，阻止后续回调获取
}
```

### 3. 数据发送

支持阻塞（Polling）与非阻塞（DMA）两种模式。注意，由于获取到的是实例的引用，调用方法需使用 `.` 运算符。

```c++
// 模式 A: DMA 非阻塞发送 (适用于高频发送)，需要注意tx_buf必须位于DMA的内存段（见PYRo/Core/Memory下的README.md）
uart1.write(tx_buf, sizeof(tx_buf));

// 模式 B: 阻塞发送 (适用于初始化或低频调试)
// 第三个参数为超时时间 (ms)
uart1.write(tx_buf, sizeof(tx_buf), 100);
```

### 4. 资源释放

当模块销毁时，移除对应的回调以避免野指针访问。

```c++
// 使用注册时传入的 ID 进行移除
uart1.remove_rx_event_callback(reinterpret_cast<uint32_t>(this));
```

## Q&A