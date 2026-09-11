Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_bsp_can.h"/><Badge type = "info" text="pyro_bsp_can.cpp"/><Badge type = "info" text="pyro_can_drv.h"/><Badge type = "info" text="pyro_can_drv.cpp"/>

# PYRo CAN Driver

这是一个基于 STM32 HAL 库 **FDCAN (Flexible Data-rate CAN)** 外设的 CAN 总线通信驱动。该库采用 C++ 静态单例模式封装，提供线程安全的消息收发、消息缓冲区注册管理、总线离线自动恢复等功能，适用于机器人多节点实时通信场景。

CAN 驱动位于 `PYRo/Peripheral/CAN`，向上层（电机、功率计、板间通信等）提供**统一的经典 CAN 收发抽象**。

> 嵌入式开发前置知识：了解 CAN 总线协议及 STM32 FDCAN 外设

## Part 1: 代码详解 (Code Explanation)

### 1. 核心设计理念

- **解耦硬件**：业务层只与 `can_drv_t` / `can_msg_buffer_t` 交互，不直接触碰 HAL 与寄存器。

- **BSP + 驱动分层架构**: `can_drv_t` 负责核心 FDCAN 硬件操作和消息路由逻辑；`bsp_can` 作为板级支持层，管理 CAN1/CAN2/CAN3 三个硬件实例的创建与初始化。两者通过 `friend class` 解耦，外部代码只能通过 `bsp_can` 获取驱动实例，确保实例的唯一性和生命周期安全。

- **消息缓冲区注册机制 (`can_msg_buffer_t`)**: 每个需要接收 CAN 消息的模块创建自己的 `can_msg_buffer_t`，通过 ID 注册到 `can_drv_t` 的内部注册表 `_registerlist` 中。所有 CAN 硬件中断回调统一收口到本模块，再按报文 ID 派发到各订阅缓冲。当硬件中断触发时，驱动根据消息 ID 查找对应的缓冲区并自动更新数据，实现"发布-订阅"式的消息分发。

### 2. 接收链路：ISR → 缓冲 → 应用

以某电机反馈帧（如 0x201）为例，一次接收的生命周期如下：

```Graph
FDCAN Rx FIFO0 产生中断
        │
        ▼
HAL 中断服务例程 (stm32h7xx_it.c)
        │ 调用弱函数
        ▼
HAL_FDCAN_RxFifo0Callback(hfdcan, RxFifo0ITs)      [本库重定义, 置于 .itcm_text]
        │ HAL_FDCAN_GetRxMessage() 读出 RxHeader + data[8]
        │ 仅当 经典帧(RxFrameType==CLASSIC) 且 标准ID(IdType==STANDARD_ID) 才继续
        ▼
can_global_handle(hfdcan, identifier, data)
        │ can_map().exist(hfdcan)?   // 通过句柄反查驱动实例
        ▼
can_drv_t::handle_rx_msg(identifier, data)
        │ _registerlist.exist(id)?   // 订阅表查询
        ▼
can_msg_buffer_t::update_data(data)  // 临界区写缓冲 + 置 fresh
```

应用侧（控制任务）按需轮询对应缓冲：

```cpp
std::array<uint8_t,8> data;
if (buf.is_fresh() && buf.get_data(data)) {   // 有新鲜数据且拷贝成功
    buf.mark_read();                          // 手动确认消费
    // 解析 data[0..7] 得到位置 / 转速 / 扭矩 ...
}
```

**关键约定**：
- 接收回调只接受**经典标准数据帧**（`FDCAN_FRAME_CLASSIC` + `FDCAN_STANDARD_ID`），其余帧（扩展帧、FD 帧、远程帧）在硬件过滤或软件判断中被丢弃；
- 硬件中断里只做“拷贝 + 置标志”，真正的协议解析/控制放在任务上下文，避免中断中做重活；
- 多缓冲可共享同一驱动：每路业务（电机、板间指令、功率计）各自持有 `can_msg_buffer_t` 并 `register_rx_msg`，互不阻塞。

### 3. 发送链路与帧格式

`can_drv_t::send_msg(id, data)` 为发送入口，发送固定格式的 **8 字节经典标准帧**：

| 帧字段                | 取值                 | 说明              |
| --------------------- | -------------------- | ----------------- |
| `IdType`              | `FDCAN_STANDARD_ID`  | 标准 11 位 ID     |
| `TxFrameType`         | `FDCAN_DATA_FRAME`   | 数据帧            |
| `DataLength`          | `FDCAN_DLC_BYTES_8`  | 8 字节            |
| `BitRateSwitch`       | `FDCAN_BRS_OFF`      | 非 FD（单波特率） |
| `FDFormat`            | `FDCAN_CLASSIC_CAN`  | 经典 CAN          |
| `ErrorStateIndicator` | `FDCAN_ESI_ACTIVE`   | —                 |
| `TxEventFifoControl`  | `FDCAN_NO_TX_EVENTS` | 不写 TX 事件 FIFO |

