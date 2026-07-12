# PYRo Module 开发指南

`pyro::module_base_t` 是 PYRo 框架中机器人模块的基类模板，采用 CRTP（奇异递归模板模式）提供类型安全的单例机制，并结合 FreeRTOS 任务与 HFSM（层级有限状态机）实现回调驱动的模块架构。

------

## 第一部分：快速使用

> 目标：15 分钟内完成一个新模块的开发框架。

### 1. 六步创建模块

以下以 `screw_gimbal_t`（丝杆云台）为例。

#### 步骤 1：定义命令类型

命令继承 `cmd_base_t`，包含 `mode`（PASSIVE/ACTIVE）和 `timestamp`。在命令结构体中添加模块所需的控制字段。

```cpp
struct screw_gimbal_cmd_t final : public cmd_base_t
{
    float pitch_delta_angle;
    float yaw_delta_angle;
    bool trigger_calibration;
    bool sling_mode;
    bool autoaim_mode;
    bool track_en;
    float target_pitch;
    float target_yaw;

    screw_gimbal_cmd_t()
        : pitch_delta_angle(0.0f), yaw_delta_angle(0.0f),
          trigger_calibration(false), sling_mode(false),
          autoaim_mode(false), track_en(false),
          target_pitch(0.0f), target_yaw(0.0f)
    {
    }
};
```

> **要点：** 构造函数中所有字段必须显式初始化为安全默认值。

#### 步骤 2：定义模块依赖类型

依赖是模块外部注入的资源（电机句柄、PID/观测器对象等），通过 `configure()` 在模块启动前注入。

```cpp
struct screw_gimbal_deps_t
{
    struct motor_deps_t
    {
        motor_base_t *pitch{nullptr};
        motor_base_t *yaw{nullptr};
    };

    struct pid_deps_t
    {
        pid_t *pitch_pos{nullptr};
        pid_t *pitch_spd{nullptr};
        pid_t *pitch_auto_pos{nullptr};
        pid_t *pitch_auto_spd{nullptr};
        pid_t *yaw_pos{nullptr};
        pid_t *yaw_spd{nullptr};
        pid_t *yaw_relative_pos{nullptr};
        pid_t *yaw_relative_spd{nullptr};
        leso_t<3> *yaw_pos_leso{nullptr};
        leso_t<2> *yaw_spd_leso{nullptr};
        leso_t<3> *yaw_pos_imu_leso{nullptr};
        leso_t<2> *yaw_spd_imu_leso{nullptr};
    };

    motor_deps_t motor_deps{};
    pid_deps_t pid_deps{};
};
```

> **要点：** 所有指针默认初始化为 `nullptr`，依赖按功能分组为子结构体。

#### 步骤 3：定义数据上下文

数据上下文存放模块运行时的动态状态——传感器读数、控制中间量、输出值等。

```cpp
struct screw_gimbal_data_ctx_t
{
    bool is_calibrating{false};
    bool has_initial_calibrated{false};

    float pitch_imu_rad{0};
    float pitch_imu_radps{0};
    float yaw_imu_rad{0};
    float yaw_imu_radps{0};

    float current_pitch_motor_rad{0};
    float current_pitch_motor_radps{0};

    float target_pitch_rad{0};
    float target_pitch_radps{0};
    float target_yaw_rad{0};
    float target_yaw_radps{0};

    float out_pitch_torque{0};
    float out_yaw_torque{0};
    // ... 更多状态字段
};
```

> **要点：** 所有字段使用安全的默认值初始化。

#### 步骤 4：组合模块上下文

将依赖引用、数据上下文、命令指针组合为统一的上下文类型。

```cpp
struct screw_gimbal_context_t
{
    screw_gimbal_deps_t::motor_deps_t motor;
    screw_gimbal_deps_t::pid_deps_t pid;
    screw_gimbal_data_ctx_t data;
    screw_gimbal_cmd_t *cmd{};
};
```

| 字段            | 来源                                           | 说明               |
| --------------- | ---------------------------------------------- | ------------------ |
| `motor` / `pid` | `_module_deps` → `_ctx`（在 `_init()` 中赋值） | 外部注入的依赖引用 |
| `data`          | 模块自身维护                                   | 运行时的动态数据   |
| `cmd`           | `_current_cmd`（在 `_fsm_execute()` 中赋值）   | 指向当前命令的指针 |

