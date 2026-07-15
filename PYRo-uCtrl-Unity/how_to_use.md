Version<Badge type ="tip" text="1.0.0"/>

# 如何上手使用当前的 PYRo 库

本文档以**英雄机器人 (Hero)** 项目为例，介绍如何基于 PYRo-uCtrl-Unity 框架从零搭建一台 RoboMaster 机器人的嵌入式软件工程。阅读完本文后，你将能够按照相同的模式组织你自己的机器人代码。

> 前置知识：需要对 PYRo 框架的核心模块有基础了解，包括 [FSM](Core/FSM.md)、[Task](Core/Task.md)、[CAN](Peripheral/CAN.md)、[UART](Peripheral/UART.md)、[电机](Component/Motor.md) 等。

> 参考工程：PYRo-Hero，以下代码片段均来自于此工程。

---

## Part 0: 从空文件夹开始 (Start from Scratch)

在写第一行代码之前，你需要先理解 PYRo 的**仓库级工程结构**。以 `PYRo-Hero` 仓库为例，其顶层目录如下：

```md
PYRo-Hero/
├── .arm_builder.json          # VSCode 编译/烧录插件配置
├── .clang-format              # 代码风格格式化规则
├── .gitignore                 # Git 忽略规则
├── CMakeLists.txt             # 【顶层CMake】项目入口：工具链、子目录、链接
├── STM32H723XG_FLASH.ld       # 链接脚本（Flash/RAM 布局）
├── startup_stm32h723xx.s      # 启动汇编（中断向量表、堆栈初始化）
├── arm-gcc-toolchain.cmake    # ARM GCC 交叉编译工具链配置
├── CMake/                     # CMake 辅助脚本
│   └── config/
│       ├── pyro_robot_id_config.cmake  # 机器人ID选择与编译报告面板
│       └── pyro_format.cmake           # 终端彩色输出格式定义
├── CubeMX/                    # STM32CubeMX 生成的 HAL 层代码
│   ├── CubeMX.ioc             #   CubeMX 工程文件（引脚配置、时钟树等）
│   ├── CMakeLists.txt         #   将 HAL 代码封装为 stm32cubemx 库
│   ├── Core/                  #   HAL 初始化代码（main.c、中断处理等）
│   ├── Drivers/               #   CMSIS + HAL 驱动库
│   ├── Middlewares/           #   中间件（FreeRTOS 等）
│   └── cmake/                 #   工具链脚本与 stm32cubemx 子 CMake
├── PYRo/                      # PYRo-uCtrl-Unity 框架源码（作为子模块引入）
│   ├── CMakeLists.txt         #   框架自身的构建定义
│   ├── Core/                  #   核心库（FSM、Task、Lock、Memory）
│   ├── Component/             #   组件驱动（INS、Motor、RC、Referee…）
│   ├── Algorithm/             #   算法库（PID、LESO、CRC、PowerControl）
│   ├── Peripheral/            #   外设抽象（CAN、UART、DWT）
│   ├── Device/                #   设备驱动（BMI088 等）
│   ├── Module/                #   高级模块（Chassis 运动学等）
│   └── Debug/                 #   调试工具
├── third_party/               # 第三方库
│   └── CMSIS-DSP/             #   ARM CMSIS-DSP 数字信号处理库
└── Robot/                     # 【你的机器人代码】各兵种业务逻辑
    ├── Hero/                  #   英雄机器人
    ├── Sub_Hero/              #   副英雄（备车）
    ├── Infantry2/             #   步兵
    └── Sentry/                #   哨兵
```

### 每个文件/文件夹的作用

#### 1. 工程配置文件（根目录）

| 文件 | 作用 | 你需要改吗？ |
|------|------|-------------|
| `.arm_builder.json` | VSCode 插件 `arm-build` 的配置：指定目标芯片 (`stm32h723xx`)、烧录后端 (`PyOCD`)、CMake 参数 (`-DROBOT_ID=1`) | **需要**——改 `ROBOT_ID` 选你要编译的兵种(用 task 编译下载不用) |
| `.clang-format` | 统一代码风格（缩进、换行、空格等），配合 clang-format 工具自动格式化 | 团队统一即可，一般不改 |
| `.gitignore` | 告诉 Git 忽略编译产物 (`build/`)、IDE 配置 (`.vscode`)、中间文件 (`.o`, `.d`) | 按需添加 |

#### 2. 工具链与启动文件（根目录）

