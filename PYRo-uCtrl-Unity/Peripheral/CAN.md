Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_bsp_can.h"/><Badge type = "info" text="pyro_bsp_can.cpp"/><Badge type = "info" text="pyro_can_drv.h"/><Badge type = "info" text="pyro_can_drv.cpp"/>

# PYRo CAN Driver

这是一个基于 STM32 HAL 库 **FDCAN (Flexible Data-rate CAN)** 外设的 CAN 总线通信驱动。该库采用 C++ 静态单例模式封装，提供线程安全的消息收发、消息缓冲区注册管理、总线离线自动恢复等功能，适用于机器人多节点实时通信场景。
> 嵌入式开发前置知识：了解 CAN 总线协议及 STM32 FDCAN 外设

## Part 1: 代码详解 (Code Explanation)

### 1. 核心设计理念

- **BSP + 驱动分层架构**: `can_drv_t` 负责核心 FDCAN 硬件操作和消息路由逻辑；`bsp_can` 作为板级支持层，管理 CAN1/CAN2/CAN3 三个硬件实例的创建与初始化。两者通过 `friend class` 解耦，外部代码只能通过 `bsp_can` 获取驱动实例，确保实例的唯一性和生命周期安全。

- **消息缓冲区注册机制 (`can_msg_buffer_t`)**: 每个需要接收 CAN 消息的模块创建自己的 `can_msg_buffer_t`，通过 ID 注册到 `can_drv_t` 的内部注册表 `_registerlist` 中。当硬件中断触发时，驱动根据消息 ID 查找对应的缓冲区并自动更新数据，实现"发布-订阅"式的消息分发。

### 2. 关键实现机制

#### A. 消息缓冲区 (`can_msg_buffer_t`)

- **线程安全的数据更新**: `update_data()` 放置于 `.itcm_text` 段（ITCM 零等待 RAM），通过 `taskENTER_CRITICAL_FROM_ISR()` / `taskEXIT_CRITICAL_FROM_ISR()` 保护中断上下文中的数据写入，确保与 RTOS 任务间的互斥访问。

- **新鲜度标记 (`_is_fresh`)**: 每次收到新消息时将 `_is_fresh` 置为 `true`，上层模块通过 `is_fresh()` 检查是否有新数据，处理完毕后调用 `mark_read()` 清除标记。这是一种轻量级的"数据就绪"通知机制，避免使用信号量带来的额外开销。

- **时间戳记录**: 在 `update_data()` 中自动记录 FreeRTOS 的系统 tick (`xTaskGetTickCountFromISR()`)，可通过 `get_last_update_time()` 查询最后一次收到该 ID 消息的时间，用于数据超时判断。

#### B. 驱动初始化 (`can_drv_t::init`)

- **滤波器配置**: 配置 FDCAN 为标准帧 (11-bit ID)、掩码模式、路由到 RX FIFO0。初始滤波器设置为全通过 (`FilterID1 = 0x00`)，实际的消息过滤由软件层的注册表完成，提供更灵活的动态注册/注销能力。

- **FIFO 水位线**: 设置 RX FIFO0 的水位线为 1，确保每收到一条消息就立即触发中断，保证实时性。

- **全局滤波器**: 拒绝所有非标准帧和远程帧，仅接收 Classic CAN 格式的标准数据帧。

#### C. 消息发送 (`can_drv_t::send_msg`)

- **总线离线恢复 (`recover_bus_off`)**: 发送前自动检测 Bus-Off 状态。若检测到总线离线，执行：中止所有待发送帧 → 停止 FDCAN → 清除错误码 → 重新启动 FDCAN → 重新激活通知。返回 `PYRO_BUSY` 表示恢复过程已触发，调用方可稍后重试。

- **TX FIFO 满处理**: 发送前检查 TX FIFO 空闲级别。若 FIFO 已满，中止所有待发送请求并返回 `PYRO_BUSY`，避免阻塞等待。

- **临界区保护**: 发送操作在 `taskENTER_CRITICAL()` 保护下执行，防止与中断处理函数竞争。

#### D. 中断处理与消息路由

- **全局回调 `HAL_FDCAN_RxFifo0Callback`**: 位于 `.itcm_text` 段以保证最快响应。从 RX FIFO0 读取消息后，验证帧类型为标准 Classic CAN 帧，然后通过静态 `can_map()` 查找对应的 `can_drv_t` 实例，调用 `handle_rx_msg()`。

- **`can_map()` 静态映射**: 维护 `FDCAN_HandleTypeDef* → can_drv_t*` 的全局映射表。每个 `can_drv_t` 实例在构造时自动注册到该映射中，析构时自动注销，使中断回调能够根据 HAL 句柄快速定位到对应的驱动实例。

- **`handle_rx_msg()`**: 在注册表中查找对应 ID 的 `can_msg_buffer_t`，若找到则调用其 `update_data()` 更新数据；否则返回 `PYRO_NOT_FOUND`（消息未被订阅，静默丢弃）。

