Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_dji_motor_drv.h"/><Badge type = "info" text="pyro_dji_motor_drv.cpp"/><Badge type = "info" text="pyro_dm_motor_drv.h"/><Badge type = "info" text="pyro_dm_motor_drv.cpp"/><Badge type = "info" text="pyro_motor_base.h"/><Badge type = "info" text="pyro_motor_base.cpp"/>

# PYRo Motor Driver

**基于 CAN 总线的多协议电机驱动框架**

该电机驱动框架通过抽象基类 `motor_base_t` 统一电机控制接口，派生类实现不同品牌/协议电机的驱动逻辑。当前支持 **DJI 系列**（M3508 减速电机、M2006 减速电机、GM6020 云台电机）的 V1.0 电调协议，以及 **达妙 (DM) 系列** 电机的 MIT 模式控制协议。框架提供 CAN 发送帧复用池、位置/转速/扭矩解析、错误码管理及运行时 PID 参数调节等功能。

> 嵌入式开发前置知识：了解 CAN 总线通信、DJI 智能电机电调协议、MIT 控制模式、PYRo CAN 驱动框架 (`can_drv_t` / `can_msg_buffer_t`)

------

## Part 1: 代码全解 (Code Deep Dive)

### 1. 整体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│          enable() / disable() / send_torque()                │
│          get_current_position() / get_current_rotate()       │
├──────────────────────────────────────────────────────────────┤
│                      motor_base_t  (抽象基类)                 │
│  • CAN 通道绑定 (_which_can, _can_drv)                        │
│  • 通用状态: _enable, _online, _temperature                   │
│  • 通用数据: _current_position, _current_rotate, _current_torque │
│  • 纯虚函数: enable/disable/update_feedback/send_torque      │
├──────────────────────┬───────────────────────────────────────┤
│   dji_motor_drv_t    │         dm_motor_drv_t                │
│   (DJI 电调协议)      │         (DM MIT 模式)                  │
│                      │                                       │
│  • TX 帧池复用        │  • MIT 控制帧直发                      │
│  • 多电机聚合发送      │  • float↔uint 量化编解码              │
│  • 减速比内置          │  • 运行时 KP/KD 调节                  │
│  ├─ M3508 (20N·m)    │  • 错误码检测与清除                    │
│  ├─ M2006 (10N·m)    │                                       │
│  └─ GM6020 (3N·m)    │                                       │
└──────────────────────┴───────────────────────────────────────┘
```

### 2. 抽象基类 (`motor_base_t`)

基类封装了所有电机的通用状态与数据访问接口，派生类只需实现协议相关的使能、反馈解析和扭矩发送：

```c++
// pyro_motor_base.h
class motor_base_t
{
public:
    motor_base_t(bsp_can::which_can which);
    virtual ~motor_base_t();

    // 纯虚函数 — 派生类实现协议特定逻辑
    virtual status_t enable()              = 0;
    virtual status_t disable()             = 0;
    virtual status_t update_feedback()     = 0;
    virtual status_t send_torque(float torque) = 0;

    // 通用 getter（基类实现）
    int8_t get_temperature();
    float get_current_position();
    float get_current_rotate();
    float get_current_torque();
    bool is_enable();
    bool is_online();

protected:
    bsp_can::which_can _which_can;
    can_drv_t *_can_drv;
    bool _enable, _online;
    float _last_update_time;
    int8_t _temperature;
    float _current_position;   // 位置 (rad)
    float _current_rotate;     // 转速 (rad/s)
    float _current_torque;     // 扭矩 (N·m)
    can_msg_buffer_t *_feedback_msg;
};
```

**统一的物理量纲**: 所有派生类的 `_current_position` 统一为弧度 (rad)、`_current_rotate` 统一为 rad/s、`_current_torque` 统一为 N·m。上层算法无需关心底层电机的原始编码方式。

### 3. DJI 电机驱动族 (`dji_motor_drv_t`)

#### 3.1 TX 帧复用池 — 多电机聚合发送

DJI 电调协议规定：一条 CAN 报文可以承载最多 **4 个电机的扭矩指令**（8 字节数据帧，每个电机 2 字节 int16）。例如 CAN ID `0x200` 聚合 id1~id4 四个电机，`0x1FF` 聚合 id5~id8 四个电机。

框架通过 `dji_motor_tx_frame_t` 类将这一硬件约束抽象为"帧复用池"模型：

```c++
// pyro_dji_motor_drv.h — TX 帧类
class dji_motor_tx_frame_t
{
    using _frame_key_t = std::pair<uint32_t, bsp_can::which_can>;  // 唯一键

