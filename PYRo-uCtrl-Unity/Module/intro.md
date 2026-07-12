Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_module_base.h"/><Badge type = "info" text="pyro_module_base.cpp"/>

# PYRo Module Base (模块基类)

这是一个基于 **CRTP (奇异递归模板模式)** 的机器人模块框架。`module_base_t<Derived, ModuleParams>` 为每个模块提供类型安全的单例、线程安全的命令环形缓冲区、FreeRTOS 任务调度以及 HFSM (层级有限状态机) 集成。派生类只需实现三个纯虚回调——`_init()` / `_update_feedback()` / `_fsm_execute()`——即可获得完整的模块生命周期管理。
> 嵌入式开发前置知识：了解 C++ CRTP 模式、FreeRTOS 任务机制、HFSM 状态机

## Part 1: 代码详解 (Code Explanation)

### 1. 核心设计理念

- **CRTP 静态多态**: `module_base_t<Derived, ModuleParams>` 以派生类自身作为第一个模板参数，编译期绑定类型。这避免了 `virtual` 派发的运行时开销，同时 `instance()` 能返回正确的派生类指针。

- **ModuleParams 聚合类型**: 新版的第二个模板参数是一个聚合结构体，统一声明三个类型别名：
  - `CmdType` — 继承自 `cmd_base_t` 的命令类型，定义模块对外接收的控制指令
  - `ModuleDeps` — 模块依赖类型（驱动指针、算法对象等），在 `configure()` 中注入
  - `ModuleCtx` — 模块运行时上下文，由基类统一持有 `_ctx`，派生类通过继承直接访问

- **基类统一持有 `_ctx`**: 不同于旧版派生类自己定义、持有和暴露 context，新版 `module_base_t` 内部声明 `ModuleCtx _ctx`（`protected`），派生类直接使用 `_ctx` 即可，无需重复定义。

### 2. 关键实现机制

#### A. 命令环形缓冲区 (`set_command` / `_update_command`)

- **无锁化生产-消费**: 基类内部维护一个 `CmdType _cmd_buffer[CMD_BUF_SIZE]` (默认 16，建议为 2 的幂)，配合 `_head` (写指针) / `_tail` (读指针) 构成环形 FIFO。

- **生产者 (`set_command`)**: 被外部线程调用（如通信任务）。在 `scoped_mutex_t` 保护下判断 `(head + 1) % BUF_SIZE != tail`。若缓冲区未满，写入并推进 `_head`；若已满，返回 `false` 丢弃新命令，防止覆盖未执行的旧轨迹。

- **消费者 (`_update_command`)**: 在主循环的 `_run_loop_impl()` 开头被调用（同线程，无需锁）。若 `_head != _tail`，读取 `_cmd_buffer[_tail]` 到 `_current_cmd` 并推进 `_tail`；若为空，保持 `_current_cmd` 不变 (零阶保持, Zero-Order Hold)，确保控制量连续。

#### B. 内部任务循环 (`_run_loop_impl`)

```text
┌─────────────────────────────────────────┐
│  while (true) {                         │
│    _update_command();    // 消费命令     │
│    _update_feedback();   // 更新反馈     │
│    _fsm_execute();       // 执行状态机   │
│    vTaskDelayUntil(&xLastWakeTime, 1ms);│
│  }                                      │
└─────────────────────────────────────────┘
```

- **1kHz 固定频率**: 使用 `vTaskDelayUntil()` 实现严格的 1ms 周期调度，不受循环体耗时波动影响。

- **`module_task_t` 代理**: 基类内部定义一个 `module_task_t`（继承自 `task_base_t`），在 `init()` 中回调派生类的 `_init()`，在 `run_loop()` 中回调 `_run_loop_impl()`。`start()` 即调用 `_task.start()` 创建 FreeRTOS 任务。

#### C. 配置注入 (`configure`)

- **启动前注入**: `configure(const ModuleDeps &deps)` 将外部配置（驱动指针、PID 参数等）写入 `_module_deps`。**必须在 `start()` 之前调用**，因为任务启动后就进入 `_init()`，而 `_init()` 通常将 `_module_deps` 赋值到 `_ctx` 中供后续使用。

- **非线程安全**: `configure()` 不加锁，假设在系统初始化阶段（调度器启动前或任务启动前）单线程调用。

#### D. CRTP 单例 (`instance()`)

```cpp
static Derived *instance()
{
    static Derived _instance_obj;  // 函数内 static，延迟初始化
    return &_instance_obj;
}
```