| 文件 | 作用 | 你需要改吗？ |
|------|------|-------------|
| `CMakeLists.txt` | **顶层构建入口**。做的事：①引入 ARM GCC 工具链 ②引入 CMSIS-DSP ③根据 `ROBOT_ID` 决定编译哪个兵种 ④链接所有库 | 添加新兵种时加一个 `elseif` 分支 |
| `arm-gcc-toolchain.cmake` | 定义交叉编译器路径（`arm-none-eabi-gcc/g++`）和 CMake 系统参数 | **不改**——除非工具链版本升级 |
| `STM32H723XG_FLASH.ld` | 链接脚本，定义芯片的 Flash/RAM 起始地址和大小 | **不改**——换芯片型号时才改 |
| `startup_stm32h723xx.s` | 启动汇编文件：中断向量表、堆栈初始化、调用 `main()` | **不改**——CubeMX 生成 |

#### 3. `CMake/` — 构建辅助

| 文件 | 作用 | 你需要改吗？ |
|------|------|-------------|
| `pyro_robot_id_config.cmake` | ①定义 `ROBOT_ID` → 兵种名的映射表 ②将 `ROBOT_ID`/`DEBUG_MODE`/`DEMO_MODE` 等宏传给编译器 ③生成彩色编译报告面板 | 添加新兵种时注册 ID 和名字 |
| `pyro_format.cmake` | 终端彩色输出的 ANSI 转义码封装 | 不改 |

**兵种 ID 对照表**（当前定义在 `pyro_robot_id_config.cmake` 中）：

| ID | 兵种 | 宏名 |
|----|------|------|
| 0 | 测试 | `TEST_ROBOT` |
| 1 | 英雄 | `HERO` |
| 2 | 工程 | `ENGINEER` |
| 3/4 | 步兵 | `INFANTRY1` / `INFANTRY2` |
| 5 | 哨兵 | `SENTRY` |
| 6 | 无人机 | `UAV` |
| 7 | 飞镖 | `DARTS` |
| 8 | 雷达 | `RADAR` |
| 10/20/30/50 | 副车 | `SUB_HERO` 等 |

使用时通过 CMake 命令行传入：`cmake -DROBOT_ID=1 ..`

或写入 `.arm_builder.json` 的 `cmake_options` 字段：`"-DROBOT_ID=1"`

#### 4. `CubeMX/` — HAL 层代码

这是 STM32CubeMX 工具生成的代码，负责**芯片级硬件抽象**：

| 内容 | 说明 |
|------|------|
| `CubeMX.ioc` | CubeMX 工程文件，双击可打开配置界面，修改引脚分配、时钟树、FreeRTOS 配置等 |
| `Core/` | `main.c`、中断服务函数、`FreeRTOSConfig.h` 等 |
| `Drivers/` | CMSIS 核心 + STM32H7 HAL 库驱动 |
| `Middlewares/` | FreeRTOS 内核源码 |
| `cmake/` | 将 `Drivers/` + `Core/` + `Middlewares/` 打包成 CMake 库 `stm32cubemx`，供顶层链接 |

> **常用操作**：在 CubeMX 中改完引脚后，重新生成代码，**只覆盖 `CubeMX/` 目录**，不影响 `Robot/` 和 `PYRo/` 中的业务代码。

#### 5. `PYRo/` — 框架核心库

这是 `PYRo-uCtrl-Unity` 仓库的本地副本。**强烈建议使用 Git 子模块 (`submodule`) 引入**，这样能跟踪框架的版本更新：

```bash
git submodule add https://github.com/PeiYangRobot/PYRo-uCtrl-Unity.git PYRo
```

更新子模块到最新版本：
```bash
cd PYRo && git pull origin main
```

`PYRo/` 只提供通用的、与具体机器人无关的驱动和算法。它的目录结构与你在这个文档站看到的完全对应：

| 目录 | 对应文档 | 包含内容 |
|------|----------|----------|
| `Core/` | [Core](Core/intro.md) | FSM、Task、Lock、Memory |
| `Component/` | [Component](Component/intro.md) | INS、Motor (DJI/DM)、RC (DR16/VT03)、Referee、Supercap |
| `Algorithm/` | [Algorithm](Algorithm/intro.md) | PID、LESO、CRC、功率控制 |
| `Peripheral/` | [Peripheral](Peripheral/intro.md) | CAN、UART、DWT |
| `Device/` | [Device](Device/intro.md) | BMI088 |
| `Debug/` | [Debug](Debug/intro.md) | 调试工具 |

#### 6. `third_party/` — 第三方库

| 目录 | 说明 |
|------|------|
| `CMSIS-DSP/` | ARM 官方 DSP 库，提供矩阵运算、FFT、滤波器等高效数学函数。在 `pyro_hybrid_chassis.cpp` 中大量使用 `arm_cos_f32`/`arm_sin_f32` |

#### 7. `Robot/` — 你的机器人代码

这是你真正写代码的地方。每个兵种一个子目录，里面按 Part 1 介绍的模块模式组织。

**顶层 CMakeLists.txt 如何找到你的代码**：