    status_t register_id(register_id_t id);   // 电机注册到帧的某个槽位
    status_t update_value(uint8_t id, int16_t value); // 更新该槽位的扭矩值
};
```

**关键机制 — 全槽位就绪才发送**:

```c++
// pyro_dji_motor_drv.cpp
status_t dji_motor_tx_frame_t::update_value(uint8_t id, int16_t value)
{
    _value_list[id % 4]  = value;   // 写入扭矩值
    _update_list[id % 4] = 1;       // 标记已更新

    // 检查所有已注册槽位是否都已更新
    for (uint8_t i = 0; i < 4; i++)
    {
        if (_register_list[i])       // 槽位已注册
        {
            if (!_update_list[i])    // 但尚未更新
                return PYRO_ERROR;   // → 等待其他电机，暂不发送
        }
    }

    // 全部就绪 → 组装 8 字节 CAN 帧并立即发送
    for (uint8_t i = 0; i < 4; i++)
    {
        _update_list[i] = 0;         // 清零标记，等待下一轮
        data[i * 2]     = (_value_list[i] & 0xff00) >> 8;
        data[i * 2 + 1] = _value_list[i] & 0xff;
    }
    _can->send_msg(_key.first, data.data());
    return PYRO_OK;
}
```

这意味着：上层对同一帧内的每个电机独立调用 `send_torque()`，但 CAN 报文只在**最后一个电机的扭矩值到达时**才真正发出。每一轮控制循环中，帧内所有电机按顺序填充完毕后触发一次聚合发送。

#### 3.2 TX 帧池 (`dji_motor_tx_frame_pool_t`)

帧池是全局单例，通过 `(CAN_ID, which_can)` 组成的 `_frame_key_t` 去重——确保同一物理帧被多个关联电机共享：

```c++
dji_motor_tx_frame_t *dji_motor_tx_frame_pool_t::get_frame(bsp_can::which_can which, uint32_t id)
{
    dji_motor_tx_frame_t::_frame_key_t key(id, which);
    // 查找已有帧
    for (auto frame : _frame_list)
        if (frame->get_key() == key) return frame;

    // 不存在 → 新建并持久化到池中
    auto *frame = new dji_motor_tx_frame_t(which, id);
    _frame_list.push_back(frame);
    return frame;
}
```

#### 3.3 反馈解析 (`update_feedback`)

DJI 电机的反馈报文为标准 8 字节 CAN 数据帧，固定格式如下：

| 字节偏移    | 内容                 | 编码方式                                |
| ----------- | -------------------- | --------------------------------------- |
| `data[0:1]` | 机械角度 (uint16)    | raw / 8192 × 2π (rad), 映射到 (-π, π]   |
| `data[2:3]` | 转速 (int16)         | raw × 2π / 60 (rad/s)                   |
| `data[4:5]` | 实际扭矩电流 (int16) | raw / max_torque_i × max_torque_f (N·m) |
| `data[6]`   | 温度 (int8)          | 直接读取 (°C)                           |

```c++
status_t dji_motor_drv_t::update_feedback()
{
    std::array<uint8_t, 8> data{};
    if (!_feedback_msg || !_feedback_msg->is_fresh()) {
        // 在线判定: 1s 内有新数据即在线
        _online = dwt_drv_t::get_timeline_s() - _last_update_time < 1.0f;
        return PYRO_ERROR;
    }

    if (_feedback_msg->get_data(data))
    {
        _feedback_msg->mark_read();
        _last_update_time = dwt_drv_t::get_timeline_s();
    }

    _online = true;

    // 位置: uint16 → rad, 映射到 (-π, π]
    _current_position = ((float)((uint16_t)((data[0] << 8) | data[1]))) / 8192.0f * 2 * PI;
    if (_current_position > PI) _current_position -= 2 * PI;

    // 转速: int16 → rad/s
    _current_rotate = ((float)((int16_t)((data[2] << 8) | data[3]))) * 2 * PI / 60;

    // 扭矩: int16 → N·m (按额定扭矩比例缩放)
    _current_torque = ((float)((int16_t)((data[4] << 8) | data[5]))) / _max_torque_i * _max_torque_f;

    _temperature = (int8_t)(data[6]);
    return PYRO_OK;
}
```

#### 3.4 三款 DJI 电机的差异

各款电机通过构造函数中的不同参数化实现差异：

| 电机型号 | TX ID 范围                        | RX ID 公式       | 额定扭矩 (`_max_torque_f`) | 扭矩范围 (int16) | 减速比     |
| -------- | --------------------------------- | ---------------- | -------------------------- | ---------------- | ---------- |
| M3508    | `0x200` (id1-4) / `0x1FF` (id5-8) | `0x200 + id + 1` | 20.0 N·m                   | ±16384           | 19.203 : 1 |
| M2006    | 同上                              | 同上             | 10.0 N·m                   | ±10000           | 36 : 1     |
| GM6020   | `0x1FE` (id1-4) / `0x2FE` (id5-7) | `0x204 + id + 1` | 3.0 N·m                    | ±16384           | — (直驱)   |

注意：GM6020 最多支持 7 个 ID（id8 不可用），且使用独立的 CAN ID 空间 (`0x1FE`/`0x2FE`)。

**减速比常量** — `dji_m3508_motor_drv_t` 提供了减速比定义：

```c++
static constexpr float reduction_ratio = 19.20320855614973f;  // M3508 原装减速箱
static constexpr float reciprocal_reduction_ratio = 0.0520746310219994f;
```

这些常量供上层模块在需要输出轴角度/转速时使用（`get_current_position()` 返回的是电机转子端位置，乘以 `reciprocal_reduction_ratio` 得到输出轴位置）。

#### 3.5 扭矩裁剪

`send_torque()` 在发送前通过静态内联函数 `constraint()` 将扭矩值裁剪到 `±_max_torque_f` 范围内，防止因控制算法发散导致电调过流保护。

### 4. 达妙 (DM) 电机驱动 (`dm_motor_drv_t`)

DM 电机采用 MIT 控制模式协议，与 DJI 协议有显著差异：不通过帧池聚合，每个电机独立发送 8 字节 MIT 控制帧。

#### 4.1 MIT 控制帧结构

DM 电机的控制帧将位置、速度、KP、KD、扭矩五项参数封装在同一 CAN 报文中：

| 参数              | 位宽   | 量化范围                         | 说明                           |
| ----------------- | ------ | -------------------------------- | ------------------------------ |
| 位置 (`position`) | 16 bit | `[_min_position, _max_position]` | 期望位置，MIT 模式下通常设为 0 |
| 速度 (`rotate`)   | 12 bit | `[_min_rotate, _max_rotate]`     | 期望速度，MIT 模式下通常设为 0 |
| KP                | 12 bit | `[0, 500]`                       | 比例增益                       |
| KD                | 12 bit | `[0, 5]`                         | 阻尼增益                       |
| 扭矩 (`torque`)   | 12 bit | `[_min_torque, _max_torque]`     | 前馈扭矩                       |

```c++
// 浮点数 → 定点数的区间编码
static int float_to_uint(float x, float x_min, float x_max, int bits)
{
    float span   = x_max - x_min;
    float offset = x_min;
    return (int)((x - offset) * ((float)((1 << bits) - 1)) / span);
}

