Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_task.h"/><Badge type = "info" text="pyro_task.cpp"/>
# PYRo Task

**基于 FreeRTOS 的 C++ 任务对象封装**

该模块 (`pyro_task`) 提供了一个面向对象的任务基类 `pyro::task_base_t`。它通过 C++ 的继承与多态机制，将 FreeRTOS 的 `xTaskCreate` 及其复杂的参数配置封装为更直观的 API，并引入了“双阶段初始化”机制以优化栈内存使用。

## Part 1: 代码全解 (Code Deep Dive)

### 1. 核心设计：双阶段执行 (Two-Stage Execution)

与原生 FreeRTOS 任务直接进入无限循环不同，`pyro_task` 将任务的生命周期显式划分为两个阶段：**初始化 (Init)** 和 **主循环 (Loop)**。

#### 1.1 瞬态初始化任务

调用 `start()` 时，并不会直接创建主任务，而是先创建一个临时的 `init_tmp` 任务。

- 该任务执行 `init()` 虚函数。
- **设计目的**：许多任务在启动时需要申请大量临时资源（如解析配置文件、申请大块 buffer），这些操作往往需要较大的栈空间，但在进入死循环后不再需要。
- 执行完 `init()` 后，该临时任务会自动删除，释放其占用的资源。

#### 1.2 持久化主循环任务

当 `init()` 执行完毕且准备就绪后，系统会创建真正的主任务来执行 `run_loop()`。

- **栈空间独立**：主任务可以使用比初始化阶段更小的栈空间，从而节省 RAM。

### 2. 栈空间优化 (Stack Optimization)

构造函数允许用户分别指定两个阶段的栈大小：

```c++
task_base_t(const char *name, 
            uint16_t init_stack, // 初始化阶段的栈大小 (临时)
            uint16_t loop_stack, // 主循环阶段的栈大小 (常驻)
            priority_t priority);
```

- **场景示例**：假设初始化需要 512 字栈来进行资源初始化等，但随后的循环只需要 128字。
  - 原生写法：必须分配 512字 常驻栈，有浪费。
  - **PYRo Task**：`init_stack` 设为 512，`loop_stack` 设为 128。初始化结束后 512 被回收，仅占用 128 常驻内存。

### 3. 优先级抽象 (Priority Abstraction)

为了跨平台和简化配置，模块定义了 `priority_t` 枚举（`IDLE` 到 `REALTIME` 共 7 级）。内部会自动根据 FreeRTOS 的 `configMAX_PRIORITIES` 将其映射到正确的数值范围，无需手动计算数字。

## Part 2: 快速上手 (Quick Start)

### 1. 定义任务

继承 `pyro::task_base_t` 并实现两个纯虚函数：`init()` 和 `run_loop()`。

```c++
#include "pyro_task.h"

class BlinkerTask : public pyro::task_base_t {
public:
    // 构造函数：设定名称、栈大小和优先级
    // Init栈: 512 (假设初始化需要较多资源)
    // Loop栈: 128 (主循环很简单)
    BlinkerTask() : 
        task_base_t("Blinker", 512, 128, priority_t::NORMAL) {}

protected:
    // [阶段 1] 初始化：只运行一次
    void init() override {
        // 初始化业务
        // ...
    }

    // [阶段 2] 主循环：通常是死循环
    void run_loop() override {
        while (1) {
            // 业务逻辑
            // ...
        }
    }
};
```

### 2. 启动任务

建议在主程序或对象管理类中实例化并启动。

```c++
// 实例化任务对象
BlinkerTask g_blinker;

void main() {
    // 启动任务
    // 1. 创建临时任务执行 init()
    // 2. init() 完成后创建主任务执行 run_loop()
    g_blinker.start();

    // ... 其他逻辑 ...
}
```

### 3. 停止任务

外部可以调用 `stop()` 强制删除任务。

```c++
// 强制停止
g_blinker.stop();
```

## Part 3: 注意事项 (Notes)

1. **run_loop 的实现**：`run_loop` 内部通常需要包含 `while(1)` 或类似的死循环。如果 `run_loop` 函数执行完毕，任务会自动删除自身。
2. **生命周期**：`task_base_t` 对象的生命周期必须覆盖任务的整个运行周期。如果 C++ 对象被析构，其析构函数会调用 `stop()` 强制结束 FreeRTOS 任务。
3. **栈溢出**：虽然分阶段栈设计较省内存，但需确保 `loop_stack` 足够支撑主循环。

## Q&A