```cmake
# 根 CMakeLists.txt（简化）
if (ROBOT_ID EQUAL HERO_ID)
    add_subdirectory(robot/hero)
    target_link_libraries(${CMAKE_PROJECT_NAME} Hero)
elseif (ROBOT_ID EQUAL SENTRY_ID)
    add_subdirectory(robot/sentry)
    target_link_libraries(${CMAKE_PROJECT_NAME} Sentry)
endif()
```

### 搭建新工程的步骤

如果你想从零搭建一个新兵种（比如一架哨兵 `Sentry`），流程是：

1. **克隆模板仓库**：`git clone PYRo-Hero`（然后链接子仓库，具体操作请看[Git 子模块的管理](../Course/others/git_submodules.md)）
2. **在 `Robot/` 下新建兵种目录**：`Robot/Sentry/`
3. **在 `pyro_robot_id_config.cmake` 中注册 ID**：已经预定义了 `SENTRY_ID=5`，直接可用
4. **在根 `CMakeLists.txt` 中加分支**：添加 `elseif (ROBOT_ID EQUAL SENTRY_ID) ...`
5. **在 `.arm_builder.json` 中改 `ROBOT_ID`**：`"-DROBOT_ID=5"`
6. **按 Part 1~Part 8 的模式组织 `Robot/Sentry/` 下的代码**

---

## Part 1: 工程结构总览 (Project Structure)

### 1. 目录规划

现在聚焦到 `Robot/Hero/` 这一层——一个兵种的内部代码组织：

```
Robot/Hero/
├── CMakeLists.txt             # 构建配置：选择单片机、管理源文件与依赖
├── config.h                   # 顶层配置文件
├── pyro_init_thread.cpp       # 硬件初始化线程
├── pyro_mission_planer.cpp    # 任务编排（创建各模块线程）
├── Chassis/                   # 底盘模块
│   ├── hybrid_config.h        #   底盘专属配置（机械尺寸、PID参数等）
│   ├── pyro_hybrid_chassis.h  #   底盘模块头文件（命令/依赖/状态机定义）
│   ├── pyro_hybrid_chassis.cpp#   底盘模块实现（反馈更新/控制解算/状态机）
│   └── fsm/                   #   底盘状态机子状态实现
│       ├── pyro_hybrid_active_state.cpp
│       ├── pyro_hybrid_passive_state.cpp
│       └── ...
├── Gimbal/                    # 云台模块（同上结构）
│   ├── screw_config.h
│   ├── pyro_screw_gimbal.h
│   ├── pyro_screw_gimbal.cpp
│   └── fsm/
├── Booster/                   # 发射机构模块（同上结构）
│   ├── quad_config.h
│   ├── pyro_quad_booster.h
│   ├── pyro_quad_booster.cpp
│   └── fsm/
├── Communication/             # 板间通信模块
│   ├── General/               #   通用通信驱动
│   ├── Gimbal_board/          #   云台板通信逻辑
│   └── Chassis_board/         #   底盘板通信逻辑
└── Application/               # 应用层（遥控器解析、指令下发）
    ├── Gimbal_board/          #   云台板应用
    └── Chassis_board/         #   底盘板应用
```

**关键设计原则**：
- 每个硬件模块（Chassis / Gimbal / Booster）是自包含的，拥有自己的 `config.h`、驱动类、状态机。
- 不同单片机（Gimbal Board / Chassis Board）通过 `CMakeLists.txt` 中的 `BOARD` 宏切换编译。
- 模块之间不直接耦合，通过**命令结构体**（`xxx_cmd_t`）和**板间通信**（`board_drv_t`）交换数据。

### 2. 单单片机 vs 多单片机

Hero 使用了两块 STM32 单片机：
- **云台板 (Gimbal Board)**：运行云台 (`screw_gimbal_t`)、发射机构 (`quad_booster_t`)、自瞄通信
- **底盘板 (Chassis Board)**：运行底盘 (`hybrid_chassis_t`)、UI 绘制、裁判系统通信

如果你的机器人只用一块单片机，则不需要 `BOARD` 宏切换，CMakeLists 直接包含所有模块即可。

---

## Part 2: 构建配置 (CMakeLists.txt)

### 1. 定义单片机宏

在 `CMakeLists.txt` 顶部通过 `BOARD` 变量控制编译哪块单片机：

```cmake
set(BOARD "GIMBAL_BOARD")
#set(BOARD "CHASSIS_BOARD")

target_compile_definitions(Hero PRIVATE
    BOARD=${BOARD}
    GIMBAL_BOARD=1
    CHASSIS_BOARD=2
)
```

代码中通过 `#if BOARD == GIMBAL_BOARD` 进行条件编译。

### 2. 按单片机管理源文件