// 定点数 → 浮点数的区间解码
static float uint_to_float(int x_int, float x_min, float x_max, int bits)
{
    float span   = x_max - x_min;
    float offset = x_min;
    return ((float)x_int) * span / ((float)((1 << bits) - 1)) + offset;
}
```

编码使用区间映射方式：`float_to_uint` 将连续值映射到 `[0, 2^bits-1]` 的整数空间，`uint_to_float` 反向还原。与 DJI 的固定比例编码不同，DM 的编码范围通过 `set_position_range()` / `set_torque_range()` 等方法在运行时可调。

#### 4.2 错误码管理

DM 电机在反馈报文的 `data[0]` 高 4 位携带错误码：

```c++
enum error_code
{
    ok                    = 0x00,  // 正常
    over_votlage          = 0x08,  // 过压
    under_voltage         = 0x09,  // 欠压
    over_temperature      = 0x0a,  // 过温
    mos_over_temperature  = 0x0b,  // MOS 管过温
    coil_over_temperature = 0x0c,  // 线圈过温
    communication_lost    = 0x0d,  // 通信丢失
    over_load             = 0x0e,  // 过载
};
```

`update_feedback()` 每次解析反馈报文时自动更新 `_error_code`。非零错误码会强制清除 `_enable` 标志，确保故障电机不会被写入控制指令：

```c++
status_t dm_motor_drv_t::update_feedback()
{
    // ...
    _error_code = static_cast<error_code>(((data[0] >> 4) & 0x0f));
    switch (_error_code) {
        case error_code::ok: _enable = true; break;
        default:             _enable = false; break;
    }
    // ... 解析位置/转速/扭矩 ...
}
```

#### 4.3 使能/失能/清错

DM 电机的使能/失能/清错通过写入特定控制字实现（无需帧池）：

```c++
// 使能: 8 字节全 0xFF, 末字节 0xFC
status_t dm_motor_drv_t::enable()
{
    std::array<uint8_t, 8> data;
    data.fill(0xFF);
    data[7] = 0xfc;
    _can_drv->send_msg(_can_id, data.data());
    _enable = true;
    return PYRO_OK;
}