#### 步骤 5：定义参数聚合类型

```cpp
struct screw_gimbal_module_params_t
{
    using CmdType    = screw_gimbal_cmd_t;
    using ModuleDeps = screw_gimbal_deps_t;
    using ModuleCtx  = screw_gimbal_context_t;
};
```

> **三个别名缺一不可。** 基类通过它们推导所有内部类型。

#### 步骤 6：实现模块类

```cpp
class screw_gimbal_t final
    : public module_base_t<screw_gimbal_t, screw_gimbal_module_params_t>
{
    friend class module_base_t<screw_gimbal_t, screw_gimbal_module_params_t>;

  public:
    using data_ctx_t       = screw_gimbal_data_ctx_t;
    using gimbal_context_t = screw_gimbal_context_t;

  private:
    screw_gimbal_t();
    ~screw_gimbal_t() override = default;

    // --- 基类接口（必须实现）---
    status_t _init() override;
    void _update_feedback() override;
    void _fsm_execute() override;

    // --- 私有辅助方法 ---
    void _gimbal_control();
    void _gimbal_autoaim_control();
    void _gimbal_sling_control();
    static void _send_motor_command(screw_gimbal_module_params_t::ModuleCtx *ctx);

    // --- 状态机定义 ---
    using owner = screw_gimbal_t;

    struct fsm_passive_t : public fsm_t<owner> { /* ... */ };
    struct fsm_active_t : public fsm_t<owner> { /* ... */ };

    fsm_passive_t _fsm_passive;
    fsm_active_t _fsm_active;
    fsm_t<owner> _main_fsm;
};
```

------

### 2. 三个必须实现的回调

#### `_init()` — 初始化

```cpp
status_t screw_gimbal_t::_init()
{
    _ctx.motor = _module_deps.motor_deps;
    _ctx.pid   = _module_deps.pid_deps;
    return PYRO_OK;
}
```

将 `_module_deps` 中通过 `configure()` 注入的资源复制到 `_ctx` 中。

#### `_update_feedback()` — 反馈更新（每 1ms）

```cpp
void screw_gimbal_t::_update_feedback()
{
    // 1. 刷新电机反馈
    _ctx.motor.pitch->update_feedback();
    _ctx.motor.yaw->update_feedback();

    // 2. 读取电机原始数据并做运动学解算
    float now_pitch_rotor_rad = _ctx.motor.pitch->get_current_position();
    // ... 过零点处理、角速度解算 ...

    // 3. 读取 IMU
    ins_drv_t::get_instance()->get_rads_n(
        &_ctx.data.yaw_imu_rad, &_ctx.data.pitch_imu_rad, &_ctx.data.roll_imu_rad);

    // 4. 通信数据同步
    _communicate_chassis();
    _calculate_relative_angles();
}
```

**常见模式：**

- 调用 `motor->update_feedback()` 刷新各电机数据
- 通过 `get_current_position()` / `get_current_rotate()` / `get_current_torque()` 读取反馈
- 读取 IMU 等传感器数据
- 执行运动学解算，将原始数据转换为 `_ctx.data` 中的工程值

#### `_fsm_execute()` — 状态机调度（每 1ms）

```cpp
void screw_gimbal_t::_fsm_execute()
{
    _ctx.cmd = &_current_cmd;

    bool allow_active = (cmd_base_t::mode_t::ACTIVE == _ctx.cmd->mode);

    if (_ctx.data.is_calibrating || !_ctx.data.has_initial_calibrated)
        allow_active = false;  // 安全互锁

    if (allow_active)
        _main_fsm.change_state(&_fsm_active);
    else
        _main_fsm.change_state(&_fsm_passive);

    _main_fsm.execute(this);
}
```

> **标准模式：** 根据 `_current_cmd.mode` 切换 PASSIVE / ACTIVE 顶层状态，然后调用 `_main_fsm.execute(this)`。

------

### 3. 构造函数模板

```cpp
screw_gimbal_t::screw_gimbal_t() : module_base_t("screw_gimbal")
{
    _ctx = {};  // 清零整个上下文
}
```

- 第一个参数是任务名称（用于 FreeRTOS 调试）
- 可选的栈大小和优先级参数有默认值：`init_stack=512`, `loop_stack=256`, `priority=HIGH`