#### E. BSP 层 (`bsp_can`)

- **静态单例 (`static` 局部变量)**: `get_can1()` / `get_can2()` / `get_can3()` 使用函数内 `static` 变量实现单例，保证每个 CAN 硬件实例全局唯一，且延迟初始化（首次调用时才构造）。

- **统一初始化 `init_all()`**: 一次性完成三个 CAN 实例的 `init()` + `start()`，使用 `CHECK_PYRO_RET` 宏快速失败——任一实例初始化失败立即返回错误码。

- **枚举访问 `get_can(which_can)`**: 提供基于枚举的统一访问接口，方便在配置驱动的代码中根据参数动态选择 CAN 实例。

## Part 2: 快速使用 (Quick Start)

### 1. 准备工作

确保您的工程基于 STM32 HAL 库，已正确配置 FDCAN 外设（包括时钟、引脚、波特率等），并在 `main.h` 或等效头文件中声明了 `extern FDCAN_HandleTypeDef hfdcan1/hfdcan2/hfdcan3`。

需要包含的头文件依赖：`fdcan.h`、`FreeRTOS.h`、`cmsis_os.h`。

### 2. 初始化

在 FreeRTOS 调度器启动之前（或首个使用 CAN 的任务中）调用初始化函数。

```C++
#include "pyro_bsp_can.h"

// 初始化全部三个 CAN 实例
if (PYRO_OK != pyro::bsp_can::init_all())
{
    // 初始化失败，进入错误处理
    Error_Handler();
}
```

### 3. 功能示例

#### 场景 A：发送 CAN 消息

```C++
void send_motor_command()
{
    uint8_t data[8] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07};

    pyro::can_drv_t &can = pyro::bsp_can::get_can1();
    pyro::status_t status = can.send_msg(0x200, data);

    if (PYRO_BUSY == status)
    {
        // 总线繁忙或正在恢复，稍后重试
    }
    else if (PYRO_OK != status)
    {
        // 发送失败，进入错误处理
    }
}
```

#### 场景 B：接收 CAN 消息（注册缓冲区）

```C++
#include "pyro_can_drv.h"

// 创建全局或模块级的消息缓冲区
static pyro::can_msg_buffer_t motor_fb_buffer(0x201); // 订阅 ID 0x201

void init_motor_feedback()
{
    pyro::can_drv_t &can = pyro::bsp_can::get_can1();

    // 注册缓冲区（重复注册同一 ID 会返回 PYRO_ERROR）
    can.register_rx_msg(&motor_fb_buffer);
}

void poll_motor_feedback()
{
    // 检查是否有新数据
    if (motor_fb_buffer.is_fresh())
    {
        std::array<uint8_t, 8> data;
        motor_fb_buffer.get_data(data);

        // 处理数据 ...
        // data[0], data[1], ...

        // 标记已读，等待下一条消息
        motor_fb_buffer.mark_read();
    }

    // 可选：检查数据是否超时
    TickType_t last_update = motor_fb_buffer.get_last_update_time();
    if (xTaskGetTickCount() - last_update > pdMS_TO_TICKS(100))
    {
        // 超过 100ms 未收到消息，可能离线
    }
}
```

#### 场景 C：动态选择 CAN 实例

```C++
void config_can_device(pyro::bsp_can::which_can bus)
{
    pyro::can_drv_t *can = pyro::bsp_can::get_can(bus);

    if (nullptr == can)
    {
        // 无效的 CAN 实例
        return;
    }

    // 使用 can 进行后续操作...
    can->register_rx_msg(&my_buffer);
}
```

### 4. 注意事项 (Caveats)

1. **缓冲区 ID 唯一性**: 同一个 `can_drv_t` 实例中，每个 ID 只能注册一个 `can_msg_buffer_t`。重复注册会返回 `PYRO_ERROR`。若多个模块需要接收同一 ID 的消息，请在应用层自行分发。

2. **缓冲区生命周期**: `register_rx_msg()` 仅存储指针，不接管内存所有权。注册的 `can_msg_buffer_t` 对象必须在驱动实例存活期间保持有效（建议定义为全局/静态变量），否则中断回调访问悬空指针将导致未定义行为。

3. **中断上下文**: `handle_rx_msg()` 和 `update_data()` 在 FDCAN 中断回调中执行。这两个函数已做了临界区保护和高性能优化（ITCM），但仍应避免注册过多的缓冲区（上限 `MAX_ID_REGIST_NUM = 32`），以控制中断处理时间。

4. **总线离线恢复**: 当 CAN 总线发生 Bus-Off 时，驱动会自动尝试恢复。恢复期间 `send_msg()` 返回 `PYRO_BUSY`，调用方应实现重试逻辑而非直接报错。

5. **仅支持标准帧**: 当前驱动仅处理 11-bit 标准 ID 的 Classic CAN 数据帧。扩展帧 (29-bit) 和 CAN FD 帧会被全局滤波器拒绝。


## Q&A