// 失能: 末字节 0xFD
// 清错: 末字节 0xFB
```

------

## Part 2: 快速上手 (Quick Start)

### 1. DJI 电机初始化

```c++
#include "pyro_dji_motor_drv.h"

// 创建电机实例：
// 参数1: 电机在帧中的槽位 (id_1 ~ id_8)
// 参数2: CAN 总线通道
static pyro::dji_m3508_motor_drv_t motor_lf(pyro::dji_motor_tx_frame_t::register_id_t::id_1,
                                             pyro::bsp_can::CAN1);
static pyro::dji_m3508_motor_drv_t motor_rf(pyro::dji_motor_tx_frame_t::register_id_t::id_2,
                                             pyro::bsp_can::CAN1);
static pyro::dji_m3508_motor_drv_t motor_lb(pyro::dji_motor_tx_frame_t::register_id_t::id_3,
                                             pyro::bsp_can::CAN1);
static pyro::dji_m3508_motor_drv_t motor_rb(pyro::dji_motor_tx_frame_t::register_id_t::id_4,
                                             pyro::bsp_can::CAN1);

// GM6020 云台电机（使用独立 CAN ID 空间）
static pyro::dji_gm_6020_motor_drv_t motor_yaw(pyro::dji_motor_tx_frame_t::register_id_t::id_1,
                                                pyro::bsp_can::CAN2);
```

### 2. 控制循环（DJI 电机）

```c++
void chassis_control_loop()
{
    // 1. 更新反馈（从 CAN 缓冲区拉取最新数据）
    motor_lf.update_feedback();
    motor_rf.update_feedback();
    motor_lb.update_feedback();
    motor_rb.update_feedback();

    // 2. 读取电机状态
    float pos_lf = motor_lf.get_current_position() *
                   pyro::dji_m3508_motor_drv_t::reciprocal_reduction_ratio;  // 输出轴位置
    float spd_lf = motor_lf.get_current_rotate() *
                   pyro::dji_m3508_motor_drv_t::reciprocal_reduction_ratio;  // 输出轴转速

    // 3. 控制算法计算扭矩
    float torque_lf = pid_compute(target_speed, spd_lf);

    // 4. 按顺序发送扭矩（同一帧内的电机必须全部调用 send_torque 后才自动聚合发送）
    motor_lf.send_torque(torque_lf);
    motor_rf.send_torque(torque_rf);
    motor_lb.send_torque(torque_lb);
    motor_rb.send_torque(torque_rb);  // ← 最后一个，触发聚合 CAN 发送

    vTaskDelay(pdMS_TO_TICKS(1));  // 1kHz 控制循环
}
```

### 3. DM 电机初始化与控制

```c++
#include "pyro_dm_motor_drv.h"