发送前处理（内部）：
1. 空指针（`_hfdcan` / `data`）→ `PYRO_PARAM_ERROR`；
2. 若外设状态非 `HAL_FDCAN_STATE_BUSY` → `PYRO_BUSY`（驱动认为尚未就绪）；
3. 调用 `recover_bus_off()` 处理总线关闭自恢复；
4. 进入临界区：先检查 `HAL_FDCAN_GetTxFifoFreeLevel()`，若 TX FIFO 已满则 `abort_pending_tx()` 抢占中止挂起帧并返回 `PYRO_BUSY`；
5. `HAL_FDCAN_AddMessageToTxFifoQ()` 入队；若 HAL 报错且置了 `HAL_FDCAN_ERROR_FIFO_FULL`，同样中止后返回 `PYRO_BUSY`，否则返回 `PYRO_ERROR`；
6. 正常返回 `PYRO_OK`。

> **发送不阻塞**：调用只是把帧放入硬件 TX FIFO，真正的仲裁发送由 CAN 控制器完成。因此在控制循环中即使任务被抢占也不丢帧，但需注意 FIFO 深度，过量填充会触发 abort。

### 4. 关键实现机制

#### A. 消息缓冲区 (`can_msg_buffer_t`)

- **线程安全的数据更新**: `update_data()` 放置于 `.itcm_text` 段（ITCM 零等待 RAM），通过 `taskENTER_CRITICAL_FROM_ISR()` / `taskEXIT_CRITICAL_FROM_ISR()` 保护中断上下文中的数据写入，确保与 RTOS 任务间的互斥访问。

- **新鲜度标记 (`_is_fresh`)**: 每次收到新消息时将 `_is_fresh` 置为 `true`，上层模块通过 `is_fresh()` 检查是否有新数据，处理完毕后调用 `mark_read()` 清除标记。这是一种轻量级的"数据就绪"通知机制，避免使用信号量带来的额外开销。

- **时间戳记录**: 在 `update_data()` 中自动记录 FreeRTOS 的系统 tick (`xTaskGetTickCountFromISR()`)，可通过 `get_last_update_time()` 查询最后一次收到该 ID 消息的时间，用于数据超时判断。

##### 使用说明

一个 `can_msg_buffer_t` 代表**一条固定 CAN ID 的接收缓冲**，通过构造传入监听的标准 ID：

```cpp
explicit can_msg_buffer_t(uint32_t id);
```

内部状态：
| 成员                | 类型                    | 说明                                          |
| ------------------- | ----------------------- | --------------------------------------------- |
| `_id`               | `uint32_t`              | 监听的报文 ID                                 |
| `_buffer`           | `std::array<uint8_t,8>` | 8 字节数据缓存              |
| `_is_fresh`         | `volatile bool`         | 是否有“尚未消费”的新数据                      |
| `_last_update_time` | `volatile TickType_t`   | 最近一次写入时刻（FreeRTOS tick，ISR 中记录） |

关键方法语义：
| 方法 | 调用方 | 作用 |
| - | - | - |
| `void update_data(data)`  | **ISR 回调** | 在 `taskENTER_CRITICAL_FROM_ISR()` 临界区内 `memcpy` 8 字节、写时间戳、置 `_is_fresh=true`；实现置于 `.itcm_text`（ITCM RAM）加速 |
| `bool get_data(data)`     | 应用任务     | 在临界区内拷贝数据，**返回 fresh 状态但不清除 |
| `bool is_fresh()`         | 应用任务     | 查询是否有新数据，`true`表示有新数据，`false`表示无新数 |
| `void mark_read()`        | 应用任务     | 消费后手动清除 fresh 标志 |
| `uint32_t get_id()`|应用任务|读取 ID |
|`TickType_t get_last_update_time()`|应用任务|返回最近更新时间|

::: tip
`get_data()` 与 `is_fresh()` 分离，由业务层决定何时 “确认已读”。典型范式为
```C++
if(buf.is_fresh())
    if(buf.get_data(data))
        buf.mark_read();
```
:::

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

::: tip

为避免有任务使用CAN时本模块还未初始化，建议在初始化任务（init_thread）中提前完成初始化和各总线单例的创建。

```cpp
// pyro_init_thread.cpp
#include "pyro_bsp_can.h"
...
namespace pyro {
...
can_drv_t *can1_drv;
can_drv_t *can2_drv;
can_drv_t *can3_drv;
...
void pyro_init_thread(void *argument) {
    ...
    //初始化所有 CAN 总线
    bsp_can::init_all();
    can1_drv = &bsp_can::get_can1();
    can2_drv = &bsp_can::get_can2();
    can3_drv = &bsp_can::get_can3();
    ...
}

} // namespace pyro
```

