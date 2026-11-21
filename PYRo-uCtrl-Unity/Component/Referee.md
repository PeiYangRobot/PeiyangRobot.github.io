Version<Badge type="tip" text="1.0.0"/>  
File<Badge type="info" text="pyro_referee.h"/><Badge type="info" text="pyro_referee.cpp"/><Badge type="info" text="pyro_ui_drv.h"/><Badge type="info" text="pyro_ui_drv.cpp"/>

# PYRo Referee Driver

RoboMaster 裁判系统驱动，实现裁判系统与单片机双向通信。接收时通过 FIFO 缓冲 + 状态机解包 + 白名单订阅实现按需数据提取；发送时采用双缓冲 + 信号量流水线实现 CPU 组包与 DMA 发送并行。配套 UI 驱动提供操作手端图形绘制功能。

## 核心架构

```
应用层 (get_data / send_packet / UI 绘制)
    ├─ referee_drv_t (解包/组包/白名单/双缓冲发送)
    ├─ ui_drv_t (图层管理/几何绘制/批量发送)
    └─ fifo_s_t
```

## 快速使用

### 初始化

**位置**: `pyro_init_thread.cpp` 或主初始化文件

```c++
#include "pyro_referee.h"

// 在 FreeRTOS 初始化线程中配置 UART 并启动裁判系统驱动
extern "C"
{
    void pyro_init_thread(void *argument)
    {
        // ... 其他初始化 ...
        
#ifdef REFEREE_UART
        REFEREE_UART.reset(115200, UART_WORDLENGTH_8B, UART_STOPBITS_1,
                           UART_PARITY_NONE);
        REFEREE_UART.enable_rx_dma();
        referee_drv_t::get_instance()->init();  // 全量订阅所有命令
#endif

        // 或选择性订阅指定命令（减少数据处理开销）
        // referee_drv_t::get_instance()->init({
        //     pyro::cmd_id::ROBOT_STATE,
        //     pyro::cmd_id::POWER_HEAT_DATA,
        //     pyro::cmd_id::SHOOT_DATA,
        // });
        
        vTaskDelete(nullptr);
    }
}
```

### 读取数据

**位置**: 板间通信、底盘控制等业务逻辑文件（如 `pyro_board_com.cpp`）

```c++
#include "pyro_referee.h"

auto *referee = referee_drv_t::get_instance();

if (referee->is_online())  // 2s 超时检测
{
    const auto &ref_data = referee->get_data();
    
    // 机器人状态
    uint16_t current_hp = ref_data.robot_status.current_hp;
    uint16_t heat_limit = ref_data.robot_status.shooter_barrel_heat_limit;
    uint8_t gimbal_output = ref_data.robot_status.power_management_gimbal_output;
    
    // 功率热量数据
    uint16_t buffer = ref_data.power_heat.buffer_energy;
    uint16_t heat = ref_data.power_heat.shooter_42mm_barrel_heat;
    
    // 发射数据
    float speed = ref_data.shoot.initial_speed;
    uint16_t shoot_count = ref_data.shoot_launching_count;  // 驱动维护的发射计数（非协议字段）
    
    // 位置信息
    float x = ref_data.robot_pos.x;
    float y = ref_data.robot_pos.y;
    
    // 机器人 ID（自动从 ROBOT_STATE 提取）
    uint16_t robot_id = referee->get_robot_id();
    uint16_t client_id = referee->get_client_id();  // robot_id + 0x0100
    uint8_t robot_color = robot_id >= 100 ? 1 : 0;  // 0=红方, 1=蓝方
}
```

### 发送交互数据

**位置**: 机器人间通信模块（如哨兵通信、雷达通信）

```c++
#include "pyro_referee.h"

auto *referee = referee_drv_t::get_instance();

// 机器人间通信（自动校验同队）
uint8_t cmd_data[4] = {0x01, 0x00, 0x00, 0x00};
referee->send_robot_interaction(107, 0x0120, cmd_data, sizeof(cmd_data));

// 自定义信息到客户端（图传链路 0x0308）
referee->send_custom_info("Hello Client");
```

### UI 绘制

**位置**: UI 通信模块（如 `Communication/Chassis_board/pyro_ui_com.cpp`）

```c++
#include "pyro_ui_drv.h"
#include "pyro_referee.h"

// UI 初始化（需等待裁判系统在线且 robot_id 有效）
static referee_drv_t *referee_ptr = referee_drv_t::get_instance();
static ui_drv_t *ui_ptr = nullptr;

// 等待裁判系统在线
while (!referee_ptr->is_online() || referee_ptr->get_robot_id() == 0)
{
    vTaskDelay(pdMS_TO_TICKS(500));
}

// 创建 UI 驱动（动态分配）
ui_ptr = new ui_drv_t(referee_ptr);

// 清除操作
ui_ptr->clear_layer(0);   // 清除图层 0
ui_ptr->clear_all();      // 清除所有图层

// 几何图形（链式调用，满 7 个自动发送）
ui_ptr->draw_line("ln1", ui_operate::ADD, 0, ui_color::GREEN, 2, 100,200, 300,200)
      .draw_circle("c1", ui_operate::ADD, 0, ui_color::RED, 2, 500,400, 50)
      .draw_rect("r1", ui_operate::ADD, 0, ui_color::YELLOW, 3, 100,100, 200,150);

// 数值显示
ui_ptr->draw_float("hp", ui_operate::ADD, 1, ui_color::CYAN, 20, 2, 800,100, 350.5f)
      .draw_int("ammo", ui_operate::ADD, 1, ui_color::WHITE, 16, 2, 800,150, 120);

// 字符串（单独发送，最多 30 字符）
ui_ptr->draw_string("txt", ui_operate::ADD, 1, ui_color::GREEN, 18, 2, 800,200, "READY");

ui_ptr->flush();  // 发送剩余图形
```