```cmake
if (BOARD STREQUAL "GIMBAL_BOARD")
    target_sources(Hero PRIVATE
        # === Application ===
        Application/Gimbal_board/pyro_booster_app.cpp
        Application/Gimbal_board/pyro_gimbal_app.cpp
        # === Gimbal 模块 ===
        Gimbal/pyro_screw_gimbal.cpp
        Gimbal/fsm/pyro_screw_active_state.cpp
        # ... 其他 fsm 状态文件
        # === Booster 模块 ===
        Booster/pyro_quad_booster.cpp
        Booster/fsm/pyro_quad_active_state.cpp
        # ... 其他 fsm 状态文件
        # === Communication ===
        Communication/Gimbal_board/pyro_autoaim_drv.cpp
        Communication/Gimbal_board/pyro_autoaim_com.cpp
        Communication/Gimbal_board/pyro_board_com.cpp
        Communication/General/pyro_board_drv.cpp
        # === 入口 ===
        pyro_mission_planer.cpp
        pyro_init_thread.cpp
    )
elseif (BOARD STREQUAL "CHASSIS_BOARD")
    target_sources(Hero PRIVATE
        Application/Chassis_board/pyro_chassis_app.cpp
        Chassis/pyro_hybrid_chassis.cpp
        Chassis/fsm/pyro_hybrid_active_state.cpp
        # ... 其他 fsm 状态文件
        Communication/Chassis_board/pyro_board_com.cpp
        Communication/Chassis_board/pyro_ui_com.cpp
        Communication/General/pyro_board_drv.cpp
        pyro_mission_planer.cpp
        pyro_init_thread.cpp
    )
endif ()
```

### 3. 定义外设宏

PYRo 通过预编译宏将 UART 外设映射到具名功能：

```cmake
# 云台板的 UART 映射
target_compile_definitions(PYRo PUBLIC
    DR16_UART=PYRO_UART5       # DR16 遥控器
    VT03_UART=PYRO_UART1       # VT03 图传遥控器
    AUTOAIM_UART=PYRO_UART7    # 自瞄通信
)

# 底盘板的 UART 映射
target_compile_definitions(PYRo PUBLIC
    REFEREE_UART=PYRO_UART1    # 裁判系统
    SR05_UART=PYRO_UART5       # 测距
    SR04_UART=PYRO_UART10      # 测距
    SUPERCAP_UART=PYRO_UART7   # 超级电容
)
```

### 4. 链接 PYRo 库

```cmake
target_link_libraries(Hero PUBLIC
    stm32cubemx
    dsppp_lib
    PYRo    # 框架核心库
)
```

---

## Part 3: 硬件初始化 (pyro_init_thread)

`pyro_init_thread` 是整个系统的**硬件初始化入口**，在 FreeRTOS 调度器启动后最先执行。它负责：

```cpp
#include "pyro_bsp_uart.h"
#include "pyro_bsp_can.h"
#include "pyro_dr16_rc_drv.h"
#include "pyro_dwt_drv.h"
#include "pyro_ins.h"
#include "pyro_referee.h"
// ... 按需引入其他驱动

void pyro_init_thread(void *argument)
{
    // 1. 初始化 DWT (延时/计时)
    dwt_drv_t::init(480); // 480 MHz

    // 2. 初始化所有 CAN 总线
    bsp_can::init_all();
    can1_drv = &bsp_can::get_can1();
    can2_drv = &bsp_can::get_can2();
    can3_drv = &bsp_can::get_can3();

    // 3. 初始化 IMU (BMI088)
    ins_drv = ins_drv_t::get_instance();
    ins_config_t ins_cfg;
    ins_cfg.direct = ins_config_t::imu_direct_t::DIRECT_4;
    ins_cfg.gx_offset = 0.00315992557f;  // 陀螺仪零偏
    ins_cfg.gy_offset = -0.00562873948f;
    ins_cfg.gz_offset = 0.000649456517f;
    ins_cfg.g_norm = 9.96699905f;
    ins_drv->init(ins_cfg);

    // 4. 根据单片机宏，条件初始化外设
#ifdef DR16_UART
    dr16_drv_t::instance().start();
    dr16_drv_t::instance().enable();
    DR16_UART.reset(100000, UART_WORDLENGTH_9B, UART_STOPBITS_2,
                    UART_PARITY_EVEN);
    DR16_UART.enable_rx_dma();
#endif

#ifdef REFEREE_UART
    REFEREE_UART.reset(115200, UART_WORDLENGTH_8B, UART_STOPBITS_1,
                       UART_PARITY_NONE);
    REFEREE_UART.enable_rx_dma();
    referee_drv_t::get_instance()->init();
#endif

#ifdef SUPERCAP_UART
    SUPERCAP_UART.reset(115200, ...);
    SUPERCAP_UART.enable_rx_dma();
    supercap_drv_t::get_instance()->start_rx();
#endif

    // ... 其他外设初始化 ...

    vTaskDelete(nullptr); // 初始化完成后自删除
}
```

