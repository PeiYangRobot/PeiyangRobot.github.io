Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_supercap_drv.h"/><Badge type = "info" text="pyro_supercap_drv.cpp"/>

# PYRo Supercap Driver

**基于组合模式的超级电容通信驱动（主控侧）**

该 `pyro_supercap_drv` 模块实现了主控板与超级电容模块 (Supercap Module) 之间的双向通信。采用组合模式 (Composition) 将 FreeRTOS 任务封装为内部私有类，通过 Message Buffer 实现 ISR → Task 的数据传递，发送侧使用 DMA 配合 CRC8/CRC16 双重校验保证协议可靠性。适用于 RoboMaster 机器人底盘功率缓冲与电容能量管理场景。

> 嵌入式开发前置知识：了解超级电容模组的工作原理、FreeRTOS Message Buffer、STM32 UART DMA 发送、CRC8/CRC16 校验算法


## Part 1: 代码全解 (Code Deep Dive)

### 1. 核心设计理念

- **组合模式 (Composition)**: 任务生命周期由私有内部类 `supercap_task_t` 管理。构造函数中 `new supercap_task_t(this)` 创建任务但不启动，外部需显式调用 `start_rx()` 以控制启动时机。这与继承 `task_base_t` 的模式不同，避免了驱动类直接暴露任务接口。
- **ISR → Task 消息传递**: UART 中断回调中执行最小化检查（帧头 + 帧尾 + 长度验证），通过后整帧入队到 Message Buffer。任务的 `run_loop_impl()` 以阻塞方式从 Message Buffer 中取帧，在任务上下文中完成 CRC 校验与数据解包。
- **自定义协议帧**: 与 RoboMaster 裁判系统的 0xA5 协议不同，超级电容通信使用自定义的简易协议：帧头 `0x55` + CRC8 + 数据段 + CRC16 + 帧尾 `\n`。

### 2. 协议帧定义

**下行帧 (主控 → 电容)**: 13 字节

```c++
#pragma pack(push, 1)
struct tx_packet_t
{
    frame_header_t header;   // SOF(0x55) + CRC8(1) = 2字节
    chassis_cmd_t data;      // 控制命令 = 8字节
    frame_tailer_t tailer;   // CRC16(2)
    uint8_t end_byte;        // '\n' 帧尾标识
};
#pragma pack(pop)
```

**上行帧 (电容 → 主控)**: 13 字节 (不含 `\n`)

```c++
#pragma pack(push, 1)
struct rx_packet_t
{
    frame_header_t header;   // SOF(0x55) + CRC8(1) = 2字节
    cap_feedback_t data;     // 反馈数据 = 9字节
    frame_tailer_t tailer;   // CRC16(2)
};
#pragma pack(pop)
```

### 3. 控制命令 (`chassis_cmd_t`) — 主机 → 电容

```c++
struct chassis_cmd_t
{
    uint16_t power_referee;              // 裁判系统给出的底盘功率
    uint8_t power_limit_referee;         // 底盘功率上限
    uint8_t power_buffer_referee;        // 底盘缓冲功率
    uint8_t power_buffer_limit_referee;  // 底盘缓冲功率上限
    uint8_t use_cap;                     // 1: 使用电容, 0: 不使用
    uint8_t kill_chassis_user;           // 1: 紧急断电/自杀
    uint8_t speed_up_user_now;           // 保留/加速标志
};
```

主控通过发送 `chassis_cmd_t` 向电容模块下发功率策略指令。`use_cap` 和 `kill_chassis_user` 是关键的安全控制信号。

### 4. 反馈数据 (`cap_feedback_t`) — 电容 → 主机

```c++
struct cap_feedback_t
{
    uint16_t cap_power_cap;      // 电容当前充放电功率
    uint16_t chassis_power_cap;  // ADC 测得的实际底盘功率
    uint16_t vot_cap;            // 电容当前电压 (mV 级)
    uint8_t error_flag;          // 错误标志位
    uint8_t cap_low_flag;        // 电容电量低标志
    uint8_t over_normal_c_l;     // 电流达到额定值标志
};
```

