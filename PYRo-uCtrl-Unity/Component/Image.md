Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_image_drv.h"/><Badge type = "info" text="pyro_image_drv.cpp"/>

# PYRo Image Driver

**基于 FreeRTOS 消息缓冲区的 RoboMaster 图传链路驱动**

该 `pyro_image_drv` 模块实现了与 RoboMaster 图传模块的双向通信。采用轻量级命令码白名单订阅机制进行接收过滤，发送侧使用零拷贝 DMA 整包缓冲区实现高效数据下发，适用于机器人端与自定义控制器/客户端之间的低开销数据交互。

> 嵌入式开发前置知识：了解 RoboMaster 裁判系统通信协议 (0xA5 帧头格式)、STM32 UART DMA 传输、FreeRTOS 消息缓冲区

## Part 1: 代码全解 (Code Deep Dive)

### 1. 核心设计理念

- **轻量级白名单订阅**: 图传链路指令数量极少（最多订阅 4 个命令码），驱动不使用复杂的哈希表或 `std::bitset<1024>`，而是通过固定大小的数组线性遍历匹配，在 `N ≤ 4` 的条件下性能远优于大体积数据结构。
- **零拷贝 DMA 发送**: 发送帧的帧头、负载、CRC 分布在同一个 `packet_t` 结构体中，该结构体内存通过 `pvPortDmaMalloc()` 分配在 DMA 可访问区域，应用层直接填充 payload 后调用 `send()` 即可触发 DMA 传输，全程无 `memcpy`。
- **ISR → Task 消息传递**: UART 接收中断通过 FreeRTOS Message Buffer 将整帧数据传递给 `image_task_t` 任务，在任务上下文中完成 CRC 校验与帧解析。

### 2. 数据结构与协议编解码

驱动内部通过 `#pragma pack(push, 1)` 确保数据包结构体紧凑对齐（1 字节对齐），完整数据包由帧头 + 命令码 + 负载 + CRC16 组成：

```c++
// pyro_image_drv.h
#pragma pack(push, 1)
struct tx_controller_packet_t
{
    frame_header_t header;           // SOF(1) + data_length(2) + seq(1) + crc8(1) = 5字节
    uint16_t cmd_id;                 // 0x0309: 机器人→自定义控制器
    tx_controller_payload_t payload; // 30 字节负载
    uint16_t crc16;                  // 全帧校验
};

struct tx_client_packet_t
{
    frame_header_t header;
    uint16_t cmd_id;                 // 0x0310: 机器人→自定义客户端
    tx_client_payload_t payload;     // 300 字节负载
    uint16_t crc16;
};
#pragma pack(pop)
```

**关键数据段容量差异**: 控制器数据负载仅 30 字节，而客户端数据负载高达 300 字节。两者使用独立的 DMA 缓冲区避免互相干扰。

### 3. 订阅机制与 ISR 接收拦截

初始化时通过 `init({cmd_id::CUSTOM_CONTROLLER, ...})` 注册白名单。ISR 回调中执行零堆分配的最小化检查：

```c++
// pyro_image_drv.cpp — rx_callback (ISR 上下文)
bool image_drv_t::rx_callback(const uint8_t *p, uint16_t size, BaseType_t &task_woken) const
{
    // 1. 快速通道：长度不足时直接丢弃
    if (size < HEADER_SIZE || p[0] != HEADER_SOF) return false;
    if (size < HEADER_SIZE + 2) return true;

    // 2. 解析 CMD_ID
    uint16_t cmd_id_val = p[5] | (static_cast<uint16_t>(p[6]) << 8);

    // 3. O(N) 遍历白名单过滤 (N ≤ 4)
    bool is_subscribed = false;
    for (uint8_t i = 0; i < _subscribed_count; ++i)
    {
        if (_subscribed_ids[i] == cmd_id_val) { is_subscribed = true; break; }
    }
    if (!is_subscribed) return true; // 是 0xA5 但未订阅，静默丢弃

    // 4. 整帧入队到 Task
    if (size >= total_len && _rx_msg_buf != nullptr)
        xMessageBufferSendFromISR(_rx_msg_buf, p, total_len, &task_woken);
    return true;
}
```

### 4. 任务循环与帧校验

`image_task_t` 以 100ms 超时阻塞接收帧数据，通过双重 CRC 级联验证确保数据完整性：