**要点**：
- 只做**纯硬件初始化**，不创建业务线程（业务线程在 mission_planer 中创建）。
- 所有外设驱动使用 `#ifdef` 条件编译，确保只初始化当前单片机需要的外设。
- 执行完毕后 `vTaskDelete(nullptr)` 自毁，释放栈空间。

---

## Part 4: 模块创建模式 (Module Pattern)

这是 PYRo 框架最核心的上层抽象。每个硬件模块遵循统一的**三板斧**模式：**命令** → **依赖** → **上下文 → 状态机**。

以英雄底盘 (`hybrid_chassis_t`) 为例：

### 4.1 命令定义 (Command)

命令是从"外部"发给模块的指令，通常来自遥控器或板间通信：

```cpp
struct hybrid_cmd_t : cmd_base_t
{
    float vx;          // X 轴速度 (m/s)
    float vy;          // Y 轴速度 (m/s)
    float wz;          // 角速度 (rad/s)
    float delta_pitch; // 腿部增量位置
    float delta_yaw;
    bool crossing_en;  // 是否启用越障模式
    bool leg_retract;  // 是否收腿
    bool leg_calibration;
    bool pseudo_gyro_en;

    hybrid_cmd_t()
        : vx(0), vy(0), wz(0), delta_pitch(0), delta_yaw(0),
          crossing_en(false), leg_retract(false),
          leg_calibration(false), pseudo_gyro_en(false) {}
};
```

- 继承 `cmd_base_t`，获得 `mode` 字段（`ACTIVE` / `PASSIVE`）。
- 所有字段都有合理的默认值。

### 4.2 依赖定义 (Deps)

依赖是模块需要的**外部资源**——通常是电机对象和 PID 对象：

```cpp
struct hybrid_deps_t
{
    struct motor_deps_t {
        motor_base_t *mecanum[4]{nullptr};  // 麦轮电机 x4
        motor_base_t *track[2]{nullptr};    // 履带电机 x2
        motor_base_t *leg[2]{nullptr};      // 腿部电机 x2
        motor_base_t *yaw{nullptr};         // Yaw 轴电机
    };
    struct pid_deps_t {
        pid_t *mecanum_pid[4]{nullptr};
        pid_t *follow_yaw_pid{nullptr};
        pid_t *track_pid[2]{nullptr};
        pid_t *pitch_pid{nullptr};
        pid_t *roll_pid{nullptr};
        pid_t *leg_pos_pid[2]{nullptr};
        pid_t *leg_vel_pid[2]{nullptr};
    };
    motor_deps_t motor_deps{};
    pid_deps_t pid_deps{};
};
```

- 使用裸指针，由应用层负责 `new` 和生命周期管理。
- 初始化为 `nullptr`，使用前通过 `configure()` 注入。

### 4.3 上下文与模块类

```cpp
struct hybrid_module_params_t
{
    using CmdType    = hybrid_cmd_t;      // 命令类型
    using ModuleDeps = hybrid_deps_t;     // 依赖类型
    using ModuleCtx  = hybrid_context_t;  // 上下文类型
};

class hybrid_chassis_t final
    : public module_base_t<hybrid_chassis_t, hybrid_module_params_t>
{
    // 必须实现的三个基类接口：
    status_t _init() override;           // 资源初始化
    void _update_feedback() override;    // 传感器/电机反馈更新
    void _fsm_execute() override;        // 状态机调度入口

    // 业务逻辑方法
    void _kinematics_solve();            // 运动学解算
    void _mecanum_control();             // 麦轮控制
    void _track_control();               // 履带控制
    void _leg_vmc();                     // 腿部 VMC
    void _power_control();               // 功率控制
    void _send_motor_command() const;    // 发送电机指令

    // 状态机定义（内嵌类）
    struct state_passive_t : public state_t<owner> { ... };
    struct fsm_active_t : public fsm_t<owner> { ... };
};
```

**三个接口的生命周期**：

| 接口 | 调用时机 | 职责 |
|------|----------|------|
| `_init()` | 模块 `start()` 时调用一次 | 创建运动学对象、配置传感器、注册功率控制 |
| `_update_feedback()` | 每个控制周期调用 | 读电机反馈 (转速/位置/温度)、读 IMU 姿态、读测距数据 |
| `_fsm_execute()` | 每个控制周期调用，在 feedback 之后 | 根据 `cmd->mode` 切换 ACTIVE/PASSIVE 状态，驱动状态机执行 |

### 4.4 HFSM 状态机设计

以云台模块为例，其状态机层级为：

```
_main_fsm (顶层)
├── _fsm_passive (失能态)
│   ├── calibration_state  — 初始校准
│   └── idle_state         — 空闲
└── _fsm_active (激活态)
    ├── normal_state       — 手控模式
    ├── autoaim_state      — 自瞄模式
    └── sling_state        — 吊射模式
```