### 5. ISR 接收回调 — 最小化中断处理

ISR 回调函数放置于 `.itcm_text` 段（ITCM 零等待指令 RAM），执行最精简的帧校验后将数据快速入队：

```c++
__attribute__((section(".itcm_text")))
bool supercap_drv_t::rx_callback(const uint8_t *p_data, uint16_t size,
                                 BaseType_t &xHigherPriorityTaskWoken) const
{
    // 三重快速检查：帧长 + 帧头 SOF + 帧尾 '\n'
    if (size == sizeof(rx_packet_t) + 1 && p_data[0] == FRAME_SOF &&
        p_data[sizeof(rx_packet_t)] == '\n')
    {
        // 通过 Message Buffer 将原始数据发送到任务上下文
        xMessageBufferSendFromISR(_rx_msg_buf, p_data, sizeof(rx_packet_t),
                                  &xHigherPriorityTaskWoken);
        return true;
    }
    return false;
}
```

### 6. 任务循环 — 在线状态管理

`run_loop_impl()` 实现了双阶段接收逻辑：

```text
  ┌───────────────────────────┐
  │  第一阶段：等待首帧       │
  │  portMAX_DELAY 阻塞等待    │
  │  → 收到首帧: _is_online = true
  └───────────┬───────────────┘
              │
  ┌───────────▼───────────────┐
  │  第二阶段：在线持续接收    │
  │  120ms 超时接收            │
  │  → 收到完整帧: CRC校验+解包│
  │  → 超时: _is_online = false
  │      回到第一阶段           │
  └───────────────────────────┘
```

这种设计确保：

- **启动同步**: 在收到第一个有效帧之前不执行超时逻辑，避免启动时的误判离线
- **离线恢复**: 120ms 内未收到任何数据即判定离线并自动回到等待同步状态
- **非阻塞**: 离线状态下任务以 `portMAX_DELAY` 阻塞等待，不消耗 CPU 时间片

### 7. 错误校验 (`error_check`)

```c++
status_t supercap_drv_t::error_check(const rx_packet_t *buf)
{
    // CRC16 校验全帧（13 字节）
    if (!verify_crc16_check_sum(reinterpret_cast<uint8_t const *>(buf),
                                sizeof(rx_packet_t)))
    {
        return PYRO_ERROR;
    }
    return PYRO_OK;
}
```

注意：当前实现中帧头 CRC8 校验已被注释掉，仅保留全帧 CRC16 校验。这是有意为之——CRC16 已能覆盖全帧（包括帧头），CRC8 作为额外的帧头保护在串口通信中属于冗余开销。

### 8. 数据发送 (`send_cmd`)

```c++
status_t supercap_drv_t::send_cmd(const chassis_cmd_t &cmd) const
{
    if (!_tx_buffer || !_uart_drv) return PYRO_ERROR;

    // 1. 写帧头 SOF + CRC8
    _tx_buffer->header.sof = FRAME_SOF;
    append_crc8_check_sum(reinterpret_cast<uint8_t *>(&_tx_buffer->header),
                          sizeof(frame_header_t));

    // 2. 拷贝负载数据
    memcpy(&_tx_buffer->data, &cmd, sizeof(chassis_cmd_t));

    // 3. 计算全帧 CRC16 (不含帧尾 '\n')
    append_crc16_check_sum(reinterpret_cast<uint8_t *>(_tx_buffer),
                           sizeof(tx_packet_t) - 1);

    _tx_buffer->end_byte = '\n';

    // 4. DMA 发送 (非阻塞)
    return _uart_drv->write(reinterpret_cast<uint8_t *>(_tx_buffer),
                            sizeof(tx_packet_t));
}
```

发送缓冲区为 DMA 安全内存 (`pvPortDmaMalloc`)，写入与 DMA 发送直接共享同一内存块，无中间拷贝。


## Part 2: 快速上手 (Quick Start)

### 1. 初始化与启动