------

### 4. 应用层：启动与命令下发

#### 初始化线程

```cpp
void hero_gimbal_init(void *argument)
{
    board_drv_ptr        = &pyro::board_drv_t::get_instance();
    screw_gimbal_cmd_ptr = new pyro::screw_gimbal_cmd_t();
    screw_gimbal_ptr     = pyro::screw_gimbal_t::instance();

    deps_init();                                     // 创建并配置依赖
    screw_gimbal_ptr->configure(*screw_gimbal_deps); // 注入依赖
    screw_gimbal_ptr->start();                       // 启动模块任务

    xTaskCreate(hero_gimbal_thread, "start_app_thread", 128, nullptr,
                configMAX_PRIORITIES - 1, &gimbal_task_handle);
    vTaskDelete(nullptr);
}
```

#### 命令线程

```cpp
void hero_gimbal_thread(void *argument)
{
    while (true)
    {
        uint32_t notify_val = 0;
        xTaskNotifyWait(0x00, UINT32_MAX, &notify_val, 0);

        // 处理按键事件 → 更新 cmd 字段
        if (notify_val & EVENT_BIT_SLING_TOGGLE)
            is_sling_mode = !is_sling_mode;

        // 读取遥控器 → 填充 cmd
        screw_gimbal_cmd_ptr->mode = pyro::cmd_base_t::mode_t::ACTIVE;
        screw_gimbal_cmd_ptr->pitch_delta_angle = -vrc.axes.ry * 0.0025f;
        screw_gimbal_cmd_ptr->yaw_delta_angle   = -vrc.axes.rx * 0.0035f;

        // 下发命令
        screw_gimbal_ptr->set_command(*screw_gimbal_cmd_ptr);
        vTaskDelay(1);
    }
}
```

> **要点：** 命令线程通过 `set_command()` 写入环形缓冲区，模块循环通过 `_update_command()` 消费（线程安全）。

------

### 5. 生命周期速查

```
new CmdType()  ──→ configure(deps)  ──→ start()  ──→ 循环运行 ──→ 析构
       │                                              │
       └── set_command() ←── 遥控器/上位机 ──────────┘
```

| 阶段   | 调用的方法                                          | 说明                                   |
| ------ | --------------------------------------------------- | -------------------------------------- |
| 创建   | `instance()`                                        | CRTP 单例，首次调用时构造              |
| 配置   | `configure(deps)`                                   | 注入依赖，必须在 `start()` 前调用      |
| 启动   | `start()`                                           | 创建 FreeRTOS 任务，自动调用 `_init()` |
| 运行时 | `set_command(cmd)`                                  | 线程安全写入，环形缓冲区 FIFO          |
| 循环   | `_init()` → `_update_feedback()` → `_fsm_execute()` | 1ms 周期                               |

------

### 6. 完整模块模板

```cpp
// =========================================================
// 1. 命令定义
// =========================================================
struct my_module_cmd_t final : public cmd_base_t
{
    // 控制字段...

    my_module_cmd_t()
    {
        // 安全默认值...
    }
};

// =========================================================
// 2. 依赖定义
// =========================================================
struct my_module_deps_t
{
    motor_base_t *motor{nullptr};
    pid_t *pid{nullptr};
};

// =========================================================
// 3. 数据上下文
// =========================================================
struct my_module_data_ctx_t
{
    float value{0.0f};
};

// =========================================================
// 4. 模块上下文
// =========================================================
struct my_module_context_t
{
    motor_base_t *motor;
    pid_t *pid;
    my_module_data_ctx_t data;
    my_module_cmd_t *cmd{};
};

// =========================================================
// 5. 参数聚合
// =========================================================
struct my_module_params_t
{
    using CmdType    = my_module_cmd_t;
    using ModuleDeps = my_module_deps_t;
    using ModuleCtx  = my_module_context_t;
};

// =========================================================
// 6. 模块类
// =========================================================
class my_module_t final
    : public module_base_t<my_module_t, my_module_params_t>
{
    friend class module_base_t<my_module_t, my_module_params_t>;

  public:
    using data_ctx_t = my_module_data_ctx_t;

  private:
    my_module_t();
    ~my_module_t() override = default;

    status_t _init() override;
    void _update_feedback() override;
    void _fsm_execute() override;

    // --- 业务方法 ---
    void _control();

    // --- 状态机 ---
    using owner = my_module_t;
    struct state_passive_t final : public state_t<owner> { /* ... */ };
    struct fsm_active_t final : public fsm_t<owner>     { /* ... */ };

    state_passive_t _state_passive;
    fsm_active_t _state_active;
    fsm_t<owner> _main_fsm;
};
```