// DM 电机:
// 参数1: CAN ID (电机接收指令的 ID)
// 参数2: Master ID (电机上报反馈的 ID)
// 参数3: CAN 总线通道
static pyro::dm_motor_drv_t dm_motor(0x01, 0x02, pyro::bsp_can::CAN1);

void dm_motor_init()
{
    // 设置编码范围（需与电机实际参数匹配）
    dm_motor.set_position_range(-12.5f, 12.5f);
    dm_motor.set_rotate_range(-45.0f, 45.0f);
    dm_motor.set_torque_range(-10.0f, 10.0f);

    // 设置 MIT 模式 PID 参数
    dm_motor.set_runtime_kp(50.0f);
    dm_motor.set_runtime_kd(0.5f);

    // 使能电机
    dm_motor.enable();
}

void dm_motor_control_loop()
{
    while (true)
    {
        // 1. 更新反馈
        dm_motor.update_feedback();

        // 2. 检查错误
        auto err = dm_motor.get_error_code();
        if (err != pyro::dm_motor_drv_t::error_code::ok)
        {
            // 故障处理：记录错误码，尝试清除
            dm_motor.clear_error();
        }

        // 3. 发送 MIT 控制帧（扭矩 + KP + KD 在同一帧内）
        if (dm_motor.is_enable())
        {
            float torque = compute_torque();
            dm_motor.send_torque(torque);
        }

        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
```

### 4. 在线检测与健康监控

```c++
void motor_health_check()
{
    if (!motor_lf.is_online())
    {
        // 电机离线（1s 内无 CAN 反馈）
        // 立即失能所有电机，进入安全模式
        motor_lf.disable();
        motor_rf.disable();
        motor_lb.disable();
        motor_rb.disable();
    }

    // 温度监控
    if (motor_lf.get_temperature() > 80)
    {
        // 电机过温，降功率运行
    }
}
```

### 5. 注意事项 (Caveats)

1. **CAN 总线必须先初始化**: 创建电机实例前，对应的 CAN 总线必须已完成 `bsp_can::init_all()`。电机构造函数中调用 `bsp_can::get_can(which)` 获取 CAN 驱动指针，若总线未初始化将导致空指针。
2. **DJI 帧聚合的槽位分配**: 同一 CAN 帧内（4 个槽位）的所有电机必须在同一个控制循环中全部调用 `send_torque()`，最后一个调用才会触发实际的 CAN 发送。若某个槽位已注册但未调用 `send_torque()`，该帧将永远不会发送，导致同帧所有电机失能。
3. **扭矩方向与裁剪**: `send_torque()` 内部通过 `constraint()` 函数将扭矩裁剪到 `±_max_torque_f`。传入超出范围的值不会报错，会被静默截断。
4. **DM 电机的编码范围**: 调用 `set_position_range()` 等方法设定的范围必须与实际电机固件参数一致。范围不匹配将导致位置/速度解算错误，扭矩控制偏离预期。
5. **GM6020 ID 限制**: GM6020 仅支持 id1~id7，id8 为无效值。尝试以 id8 构造 `dji_gm_6020_motor_drv_t` 将导致 `_init_status = PYRO_ERROR`。
6. **反馈更新频率**: `update_feedback()` 应至少以 1kHz 频率调用。CAN 消息缓冲区的 `is_fresh()` 是单次消费标记——若两帧反馈之间上层只调用了一次 `update_feedback()`，将丢失一帧数据。建议将电机控制循环置于 FreeRTOS 任务中以 `vTaskDelay(1)` 严格定时。
7. **线程安全**: 电机实例本身不提供内置互斥锁。若多个任务同时访问同一电机实例（例如一个任务读反馈、另一个任务发扭矩），需在上层加锁保护。

## Q&A