```c++
void image_drv_t::task_loop()
{
    uint8_t frame_temp[MAX_FRAME_LEN];
    while (true)
    {
        size_t recv_len = xMessageBufferReceive(_rx_msg_buf, frame_temp, MAX_FRAME_LEN, pdMS_TO_TICKS(100));
        if (recv_len > 0)
        {
            // 双重校验：头部 CRC8 + 全帧 CRC16
            if (verify_crc8_check_sum(frame_temp, HEADER_SIZE) &&
                verify_crc16_check_sum(frame_temp, recv_len))
            {
                solve_frame(frame_temp, static_cast<uint16_t>(recv_len));
            }
        }
        // 超时检测：500ms 未收到数据即离线
        if (dwt_drv_t::get_timeline_ms() - _last_update_time > 500.0f)
            _is_online = false;
    }
}
```

### 5. 零拷贝发送流水线

应用层直接操作 DMA 缓冲区中的 payload 字段，无需额外拷贝。`send_controller_data()` / `send_client_data()` 负责补全帧头、CRC 并触发 DMA 发送：

```c++
// 应用层使用示例：
auto &image = pyro::image_drv_t::get_instance();
auto &tx_data = image.get_controller_tx_data();  // 获取 DMA 区 payload 引用
tx_data.data[0] = 0x01;                           // 直接赋值
tx_data.data[1] = 0x02;
image.send_controller_data();                     // 补全帧头+CRC → DMA发送
```

`send_controller_data()` 内部执行顺序：写 SOF → 写 data_length → 写 seq → 计算头部 CRC8 → 写 cmd_id → 计算全帧 CRC16 → `_uart->write()` → 失败时回退 `_send_seq`。

## Part 2: 快速上手 (Quick Start)

### 1. 初始化（默认订阅）

若只需使用图传内置的自定义控制器 (0x0302) 和自定义客户端指令 (0x0311)，调用无参 `init()` 即可：

```c++
#include "pyro_image_drv.h"

void init_image_link()
{
    auto &image = pyro::image_drv_t::get_instance();

    // 默认订阅: 0x0302 (自定义控制器) + 0x0311 (自定义客户端指令)
    image.init();

    // 启动接收任务
    image.start();
}
```

### 2. 初始化（自定义订阅列表）

若需要订阅额外的图传下行命令（如小地图交互等），使用 `init({...})` 显式指定：

```c++
image.init({
    pyro::cmd_id::CUSTOM_CONTROLLER,
    pyro::cmd_id::TINY_MAP_INTERACT,    // 0x0303 小地图交互
    static_cast<pyro::cmd_id>(0x0311)   // 自定义客户端指令
});
```

### 3. 接收数据

```c++
void poll_image_rx()
{
    auto &image = pyro::image_drv_t::get_instance();

    if (image.is_online())
    {
        // 读取自定义控制器发来的数据 (0x0302, 有效负载最大 30 字节)
        const uint8_t *ctrl_data = image.get_controller_rx_data();
        uint8_t cmd_byte = ctrl_data[0];

        // 读取自定义客户端发来的指令 (0x0311, 有效负载最大 30 字节)
        const uint8_t *client_cmd = image.get_client_rx_cmd_data();
    }
}
```

### 4. 发送数据

```c++
void send_to_client()
{
    auto &image = pyro::image_drv_t::get_instance();

    // 填充客户端数据 (300 字节可用)
    auto &tx = image.get_client_tx_data();
    tx.data[0] = 0xAA;
    tx.data[1] = 0x55;
    // ... 填充更多数据 ...

    // 触发 DMA 发送
    pyro::status_t ret = image.send_client_data();
    if (ret != PYRO_OK)
    {
        // 发送失败处理
    }
}

void send_to_controller()
{
    auto &image = pyro::image_drv_t::get_instance();

    // 填充控制器数据 (30 字节可用)
    auto &tx = image.get_controller_tx_data();
    tx.data[0] = 0xFF;

    pyro::status_t ret = image.send_controller_data();
}
```

### 5. 注意事项 (Caveats)

1. **宏依赖**: `get_instance()` 仅在定义了 `IMAGE_UART` 宏（指向对应 UART 外设）的条件下可用。需要在 配置。
2. **DMA 内存安全**: `tx_controller_packet_t` 和 `tx_client_packet_t` 分配自 DMA 内存池（`pvPortDmaMalloc`），生命周期由驱动管理，用户不应释放。
3. **订阅上限**: 白名单最大容量为 `MAX_SUBSCRIBE_NUM = 4`，超出部分在 `init()` 中被静默忽略。图传链路指令量极低，4 个配额足以覆盖所有使用场景。
4. **离线检测**: 500ms 内未收到任何已订阅帧即判定为离线 (`_is_online = false`)，上层需轮询 `is_online()` 实现超时逻辑。
5. **帧完整性**: ISR 回调中当 `size < HEADER_SIZE + 2` 时返回 `true`（表示消费但不入队），这是正常的协议歧义消除——在 DMA 分片传输中可能仅接收到部分帧头字节，需要等待更多数据到达。

## Q&A