------

### 7. 快速参考：基类 API

#### 公共接口

| 方法                                     | 说明                                     |
| ---------------------------------------- | ---------------------------------------- |
| `static Derived *instance()`             | CRTP 单例                                |
| `status_t start()`                       | 启动 FreeRTOS 任务                       |
| `bool set_command(const CmdType &cmd)`   | 线程安全写入环形缓冲区，满时返回 `false` |
| `void configure(const ModuleDeps &deps)` | 注入模块依赖（`start()` 前调用）         |
| `mutex_t &get_mutex()`                   | 获取模块互斥锁                           |
| `const ModuleCtx &get_ctx() const`       | 获取模块上下文（只读）                   |

#### 派生类必须实现

| 虚函数                    | 调用时机           | 职责                                |
| ------------------------- | ------------------ | ----------------------------------- |
| `status_t _init()`        | 任务启动时（一次） | 从 `_module_deps` 复制依赖到 `_ctx` |
| `void _update_feedback()` | 每 1ms             | 刷新传感器和电机反馈                |
| `void _fsm_execute()`     | 每 1ms             | 根据命令调度状态机                  |

#### 派生类可访问的 protected 成员

| 成员           | 类型         | 说明                                   |
| -------------- | ------------ | -------------------------------------- |
| `_current_cmd` | `CmdType`    | 当前正在执行的命令                     |
| `_module_deps` | `ModuleDeps` | 通过 `configure()` 注入的依赖          |
| `_ctx`         | `ModuleCtx`  | 模块上下文（基类持有，派生类直接使用） |

------

## 第二部分：代码详解

> 目标：深入理解 `module_base_t` 的架构设计、HFSM 状态机机制及内部运行原理。

### 1. 架构概览

```
┌─────────────── Application Layer ───────────────┐
│  init thread          command thread             │
│  - new cmd            - rc → cmd 转换             │
│  - new deps           - set_command() 下发        │
│  - configure()                                  │
│  - start()                                       │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼── Module Layer ──────────────┐
│  module_base_t<Derived, ModuleParams>             │
│  ┌─────────────────────────────────────────────┐ │
│  │ 环形缓冲区 (CMD_BUF_SIZE=16)                 │ │
│  │ _update_command() → _current_cmd            │ │
│  │ _update_feedback() → 传感器/电机数据刷新      │ │
│  │ _fsm_execute()    → 状态机调度               │ │
│  └─────────────────────────────────────────────┘ │
│  每 1ms 循环执行一次 (FreeRTOS 任务)              │
└──────────────────────────────────────────────────┘
```

核心循环（`_run_loop_impl`）以 1ms 为周期，顺序执行：

1. `_update_command()` — 从环形缓冲区取出最新命令（Zero-Order Hold）
2. `_update_feedback()` — 刷新传感器、电机反馈数据
3. `_fsm_execute()` — 根据命令模式调度状态机

------

### 2. HFSM 状态机模式

每个模块使用二级层级状态机。`fsm_t` 继承自 `state_t`，这意味着一个状态机本身也是一个状态，可以嵌套到父状态机中。

```
_main_fsm (fsm_t<owner>)
├── _fsm_passive / _state_passive
│   ├── calibration_state  (校准)
│   └── idle_state         (待机)
└── _fsm_active / _state_active
    ├── normal_state       (常规控制)
    ├── autoaim_state      (自瞄)
    └── sling_state        (吊射)
```

#### 简单状态（单层，无子状态）

继承 `state_t<owner>`，实现三个生命周期钩子：

```cpp
struct state_passive_t final : public state_t<owner>
{
    void enter(owner *owner) override;
    void execute(owner *owner) override;
    void exit(owner *owner) override;
};
```

#### 复合状态（嵌套子状态机）

继承 `fsm_t<owner>`，既可拥有子状态，也可覆盖自身的生命周期钩子：