FSM 嵌套在模块类内部作为成员：

```cpp
class screw_gimbal_t final
    : public module_base_t<screw_gimbal_t, screw_gimbal_module_params_t>
{
    // === 状态定义 ===
    using owner = screw_gimbal_t;

    struct fsm_passive_t : public fsm_t<owner> {
        struct calibration_state_t : public state_t<owner> {
            void enter(owner *owner) override;
            void execute(owner *owner) override;
            void exit(owner *owner) override;
        };
        struct idle_state_t : public state_t<owner> { ... };
        // 内部子状态通过 on_enter/on_execute/on_exit 管理切换
    };

    struct fsm_active_t : public fsm_t<owner> {
        struct normal_state_t : public state_t<owner> { ... };
        struct autoaim_state_t : public state_t<owner> { ... };
        struct sling_state_t : public state_t<owner> { ... };
    };

    // 状态实例（成员变量）
    fsm_passive_t _fsm_passive;
    fsm_active_t  _fsm_active;
    fsm_t<owner>  _main_fsm;  // 顶层状态机
};
```

`_fsm_execute()` 中根据命令切换顶层状态：

```cpp
void screw_gimbal_t::_fsm_execute()
{
    _ctx.cmd = &_current_cmd;
    if (cmd_base_t::mode_t::ACTIVE == _ctx.cmd->mode)
        _main_fsm.change_state(&_fsm_active);
    else
        _main_fsm.change_state(&_fsm_passive);

    _main_fsm.execute(this);
}
```

### 4.5 配置常量 (config.h)

每个模块有自己的 `config.h`，存放该模块专属的机械参数和控制常量：

```cpp
// Chassis/hybrid_config.h — 底盘专属配置
constexpr float TRACK_SPACING   = 0.456f;   // 履带中心距 (m)
constexpr float WHEEL_RADIUS    = 0.076f;   // 轮子半径 (m)
constexpr float MASS            = 25.5f;    // 机器人质量 (kg)
constexpr float GRAVITY         = 9.96699905f;
constexpr float LEG_MAX_TORQUE  = 25.0f;    // 腿部最大扭矩 (N·m)

// 多项式拟合系数（由 SolidWorks 测算）
constexpr float JX_POLY_COEF[] = { -0.0742, 0.3986, ... };
constexpr float TAU_GRAVITY_COEF[] = { -1.4132, 4.2032, ... };
```

---

## Part 5: 应用层 (Application Layer)

应用层是连接**输入（遥控器/板间通信）**与**模块（Chassis/Gimbal/Booster）**的桥梁。每个模块对应一个应用文件。

### 5.1 应用层模板

以底盘应用 (`pyro_chassis_app.cpp`) 为例：

```cpp
#include "pyro_module_base.h"
#include "pyro_board_drv.h"
#include "pyro_hybrid_chassis.h"
// ... 其他依赖

using namespace pyro;

// === 全局模块指针 ===
static hybrid_chassis_t *hybrid_chassis_ptr = nullptr;
static hybrid_cmd_t     *hybrid_cmd_ptr     = nullptr;
static hybrid_deps_t    *hybrid_deps_ptr    = nullptr;
static board_drv_t      *board_drv_ptr      = nullptr;

// === 步骤 1: 初始化 ===
void hero_chassis_init(void *argument)
{
    // 1.1 获取通信驱动实例
    board_drv_ptr = &board_drv_t::get_instance(
        board_drv_t::role_t::CHASSIS, bsp_can::can1);

    // 1.2 创建命令与模块实例（单例模式）
    hybrid_cmd_ptr     = new hybrid_cmd_t();
    hybrid_chassis_ptr = hybrid_chassis_t::instance();

    // 1.3 配置依赖（创建电机和 PID 对象）
    deps_init();

    // 1.4 注入依赖并启动模块
    hybrid_chassis_ptr->configure(*hybrid_deps_ptr);
    hybrid_chassis_ptr->start();

    // 1.5 创建业务线程
    xTaskCreate(hero_chassis_thread, "hero_chassis_thread",
                128, nullptr, configMAX_PRIORITIES - 1, nullptr);
    vTaskDelete(nullptr);
}

// === 步骤 2: 依赖注入 ===
void deps_init()
{
    hybrid_deps_ptr = new hybrid_deps_t();

    // 创建电机驱动（CAN ID + CAN 总线）
    hybrid_deps_ptr->motor_deps.mecanum[0] =
        new dji_m3508_motor_drv_t(dji_motor_tx_frame_t::id_1, bsp_can::can3);
    // ... 其余电机 ...

    // 创建 PID 控制器
    hybrid_deps_ptr->pid_deps.mecanum_pid[0] =
        new pid_t(0.3f, 0.0008f, 0.0002f, 1.0f, 10.0f, 20, 1, 10, 1, 4);
    // ... 其余 PID ...
}

// === 步骤 3: 业务线程（控制循环） ===
void hero_chassis_thread(void *argument)
{
    while (true)
    {
        // 3.1 从板间通信读取遥控指令
        if (board_drv_ptr->check_online())
        {
            chassis_rxcmd();  // 解析指令填充 hybrid_cmd_ptr
        }
        else
        {
            hybrid_cmd_ptr->mode = cmd_base_t::mode_t::PASSIVE;
        }

        // 3.2 下发命令给模块
        hybrid_chassis_ptr->set_command(*hybrid_cmd_ptr);

        vTaskDelay(1);  // 1ms 控制周期
    }
}

// 遥控指令解析
void chassis_rxcmd()
{
    const auto &rx_data = board_drv_ptr->get_g2c_rx_data();
    hybrid_cmd_ptr->vx   = 4.0f * rx_data.vx / 127.0f;
    hybrid_cmd_ptr->vy   = 2.0f * rx_data.vy / 127.0f;
    hybrid_cmd_ptr->mode = rx_data.active ? cmd_base_t::mode_t::ACTIVE
                                          : cmd_base_t::mode_t::PASSIVE;
    hybrid_cmd_ptr->crossing_en = rx_data.track_en;
    // ... 其他字段映射 ...
}
```