:::


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

### 4. API 速查表

#### A `can_msg_buffer_t`

| 方法                   | 签名                            | 说明                       |
| ---------------------- | ------------------------------- | -------------------------- |
| 构造                   | `can_msg_buffer_t(uint32_t id)` | 创建监听 `id` 的接收缓冲   |
| `get_id`               | `uint32_t`                      | 返回监听 ID                |
| `is_fresh`             | `bool`                          | 是否有未消费新数据         |
| `mark_read`            | `void`                          | 清除 fresh 标志            |
| `update_data`          | `void(const uint8_t*)`          | （ISR）写 8 字节并置 fresh |
| `get_data`             | `bool(std::array<uint8_t,8>&)`  | 拷贝数据并返回 fresh 状态  |
| `get_last_update_time` | `TickType_t`                    | 最近写入 tick              |

#### B `can_drv_t`（经 `bsp_can::get_canX()` 获取）

| 方法              | 签名                                    | 说明                              |
| ----------------- | --------------------------------------- | --------------------------------- |
| `init`            | `status_t()`                            | 配置过滤器 / 全局过滤 / FIFO 水位 |
| `start`           | `status_t()`                            | 启动外设 + 激活 RX/错误通知       |
| `send_msg`        | `status_t(uint32_t id, const uint8_t*)` | 发送 8 字节经典标准帧             |
| `register_rx_msg` | `status_t(can_msg_buffer_t*)`           | 订阅一个接收 ID（去重）           |
| `handle_rx_msg`   | `status_t(uint32_t, const uint8_t*)`    | （ISR）按 ID 派发到缓冲           |
| `can_map`         | `map_t<FDCAN*,can_drv_t*>&`             | 总线实例注册表                    |

#### C `bsp_can`

| 方法                                   | 说明                                   |
| -------------------------------------- | -------------------------------------- |
| `get_can1() / get_can2() / get_can3()` | 返回三条总线驱动引用                   |
| `get_can(which_can)`                   | 按枚举返回指针（未命中返回 `nullptr`） |
| `init_all()`                           | 依次 `init + start` 三条总线           |

#### D 状态码说明

`status_t` 定义在 `PYRo/Core/Def/pyro_core_def.h`：

| 状态码              | 值   | 在本模块中出现位置                           |
| ------------------- | ---- | -------------------------------------------- |
| `PYRO_OK`           | 0x00 | 成功                                         |
| `PYRO_ERROR`        | 0x01 | 配置失败 / 注册冲突 / HAL 报错               |
| `PYRO_BUSY`         | 0x02 | 外设未就绪 / TX FIFO 满中止 / Bus-Off 恢复中 |
| `PYRO_TIMEOUT`      | 0x03 | （未使用）                                   |
| `PYRO_NO_MEMORY`    | 0x04 | （未使用）                                   |
| `PYRO_PARAM_ERROR`  | 0x05 | 传入空指针等非法参数                         |
| `PYRO_NOT_FOUND`    | 0x06 | `handle_rx_msg` 未订阅该 ID                  |
| `PYRO_WARNING`      | 0x07 | （未使用）                                   |
| `PYRO_ALREADY_INIT` | 0x08 | （未使用）                                   |

`register_rx_msg` 重复注册返回 `PYRO_ERROR`（无 `PYRO_ALREADY_INIT` 语义）。

### 5. 注意事项 (Caveats)

1. **缓冲区 ID 唯一性**: 同一个 `can_drv_t` 实例中，每个 ID 只能注册一个 `can_msg_buffer_t`。重复注册会返回 `PYRO_ERROR`。若多个模块需要接收同一 ID 的消息，请在应用层自行分发。

2. **缓冲区生命周期**: `register_rx_msg()` 仅存储指针，不接管内存所有权。注册的 `can_msg_buffer_t` 对象必须在驱动实例存活期间保持有效（建议定义为全局/静态变量），否则中断回调访问悬空指针将导致未定义行为。

3. **中断上下文**: `handle_rx_msg()` 和 `update_data()` 在 FDCAN 中断回调中执行。这两个函数已做了临界区保护和高性能优化（ITCM），但仍应避免注册过多的缓冲区（上限 `MAX_ID_REGIST_NUM = 32`），以控制中断处理时间。

4. **总线离线恢复**: 当 CAN 总线发生 Bus-Off 时，驱动会自动尝试恢复。恢复期间 `send_msg()` 返回 `PYRO_BUSY`，调用方应实现重试逻辑而非直接报错。

5. **仅支持标准帧**: 当前驱动仅处理 11-bit 标准 ID 的 Classic CAN 数据帧。扩展帧 (29-bit) 和 CAN FD 帧会被全局滤波器拒绝。


## Q&A