Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_referee.h"/><Badge type = "info" text="pyro_referee.cpp"/><Badge type = "info" text="fifo.h"/><Badge type = "info" text="fifo.cpp"/><Badge type = "info" text="pyro_ui_drv.h"/><Badge type = "info" text="pyro_ui_drv.cpp"/><Badge type = "info" text="protocol.h"/>

# PYRo Referee Driver

**基于 FreeRTOS 的 RoboMaster 裁判系统全功能驱动（含 UI 子模块）**

该 `pyro_referee_drv` 模块实现了与 RoboMaster 裁判系统主控模块 (Referee System) 的双向通信。接收侧：通过 FIFO 缓冲 + 状态机解帧 + 白名单订阅实现按需数据提取；发送侧：采用双缓冲 (Ping-Pong) + 二值信号量流水线实现 CPU 组包与 DMA 发送并行化，最大化带宽利用率。配套 `ui_drv_t` 子模块提供图形化/字符串学生端 UI 绘制能力。

> 嵌入式开发前置知识：了解 RoboMaster 裁判系统通信协议 (0xA5 帧头格式)、FreeRTOS 互斥锁与二值信号量、STM32 UART DMA 发送、FIFO 环形缓冲

## Part 1: 代码全解 (Code Deep Dive)

### 1. 整体架构

```
┌─────────────────────────────────────────────────┐
│                 Application Layer               │
│     (get_data() / send_packet() / UI draw)      │
├──────────────────┬──────────────────────────────┤
│  referee_drv_t   │       ui_drv_t               │
│  • 解帧/组帧      │       • 图层管理             │
│  • 白名单过滤     │       • 几何/文本绘制         │
│  • 双缓冲DMA发送   │       • 批量合并发送         │
├──────────────────┴──────────────────────────────┤
│         fifo_s_t (ISR → Task 字节流缓冲)         │
├─────────────────────────────────────────────────┤
│               pyro_uart_drv_t                   │
│        (UART DMA 接收 + 中断回调)                │
└─────────────────────────────────────────────────┘
```

### 2. 协议定义 (`protocol.h`)

`protocol.h` 提供了完整的 RoboMaster 裁判系统协议数据结构（对应官方规范 V1.x），核心元素：

**帧头结构** — 5 字节固定格式：

```c++
struct frame_header_t {
    uint8_t sof;           // 0xA5
    uint16_t data_length;  // 数据段长度
    uint8_t seq;           // 包序号
    uint8_t crc8;          // 帧头 CRC8
};
```

**命令码枚举** — 覆盖比赛状态、机器人状态、功率热量、交互数据等全部命令：

```c++
enum class cmd_id : uint16_t
{
    GAME_STATE           = 0x0001,  // 比赛阶段与剩余时间
    ROBOT_STATE          = 0x0201,  // 机器人血量/枪管热量/功率限制
    POWER_HEAT_DATA      = 0x0202,  // 底盘功率/缓冲能量/枪管热量
    SHOOT_DATA           = 0x0207,  // 发射信息(弹速/射速/弹丸类型)
    STUDENT_INTERACTIVE  = 0x0301,  // 学生间/机器人间数据交互
    // ... 共 20+ 命令码
};
```

**聚合数据结构** — `referee_data_t` 将所有下行子结构聚合为一个整体，方便使用者通过一次引用访问全部字段：

```c++
struct referee_data_t {
    game_status_t game_status;
    robot_status_t robot_status;
    power_heat_data_t power_heat;
    robot_pos_t robot_pos;
    shoot_data_t shoot;
    // ... 共 20+ 字段
};
```

### 3. FIFO 环形缓冲 (`fifo_s_t`)

中断服务例程 (ISR) 不能执行耗时操作，因此裁判系统使用单字节 FIFO (Single Byte Mode) 作为 ISR 与任务之间的字节流缓冲：

```c++
// fifo.h — 数据结构
typedef struct {
    char *p_start_addr;  // 内存池起始地址
    char *p_end_addr;    // 内存池结束地址
    int free_num;        // 剩余容量
    int used_num;        // 已用数量
    char *p_read_addr;   // 读指针
    char *p_write_addr;  // 写指针
} fifo_s_t;
```

- **环形回绕**: 当读写指针到达物理末尾时自动回绕到起始地址，实现循环利用
- **ISR 安全**: `fifo_s_puts()` / `fifo_s_get()` 使用 `__disable_irq()` 保护临界区，中断与任务间并发安全
- **批量操作**: `fifo_s_puts()` 和 `fifo_s_gets()` 支持整块数据读写，减少函数调用次数

```c++
// ISR 中快速写入
bool referee_drv_t::rx_callback(uint8_t *p, uint16_t size, BaseType_t task_woken)
{
    fifo_s_puts(&_fifo, reinterpret_cast<char *>(p), size);
    return true;
}
```

### 4. 状态机解帧

解帧逻辑不依赖帧间空闲检测，而是用纯状态机逐字节驱动——这是处理 DMA 分片接收的标准方式：