### 5.2 云台应用中的事件驱动模式

云台应用使用**按钮事件订阅**机制处理遥控器输入：

```cpp
void hero_gimbal_init(void *argument)
{
    // ... 模块初始化 ...

    // 绑定键盘/遥控器按键到 FreeRTOS 任务通知
    auto &vrc = rc_drv_t::read();

    btn_broker::subscribe(&vrc.keys.r,
        btn_event_t::PRESS_DOWN,
        gimbal_task_handle,
        EVENT_BIT_SLING_TOGGLE);   // R 键 → 吊射模式切换

    btn_broker::subscribe(&vrc.keys.g,
        btn_event_t::PRESS_DOWN,
        gimbal_task_handle,
        EVENT_BIT_TRACK_TOGGLE);   // G 键 → 追踪模式切换
}

void hero_gimbal_thread(void *argument)
{
    while (true)
    {
        uint32_t notify_val = 0;
        xTaskNotifyWait(0x00, UINT32_MAX, &notify_val, 0);

        if (notify_val & EVENT_BIT_SLING_TOGGLE)
            is_sling_mode = !is_sling_mode;

        // 同步给状态机
        screw_gimbal_cmd_ptr->sling_mode = is_sling_mode;
        screw_gimbal_cmd_ptr->track_en   = is_track_mode;

        // 解析摇杆/鼠标输入 ...
        screw_gimbal_ptr->set_command(*screw_gimbal_cmd_ptr);
    }
}
```

---

## Part 6: 板间通信 (Inter-Board Communication)

Hero 使用 `board_drv_t` 在云台板和底盘板之间通过 CAN 总线交换数据：

```cpp
// 底盘板 — 发送侧（填充周期数据）
auto &tx_data = board_drv_ptr->get_c2g_tx_data();
float q[4] = {0.0f};
ins_drv_t::get_instance()->get_quaternion(&q[0], &q[1], &q[2], &q[3]);
for (int i = 0; i < 4; ++i)
    tx_data.chassis_q[i] = static_cast<int16_t>(q[i] * 32767.0f);

tx_data.gimbal_output = ref_data.robot_status.power_management_gimbal_output;
tx_data.heat_limit    = ref_data.robot_status.shooter_barrel_heat_limit;

board_drv_ptr->send_data(); // 周期发送

// 云台板 — 接收侧
const auto &rx_data = board_drv_ptr->get_g2c_rx_data();
hybrid_cmd_ptr->vx  = 4.0f * rx_data.vx / 127.0f;
hybrid_cmd_ptr->track_en = rx_data.track_en;
```

**板间通信数据流向**：

```
云台板 (Gimbal Board)                    底盘板 (Chassis Board)
┌──────────────────────┐    CAN Bus     ┌──────────────────────┐
│  dr16 / vt03 遥控器   │               │  裁判系统 读取        │
│        ↓              │               │        ↓              │
│  gimbal_app /          │  G2C pack ──→│  chassis_app          │
│  booster_app           │←── C2G pack   │  ui_app              │
│  解析遥控器 → 云台控制  │               │  解算底盘 → 电机驱动  │
│  拨弹/发射控制         │               │  UI 绘制             │
└──────────────────────┘               └──────────────────────┘
```

---

## Part 7: 任务编排 (Mission Planer)

`pyro_mission_planer.cpp` 负责在系统启动后创建所有 FreeRTOS 任务：