```c++
#include "pyro_supercap_drv.h"

void init_supercap_communication()
{
    // 获取单例
    auto *supercap = pyro::supercap_drv_t::get_instance();

    // 启动内部任务（注册 UART 回调 + 创建 Message Buffer）
    supercap->start_rx();
}
```

### 2. 发送控制命令

```c++
void send_chassis_power_config()
{
    auto *supercap = pyro::supercap_drv_t::get_instance();

    pyro::supercap_drv_t::chassis_cmd_t cmd{};
    cmd.power_referee              = 80;   // 裁判系统分配功率 80W
    cmd.power_limit_referee        = 100;  // 功率上限 100W
    cmd.power_buffer_referee       = 60;   // 缓冲功率 60W
    cmd.power_buffer_limit_referee = 80;   // 缓冲功率上限 80W
    cmd.use_cap                    = 1;    // 启用电容
    cmd.kill_chassis_user          = 0;    // 正常模式
    cmd.speed_up_user_now          = 0;

    pyro::status_t ret = supercap->send_cmd(cmd);
    if (ret != PYRO_OK)
    {
        // 发送失败 (UART 繁忙或资源未就绪)
    }
}
```

### 3. 读取电容反馈

```c++
void monitor_supercap_status()
{
    auto *supercap = pyro::supercap_drv_t::get_instance();

    while (true)
    {
        if (supercap->check_online())
        {
            const auto &fb = supercap->get_feedback();

            uint16_t cap_power      = fb.cap_power_cap;      // 电容充放电功率
            uint16_t actual_power   = fb.chassis_power_cap;  // ADC 实际底盘功率
            uint16_t cap_voltage    = fb.vot_cap;            // 电容电压
            bool     cap_low        = fb.cap_low_flag;       // 电量低告警
            bool     current_rated  = fb.over_normal_c_l;    // 电流达额定值

            // 示例：电容电量低时限制底盘功率
            if (cap_low)
            {
                limit_chassis_power(40); // 节能模式
            }
        }
        else
        {
            // 电容模块离线 (>120ms 无应答)
            // 关闭电容辅助，仅使用裁判系统功率
            emergency_disable_capacitor();
        }

        // 发送命令 + 读取反馈，建议以 10Hz-50Hz 循环
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
```

### 4. 紧急断电

```c++
void emergency_power_off()
{
    auto *supercap = pyro::supercap_drv_t::get_instance();

    pyro::supercap_drv_t::chassis_cmd_t cmd{};
    cmd.kill_chassis_user = 1;  // 触发电容模块紧急断电

    supercap->send_cmd(cmd);
}
```

### 5. 注意事项 (Caveats)

1. **宏依赖**: `get_instance()` 内部硬绑定了 `PYRO_UART7` 作为通信端口。仅在定义了 `SUPERCAP_UART` 宏且对应 UART 实例可用时编译。
2. **在线判断**: `check_online()` 状态由内部任务的状态机维护。首次收到有效帧后置 `true`，120ms 无新帧置 `false`。任务以 `portMAX_DELAY` 阻塞等待首帧，启动期间不判定离线。
3. **发送非阻塞**: `send_cmd()` 通过 DMA 发送，不阻塞调用者。但若 DMA 仍在处理上一次传输，底层 UART 驱动的 `write()` 可能返回 `PYRO_BUSY`，上层需处理此情况。
4. **数据零拷贝**: `get_feedback()` 返回 `const &` 常量引用，指向驱动内部维持的最新解析数据。使用者不应缓存此引用的地址——数据在每次新帧到达时原地更新。
5. **任务优先级**: 内部 `supercap_task_t` 运行在 `BELOW_NORMAL` 优先级。电容通信属于非关键遥测，低优先级确保不会抢占底盘控制、姿态解算等实时任务的时间片。
6. **CRC8 校验**: 当前帧头 CRC8 校验在 `error_check()` 中被注释禁用。全帧 CRC16 已能覆盖帧头部分的完整性。若使用环境电磁干扰严重，可取消注释以换取双重保护。

## Q&A