### UI 操作枚举

| 操作 | 枚举 | 说明 |
|------|------|------|
| 添加 | `ui_operate::ADD` | 新增图形 |
| 修改 | `ui_operate::MODIFY` | 更新已存在图形 |
| 删除 | `ui_operate::DELETE` | 删除指定图形 |

| 图形 | 枚举 | 参数 |
|------|------|------|
| 直线 | `ui_figure::LINE` | start_x, start_y, end_x, end_y |
| 矩形 | `ui_figure::RECT` | start_x, start_y, end_x, end_y |
| 圆形 | `ui_figure::CIRCLE` | center_x, center_y, radius |
| 椭圆 | `ui_figure::ELLIPSE` | center_x, center_y, rx, ry |
| 圆弧 | `ui_figure::ARC` | center_x, center_y, start_angle, end_angle, rx, ry |

| 颜色 | 枚举 |
|------|------|
| 队友色 | `ui_color::ALLY` |
| 黄色 | `ui_color::YELLOW` |
| 绿色 | `ui_color::GREEN` |
| 橙色 | `ui_color::ORANGE` |
| 紫红 | `ui_color::MAGENTA` |
| 粉色 | `ui_color::PINK` |
| 青色 | `ui_color::CYAN` |
| 黑色 | `ui_color::BLACK` |
| 白色 | `ui_color::WHITE` |

## 技术细节

### 协议帧格式

```
[SOF:1][Len:2][Seq:1][CRC8:1][CMD_ID:2][Data:N][CRC16:2]
```

- SOF 固定 `0xA5`
- 状态机逐字节解析，CRC8/CRC16 双重校验
- 最大帧长 `FRAME_MAX_SIZE = 256` 字节

### 双缓冲发送机制

```
Buf[0]: [CPU 组包] → [DMA 发送] → [空闲]
Buf[1]:              [CPU 组包] → [DMA 发送]
```

- 2 块 DMA 缓冲 Ping-Pong 切换
- 互斥锁保护组包，信号量同步 DMA 完成
- 50ms 超时保护，适配 115200 波特率

### FIFO 环形缓冲

- 1024 字节容量，中断安全（`__disable_irq`）
- ISR 快速写入，Task 轮询读取
- 支持批量操作减少函数调用

## 实战技巧

### 发射事件检测

**位置**: 底盘板通信或发射控制模块（如 `pyro_board_com.cpp`）

使用 `shoot_launching_count` 计数器检测新发射事件：

```c++
#include "pyro_referee.h"

static uint16_t last_launching_num = 0;
auto *referee = referee_drv_t::get_instance();

const auto &ref_data = referee->get_data();
if (ref_data.shoot_launching_count != last_launching_num)
{
    // 检测到新发射
    float shoot_speed = ref_data.shoot.initial_speed;
    // 处理发射事件...
    last_launching_num = ref_data.shoot_launching_count;
}
```

**说明**: `shoot_launching_count` 不是裁判系统协议字段，而是驱动内部维护的计数器。每次收到裁判系统的 `SHOOT_DATA (0x0207)` 消息时，驱动会自动执行 `shoot_launching_count++`。应用层通过对比计数器变化来检测新的发射事件，避免重复处理同一条消息。

### UI 脏检查优化

**位置**: UI 绘制模块（如 `pyro_ui_com.cpp`）

避免不必要的 UI 更新，使用阈值检测变化：

```c++
#include <cmath>

static float last_yaw = 0.0f;
constexpr float threshold = 0.001f;

if (std::fabs(current_yaw - last_yaw) > threshold)
{
    ui_ptr->draw_float("yaw", ui_operate::MODIFY, 1, ui_color::GREEN, 
                       20, 2, 800, 100, current_yaw);
    last_yaw = current_yaw;
}
```

## 文件组织建议

参考 Hero 项目的文件结构：

```
Robot/Hero/
├── pyro_init_thread.cpp              # 裁判系统初始化
├── Communication/
│   ├── Chassis_board/
│   │   ├── pyro_board_com.cpp        # 裁判数据读取与转发
│   │   └── pyro_ui_com.cpp           # UI 绘制与更新
│   └── Gimbal_board/
│       └── pyro_custom_com.cpp       # 自定义数据透传
└── Application/                       # 其他业务逻辑模块
```

**头文件引用**：
```c++
#include "pyro_referee.h"    // 裁判系统驱动
#include "pyro_ui_drv.h"     // UI 驱动（需要时）
```

## 注意事项

1. **宏依赖**: `get_instance()` 需在 `pyro_core_config.h` 定义 `REFEREE_UART`
2. **初始化顺序**: 先配置 UART 参数并启用 DMA，再调用 `init()`
3. **Robot ID**: 自动从首个 `ROBOT_STATE` 包提取，UI 初始化前需等待在线且 ID 有效
4. **队伍校验**: 红方 ID < 100，蓝方 ID ≥ 100，`send_robot_interaction()` 拒绝跨队通信
5. **UI 限速**: 每次 UI 发送后延迟 40ms，大量绘制注意累积延迟
6. **发送频率**: 双缓冲满载时 `send_packet()` 超时 50ms，上层需控制频率或处理重试

<Author name="Pason" />