```cpp
void start_mission_planer_task(void const *argument)
{
    // 1. 首先创建硬件初始化线程（最高优先级）
    xTaskCreate(pyro_init_thread, "pyro_init_thread", 512, nullptr,
                configMAX_PRIORITIES - 1, nullptr);

#if BOARD == GIMBAL_BOARD
    // 2. 创建云台板各模块线程
    xTaskCreate(hero_gimbal_init, "pyro_gimbal_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
    vTaskDelay(10);
    xTaskCreate(hero_booster_init, "pyro_booster_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
    vTaskDelay(10);
    xTaskCreate(hero_autoaim_init, "pyro_autoaim_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
#elif BOARD == CHASSIS_BOARD
    // 2. 创建底盘板各模块线程
    xTaskCreate(hero_chassis_init, "pyro_chassis_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
    xTaskCreate(hero_ui_init, "pyro_ui_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);
#endif

    // 3. 创建板间通信线程（两块单片机都需要）
    xTaskCreate(hero_board_com_init, "pyro_board_com_init", 512, nullptr,
                configMAX_PRIORITIES - 2, nullptr);

#if DEBUG_MODE
    // 4. 调试线程（条件编译）
    xTaskCreate(start_debug_task, "start_debug_task", 512, nullptr,
                configMAX_PRIORITIES - 3, nullptr);
#endif

    vTaskDelete(nullptr);
}
```

**优先级分配原则**：
- `configMAX_PRIORITIES - 1`：硬件初始化（一次性任务，执行完自删除）
- `configMAX_PRIORITIES - 2`：各模块 init 线程和业务线程
- `configMAX_PRIORITIES - 3`：通信 / 调试线程

---

## Part 8: 快速上手清单 (Quick Start Checklist)

如果你要为新机器人搭建 PYRo 工程，按以下顺序操作：

### Step 1: 创建工程骨架

```md
Robot/YourRobot/
├── CMakeLists.txt
├── config.h
├── pyro_init_thread.cpp
├── pyro_mission_planer.cpp
└── Application/
```

### Step 2: 编写 CMakeLists.txt

- 定义 `BOARD` 宏（单单片机可跳过条件编译）
- 列出所有源文件
- 定义外设 UART 宏 (`DR16_UART=PYRO_UARTx` 等)
- 链接 `PYRo` 库

### Step 3: 编写 `pyro_init_thread.cpp`

- 初始化 DWT
- 初始化 CAN
- 初始化 IMU (INS)
- 用 `#ifdef` 条件初始化需要的 UART 外设

### Step 4: 为每个硬件模块创建目录和文件

```
ModuleName/
├── xxx_config.h          # 机械参数、阈值常量
├── pyro_xxx_module.h     # 命令/依赖/上下文/模块类+状态机声明
├── pyro_xxx_module.cpp   # 模块实现
└── fsm/
    ├── pyro_xxx_active_state.cpp
    ├── pyro_xxx_passive_state.cpp
    └── ...
```

### Step 5: 为每个模块实现三板斧

1. **定义 `xxx_cmd_t`**：继承 `cmd_base_t`，列出所有外部控制量
2. **定义 `xxx_deps_t`**：列出所有电机和 PID 指针
3. **实现 `xxx_module_t`**：
   - `_init()` — 创建运动学/传感器对象
   - `_update_feedback()` — 读取所有反馈数据
   - `_fsm_execute()` — 根据 mode 切换状态机

### Step 6: 编写应用层

- `_init()` 中：`new` 命令 + `instance()` 模块 + `new` 电机/PID + `configure()` + `start()`
- `_thread()` 中：读取输入 → 填充命令 → `set_command()`

### Step 7: 编写 `pyro_mission_planer.cpp`

- 先创建 `pyro_init_thread`
- 再创建各模块 init 线程
- 最后创建通信/调试线程

### Step 8: 编译、烧录、调试

---

## Part 9: 关键设计原则总结

| 原则 | 说明 |
|------|------|
| **模块自治** | 每个模块拥有自己的 config、cmd、deps、ctx、fsm，不直接依赖其他模块 |
| **命令驱动** | 外部只通过 `set_command()` 写入指令，模块内部自行决定如何响应 |
| **依赖注入** | 电机和 PID 对象由应用层创建，通过 `configure()` 注入模块，便于测试和替换 |
| **状态机分离** | 每个状态单独成文件（`fsm/xxx_state.cpp`），逻辑清晰、便于维护 |
| **条件编译** | 通过 `BOARD` 宏和 `#ifdef FEATURE_UART` 实现单工程多单片机 |
| **两级 init** | `pyro_init_thread` 做纯硬件初始化，各模块的 `hero_xxx_init` 做业务初始化 |

---

<script setup>
import { VPTeamMembers } from 'vitepress/theme'
import { mem4 } from '../public/member_list/members'

const author = [
  mem4,
]
</script>

## 作者

<VPTeamMembers size="small" :members="author" />