- **延迟构造**: 首次调用 `instance()` 时才构造对象，避免全局静态初始化顺序问题。
- **类型安全**: 返回 `Derived *` 而非基类指针，无需 `dynamic_cast`。
- **派生类构造**: 构造函数为 `private`，仅 `instance()` 可调用，确保全局唯一。构造函数中必须调用基类构造函数 `module_base_t("name")` 传入任务名。

#### E. get_ctx()

基类提供 `const` 版本的 `get_ctx()`：

```cpp
[[nodiscard]] const ModuleCtx &get_ctx() const;
```

返回的是 `_ctx` 的只读引用。外部使用者通过 `Module::instance()->get_ctx()` 获取模块状态进行监控/日志，而模块内部通过 `_ctx` 直接读写。

### 3. 模块生命周期

```text
  构造 (instance() 首次调用)
    │
    ▼
  configure(deps)    ← 注入驱动、算法等依赖
    │
    ▼
  start()            ← 创建 FreeRTOS 任务
    │
    ▼
  _init()            ← 任务初始化回调：将 _module_deps 赋值到 _ctx
    │
    ▼
  ┌─ while(true) ──────────────────────────┐
  │ _update_command()  ← 消费环形缓冲区     │
  │ _update_feedback() ← 读取传感器/驱动    │
  │ _fsm_execute()     ← 状态机 + 控制算法  │
  │ vTaskDelayUntil(1ms)                   │
  └────────────────────────────────────────┘
    │
    ▼
  set_command(cmd)    ← 外部线程随时写入命令
```

## Part 2: 快速使用 (Quick Start)

### 1. 准备工作

确保工程已包含以下头文件依赖：
- `pyro_module_base.h` — 模块基类
- `pyro_core_def.h` — `status_t` 枚举 (`PYRO_OK` / `PYRO_ERROR`)
- `pyro_core_fsm.h` — HFSM 框架（可选，若模块需要状态机）
- `FreeRTOS.h` / `cmsis_os.h` — FreeRTOS

### 2. 最小模块模板

```cpp
#include "pyro_module_base.h"

namespace pyro
{

// ==========================================
// 1. 命令类型
// ==========================================
struct my_module_cmd_t final : public cmd_base_t
{
    float target_value{0.0f};
};

// ==========================================
// 2. 依赖类型（无依赖时也需定义空结构体）
// ==========================================
struct my_module_deps_t
{
};

// ==========================================
// 3. 运行时上下文
// ==========================================
struct my_module_ctx_t
{
    my_module_cmd_t *cmd{nullptr};
    float current_value{0.0f};
};

// ==========================================
// 4. ModuleParams 聚合
// ==========================================
struct my_module_params_t
{
    using CmdType    = my_module_cmd_t;
    using ModuleDeps = my_module_deps_t;
    using ModuleCtx  = my_module_ctx_t;
};

// ==========================================
// 5. 模块类
// ==========================================
class my_module_t final
    : public module_base_t<my_module_t, my_module_params_t>
{
    friend class module_base_t<my_module_t, my_module_params_t>;

private:
    my_module_t()
        : module_base_t("my_module")  // 传入任务名
    {
        _ctx = {};
    }

    status_t _init() override
    {
        // _module_deps 已在 configure() 中注入
        return PYRO_OK;
    }

    void _update_feedback() override
    {
        // 读取传感器、更新 _ctx.data
    }

    void _fsm_execute() override
    {
        _ctx.cmd = &_current_cmd;

        // 根据 cmd 执行控制逻辑
        if (_ctx.cmd->mode == cmd_base_t::mode_t::ACTIVE)
        {
            _ctx.current_value = _ctx.cmd->target_value;
        }
    }
};

} // namespace pyro
```

### 3. 功能示例

#### 场景 A：注入依赖并启动模块

通常在 `main()` 或初始化任务中完成：

```cpp
#include "my_module.h"

void app_init()
{
    auto *module = pyro::my_module_t::instance();

    // 1. 准备依赖（如果有驱动指针等）
    pyro::my_module_deps_t deps{};

    // 2. 注入依赖（必须在 start() 之前）
    module->configure(deps);

    // 3. 启动模块任务
    if (PYRO_OK != module->start())
    {
        Error_Handler();
    }
}
```

#### 场景 B：从外部发送命令

其他任务（如通信解析任务）通过 `set_command()` 向模块发送指令：

```cpp
void comm_task()
{
    pyro::my_module_cmd_t cmd;
    cmd.mode          = pyro::cmd_base_t::mode_t::ACTIVE;
    cmd.target_value  = 1.5f;
    cmd.timestamp     = xTaskGetTickCount();

    bool accepted = pyro::my_module_t::instance()->set_command(cmd);

    if (!accepted)
    {
        // 命令缓冲区已满，丢弃本次命令
        // 可记录日志或稍后重试
    }
}
```