```c++
enum class unpack_step {
    HEADER_SOF  = 0,  // 搜索 SOF 0xA5
    LENGTH_LOW,       // 接收 data_length 低字节
    LENGTH_HIGH,      // 接收 data_length 高字节，超长则复位
    FRAME_SEQ,        // 接收包序号
    HEADER_CRC8,      // 接收帧头 CRC8，校验失败复位
    DATA_CRC16        // 接收数据段 + CRC16，校验成功调用 solve_data()
};
```

关键安全设计：

- `LENGTH_HIGH` → 若 `len >= FRAME_MAX_SIZE` 则立即复位，防止无效长度导致缓冲区溢出
- `HEADER_CRC8` → CRC8 验证失败即丢弃该帧，有效防止因单字节错误导致的整帧数据错位
- 每完整收到一帧后自动回到 `HEADER_SOF`，不依赖帧间间隙

### 5. 白名单订阅策略

`referee_drv_t` 使用 `std::bitset<1024>` 维护订阅命令集——这是因为裁判系统协议拥有约 20 种命令码，ID 范围跨越 0x0001~0x0308，bitset 的 O(1) 查找相比线性搜索更适合此场景。

```c++
// 仅订阅指定命令
referee.init({cmd_id::ROBOT_STATE, cmd_id::POWER_HEAT_DATA, cmd_id::SHOOT_DATA});

// 或全量订阅（debug/监控场景）
referee.init();  // _enabled_ids.set() 全部拉高
```

### 6. 双缓冲 (Ping-Pong) DMA 发送流水线

模块预先分配 2 块 DMA 安全缓冲区 (`_tx_buffers[2]`)，配合二值信号量实现"CPU 组包"与"DMA 发送"的并行流水：

```text
           时间轴 →
   Buf[0]: [CPU 组包────] [DMA 发送────────────────] [CPU 组包────] ...
   Buf[1]:               [CPU 组包────] [DMA 发送──────────────] ...
```

```c++
bool referee_drv_t::send_packet(cmd_id cmd_id_val, const void *data, uint16_t len)
{
    // 1. 互斥锁：防止多线程同时组包
    const scoped_mutex_t lock(_tx_mutex, pdMS_TO_TICKS(100));
    if (!lock.is_locked()) return false;

    // 2. 获取当前空闲缓冲区（上一包可能正在 DMA 发送中）
    uint8_t *current_tx_buf = _tx_buffers[_tx_buffer_idx];
    _tx_buffer_idx = (_tx_buffer_idx + 1) % TX_BUFFER_NUM;

    // 3. CPU 组装数据帧（与上一包的 DMA 发送并行！）
    p_header->sof = HEADER_SOF;
    p_header->data_length = len;
    // ... 填充 header / cmd_id / data / crc16 ...

    // 4. 阻塞等待上一包 DMA 发送完成（二值信号量）
    if (xSemaphoreTake(_tx_cplt_sem, pdMS_TO_TICKS(50)) != pdTRUE)
        return false;

    // 5. 启动当前包的 DMA 发送（非阻塞）
    _uart->write(current_tx_buf, frame_total_len);
    return true;
}
```

**发送完成中断** (`tx_cplt_callback`) 中调用 `xSemaphoreGiveFromISR()` 归还信号量，唤醒可能正在等待的下一帧发送。

### 7. UI 子模块 (`ui_drv_t`)

`ui_drv_t` 是对裁判系统学生端 UI 协议的封装，通过 `referee_drv_t` 的 `send_ui_interaction()` 通道发送绘制数据。

**支持的图形类型**:

| 枚举值    | 图形       | 数据负载                               |
| --------- | ---------- | -------------------------------------- |
| `LINE`    | 直线       | 2 参数: end_x, end_y                   |
| `RECT`    | 矩形       | 2 参数: end_x, end_y                   |
| `CIRCLE`  | 圆圈       | 1 参数: radius                         |
| `ELLIPSE` | 椭圆       | 2 参数: rx, ry                         |
| `ARC`     | 圆弧       | 4 参数: start_angle, end_angle, rx, ry |
| `FLOAT`   | 浮点数显示 | 值编码为 32-bit 拆分成 3 个 bitfield   |
| `INT`     | 整数显示   | 同上                                   |
| `STRING`  | 字符串显示 | 最多 30 字符                           |

**批量合并优化**: 裁判系统 UI 协议允许单帧发送多个图形（1/2/5/7 个/帧）。`ui_drv_t` 内部使用 `std::vector<ui_figure_data_t>` 缓存待发送图形，当累积到 7 个时自动打包发送，减少通信次数。最后通过 `flush()` 清空剩余图形。

```c++
// 流式链式调用 + 自动批量发
ui.draw_line("l1", ui_operate::ADD, 0, ui_color::GREEN, 2, 100,200, 300,200)
  .draw_circle("c1", ui_operate::ADD, 0, ui_color::RED, 2, 500,400, 50)
  .draw_float("f1", ui_operate::ADD, 1, ui_color::CYAN, 16, 3, 800,600, 3.1415f);
  // ... 累积到 7 个自动发送 ...

ui.flush();  // 发送剩余图形，清空缓存
```