```cpp
struct fsm_active_t final : public fsm_t<owner>
{
    struct cruising_state_t final : public state_t<owner> { /* ... */ };
    struct climbing_fsm_t final : public fsm_t<owner>      { /* ... */ };

    void on_enter(owner *owner) override;
    void on_execute(owner *owner) override;
    void on_exit(owner *owner) override;

  private:
    cruising_state_t cruising_state;
    climbing_fsm_t climbing_fsm;
};
```

#### 关键区别

| 基类             | 生命周期钩子                                                 | 子状态 | 用途     |
| ---------------- | ------------------------------------------------------------ | ------ | -------- |
| `state_t<owner>` | `enter()` / `execute()` / `exit()`                           | 无     | 叶子状态 |
| `fsm_t<owner>`   | `on_enter()` / `on_execute()` / `on_exit()` + `change_state()` | 有     | 组合状态 |

#### PASSIVE / ACTIVE 切换模式

```cpp
void motor_ctrl_t::_fsm_execute()
{
    _ctx.cmd = &_current_cmd;

    if (_ctx.cmd->mode == cmd_base_t::mode_t::ACTIVE)
        _main_fsm.change_state(&_state_active);
    else
        _main_fsm.change_state(&_state_passive);

    _main_fsm.execute(this);
}
```

------

### 3. 模块生命周期详解

```
new CmdType()          ──→ configure(deps)  ──→ start()  ──→ 循环运行 ──→ 析构
       │                                              │
       └── set_command() ←── 遥控器/上位机 ──────────┘
```

| 阶段   | 调用的方法                                          | 说明                                   |
| ------ | --------------------------------------------------- | -------------------------------------- |
| 创建   | `instance()`                                        | CRTP 单例，首次调用时构造              |
| 配置   | `configure(deps)`                                   | 注入依赖，必须在 `start()` 前调用      |
| 启动   | `start()`                                           | 创建 FreeRTOS 任务，自动调用 `_init()` |
| 运行时 | `set_command(cmd)`                                  | 线程安全写入，环形缓冲区 FIFO          |
| 循环   | `_init()` → `_update_feedback()` → `_fsm_execute()` | 1ms 周期                               |

------

### 4. 任务规划器

```cpp
void start_mission_planer_task(void const *argument)
{
    xTaskCreate(pyro_init_thread, "pyro_init_thread", 512, nullptr,
                configMAX_PRIORITIES - 1, nullptr);

#if BOARD == GIMBAL_BOARD
    xTaskCreate(hero_gimbal_init, "pyro_gimbal_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
    vTaskDelay(10);
    xTaskCreate(hero_booster_init, "pyro_booster_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
#elif BOARD == CHASSIS_BOARD
    xTaskCreate(hero_chassis_init, "pyro_chassis_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
#endif

    xTaskCreate(hero_board_com_init, "pyro_board_com_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);

    vTaskDelete(nullptr);
}
```

------

### 5. 设计决策 FAQ

#### `_ctx` 在哪里定义？

`_ctx` 是 `module_base_t` 的 `protected` 成员，类型为 `ModuleCtx`。派生类直接使用 `_ctx.xxx` 即可，无需自己声明。

#### `_ctx` 在什么时候需要清零？

在构造函数中：

```cpp
my_module_t::my_module_t() : module_base_t("my_module")
{
    _ctx = {};
}
```

#### 命令为什么用环形缓冲区？

`set_command()` 可能被遥控器线程高频调用，环形缓冲区解耦了生产者（命令线程）和消费者（模块循环），避免锁竞争。缓冲区大小为 16 条（2 的幂），满时丢弃新命令。

#### `ModuleCtx` 为什么必须定义在类外？

因为 `module_base_t` 持有 `ModuleCtx _ctx` 成员，在基类实例化时需要 `ModuleCtx` 的完整定义。嵌套在模块类内部的类型在继承基类时尚不完整。

#### 电机和 PID 为什么放在 `_ctx` 中而不是直接用 `_module_deps`？

`_module_deps` 保存的是原始注入值。`_ctx` 中的 `motor`/`pid` 在 `_init()` 中被赋值后，所有状态机状态通过 `owner->_ctx.xxx` 访问，路径统一。这是约定而非强制。