#### 场景 C：带驱动依赖的完整模块

一个典型的带 CAN 通信和电机驱动的模块：

```cpp
// --- my_module_deps_t 定义 ---
struct module_deps_t
{
    pyro::motor_base_t *motor{nullptr};
    pyro::pid_t *pid_pos{nullptr};
    pyro::pid_t *pid_spd{nullptr};
};

struct mo

struct motor_ctrl_ctx_t
{
    module_deps_t *module_deps{nullptr};
    float current_position{0.0f};
    float current_velocity{0.0f};
    float output_torque{0.0f};
    module_cmd_t *cmd{nullptr};
};

// --- _init() 中桥接依赖到上下文 ---
status_t motor_ctrl_t::_init()
{
    _ctx.motor   = _module_deps.motor;
    _ctx.pid_pos = _module_deps.pid_pos;
    _ctx.pid_spd = _module_deps.pid_spd;

    if (nullptr == _ctx.motor || nullptr == _ctx.pid_pos || nullptr == _ctx.pid_spd)
        return PYRO_ERROR;

    return PYRO_OK;
}

// --- _update_feedback() 中读取 ---
void motor_ctrl_t::_update_feedback()
{
    _ctx.motor->update_feedback();
    _ctx.current_position = _ctx.motor->get_current_position();
    _ctx.current_velocity = _ctx.motor->get_current_rotate();
}

// --- _fsm_execute() 中控制 ---
void motor_ctrl_t::_fsm_execute()
{
    _ctx.cmd = &_current_cmd;

    if (_ctx.cmd->mode == cmd_base_t::mode_t::ACTIVE)
    {
        float spd_ref = _ctx.pid_pos->calculate(_ctx.cmd->target_position, _ctx.current_position);
        _ctx.output_torque = _ctx.pid_spd->calculate(spd_ref, _ctx.current_velocity);
        _ctx.motor->send_torque(_ctx.output_torque);
    }
}

// --- 外部注入示例 ---
void app_init()
{
    motor_ctrl_deps_t deps;
    deps.motor   = &g_motor;    // 全局电机对象
    deps.pid_pos = &g_pid_pos;  // 全局位置 PID
    deps.pid_spd = &g_pid_spd;  // 全局速度 PID

    auto *module = motor_ctrl_t::instance();
    module->configure(deps);
    module->start();
}
```

#### 场景 D：模块间通过 get_ctx() 通信

下游模块（如底盘）需要读取上游模块（如云台）的状态：

```cpp
void chassis_t::_fsm_execute()
{
    // 读取云台模块的上下文（只读）
    const auto &gimbal_ctx = screw_gimbal_t::instance()->get_ctx();

    // 获取云台当前姿态
    float gimbal_yaw   = gimbal_ctx.data.yaw_imu_rad;
    float gimbal_pitch = gimbal_ctx.data.pitch_imu_rad;

    // 底盘根据云台姿态调整运动策略...
}
```

### 4. 注意事项 (Caveats)

1. **`configure()` 必须在 `start()` 之前调用**: 模块任务启动后立即执行 `_init()`，若此时 `_module_deps` 尚未填充，将导致空指针访问。

2. **`set_command()` 可在任意线程调用**: 内部已用 `scoped_mutex_t` 保护环形缓冲区，线程安全。但若缓冲区满（16 条未消费命令），新命令将被丢弃并返回 `false`。

3. **`_update_feedback()` 和 `_fsm_execute()` 在模块任务线程中执行**: 这两个函数中无需额外加锁，它们与 `_update_command()` 在同一线程中顺序执行。

4. **避免在回调中长时间阻塞**: 模块循环以 1kHz 运行（1ms/周期），若三个回调总耗时超过 1ms，将导致任务周期漂移。耗时操作应放在中断或 DMA 中完成。

5. **`_ctx` 初始化**: 在构造函数中务必执行 `_ctx = {}` 将所有成员归零，避免未初始化的浮点数/指针导致不确定行为。

6. **ModuleCtx 必须是完整类型**: 由于基类内部持有 `ModuleCtx _ctx`，`ModuleCtx` 必须在模块类继承基类之前定义完成。不能将 `ModuleCtx` 定义在模块类内部（否则为 incomplete type）。

7. **命令缓冲区大小**: 默认 `CMD_BUF_SIZE = 16`。如果生产者写入速度持续高于消费者消费速度（1kHz），缓冲区最终会满。合理设计命令频率，或增大缓冲区。

8. **构造函数私有**: 模块构造函数必须为 `private`，仅通过 `instance()` 创建实例。构造函数中调用基类构造函数时传入任务名（用于 FreeRTOS 调试），可选的栈大小和优先级参数见头文件。

## Q&A