## Part 2: 快速上手 (Quick Start)

### 1. 初始化（订阅模式）

```c++
#include "pyro_referee.h"
#include "pyro_ui_drv.h"

void init_referee()
{
    auto *referee = pyro::referee_drv_t::get_instance();

    // 显式订阅需要的命令码，减少不必要的数据拷贝
    referee->init({
        pyro::cmd_id::GAME_STATE,
        pyro::cmd_id::ROBOT_STATE,
        pyro::cmd_id::POWER_HEAT_DATA,
        pyro::cmd_id::SHOOT_DATA,
        pyro::cmd_id::STUDENT_INTERACTIVE,
    });
}
```

### 2. 读取裁判系统数据

```c++
void monitor_referee_data()
{
    auto *referee = pyro::referee_drv_t::get_instance();

    while (true)
    {
        if (referee->is_online())
        {
            // 获取只读引用 (无需拷贝结构体)
            const auto &data = referee->get_data();

            // 比赛信息
            uint16_t remain = data.game_status.stage_remain_time;

            // 机器人状态
            uint16_t current_hp = data.robot_status.current_hp;
            uint16_t chassis_power_limit = data.robot_status.chassis_power_limit;

            // 功率热量
            uint16_t buffer_energy = data.power_heat.buffer_energy;
            uint16_t barrel_heat  = data.power_heat.shooter_17mm_barrel_heat;

            // 自动同步的 ID
            uint16_t my_robot_id = referee->get_robot_id();
            uint16_t my_client_id = referee->get_client_id();
        }
        else
        {
            // 超时 2s 未收到数据，裁判系统离线
        }

        vTaskDelay(pdMS_TO_TICKS(10));  // 100Hz 轮询
    }
}
```

### 3. 发送机器人间交互数据

```c++
void send_interaction_to_client()
{
    auto *referee = pyro::referee_drv_t::get_instance();

    // 发送给本队哨兵 (假设 ID=107)
    uint8_t cmd_data[4] = {0x01, 0x00, 0x00, 0x00};
    referee->send_robot_interaction(
        107,                              // 接收方 ID
        0x0120,                           // 子命令码 (哨兵指令)
        cmd_data, sizeof(cmd_data));
}
```

### 4. 使用 UI 驱动绘制学生端界面

```c++
#include "pyro_ui_drv.h"

void render_ui()
{
    auto *referee = pyro::referee_drv_t::get_instance();
    static pyro::ui_drv_t ui(referee);

    // 操作码枚举
    using namespace pyro;

    // 清除图层 0
    ui.clear_layer(0);

    // 绘制十字准心
    ui.draw_line("ln1", ui_operate::ADD, 0, ui_color::GREEN, 2, 480, 200, 480, 600)
      .draw_line("ln2", ui_operate::ADD, 0, ui_color::GREEN, 2, 320, 400, 640, 400);

    // 绘制血量数字
    ui.draw_float("hp1", ui_operate::ADD, 1, ui_color::RED, 16, 3, 800, 100, 350.5f);

    // 绘制字符串
    ui.draw_string("tx1", ui_operate::ADD, 1, ui_color::CYAN, 16, 3, 800, 200, "PYRo Online");

    // 确保所有未发送的图形被发出
    ui.flush();
}
```

### 5. 注意事项 (Caveats)

1. **宏依赖**: `get_instance()` 仅在定义了 `REFEREE_UART` 宏的条件下可用。需要在 `pyro_core_config.h` 中配置。
2. **Robot ID 自动同步**: `robot_status_t` 包中携带的 `robot_id` 会被自动提取到 `_robot_id` 成员变量。发送交互数据前必须确保已成功接收到至少一次 `ROBOT_STATE` 包。
3. **同队校验**: `send_robot_interaction()` 发送前会校验发送方与接收方的队伍颜色一致——红方 Robot ID < 100，蓝方 Robot ID ≥ 100。跨队交互将被拒绝。
4. **UI 发送速率**: `send_ui_interaction()` 内部每次调用后 `vTaskDelay(40ms)`，以满足裁判系统 UI 更新限速要求。连续绘制大量 UI 元素时需注意累积延迟。
5. **FIFO 溢出**: ISR 回调中 `fifo_s_puts()` 以最大容量进行截断写入（`len = min(len, free_num)`），高频数据下可能溢出。当前配置 `FIFO_BUF_LEN = 1024` 字节在 100Hz 轮询下足够安全。
6. **双缓冲限制**: `TX_BUFFER_NUM = 2`。若上层任务以超过 DMA 发送速率（~1MB/s @ 115200 波特率）的频率连续调用 `send_packet()`，`xSemaphoreTake(50ms)` 将超时返回失败。上层应自行控制发送频率或处理超时重试。

## Q&A