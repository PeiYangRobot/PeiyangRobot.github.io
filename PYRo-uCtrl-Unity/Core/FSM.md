Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_core_fsm.h"/><Badge type = "info" text="pyro_core_fsm.cpp"/>

# PYRo FSM

**基于 C++ 模板的高效、轻量级有限状态机 (FSM) 核心库**

该模块 (`pyro_core_fsm`) 提供了一个通用的、与其他软硬件无关的状态机框架。它利用 C++ 模板实现了**状态逻辑与系统数据的完全解耦**，支持层级状态机（HFSM），并通过内部逻辑链管理（Enter/Execute/Exit）确保系统行为的确定性。

> 语法前置知识：需要对 C++ 模板的使用有基础了解，尤其是模板类的定义和继承关系。

> 理解前置知识：有限状态机（FSM）的基本概念，状态切换的生命周期（Enter/Execute/Exit）。


## Part 1: 代码全解 (Code Deep Dive)

### 1. 核心架构设计

#### 1.1 泛型与上下文 (Templates & Context)

为了使状态机能够运行在任何硬件或软件环境中，本库采用了模板设计。核心类 `state_t` 和 `fsm_t` 都依赖于模板参数 `Context` 。

- **Context (上下文)**：这是一个由用户定义的结构体或类，包含了状态机运行所需的所有共享数据（如硬件句柄、全局标志位、传感器数据等）。
- **设计优势**：状态机内部不持有任何具体的数据载体，而是通过指针操作 `Context`，实现了逻辑（State）与数据（Context）的分离。

### 2. 状态基类详解 (The State Interface)

`state_t` 是所有状态的抽象基类，它不仅定义了生命周期，还实现了状态切换的底层握手逻辑。

#### 2.1 内部切换机制：请求与获取

状态的切换不是立即发生的，而是采用 **“请求-确认”** 的缓冲机制。这避免了在 `execute` 逻辑执行中途突然跳转导致的逻辑断层（例如：在函数的一半处切换了状态，导致后半段代码在错误的状态下运行）。

**请求切换 (`request_switch`)**： 当子类调用此函数时，仅将目标状态指针保存在 `_requested_state` 变量中 。

```c++
template <typename Context>
void state_t<Context>::request_switch(state_t<Context> *next)
{
    // 仅记录意图，不立即执行跳转
    _requested_state = next;
}
```

**拉取请求 (`fetch_request`)**： 父级控制器（FSM）在适当的时候调用此函数拉取请求。读取后会立即将 `_requested_state` 置空，确保请求只被处理一次 。

```c++
template <typename Context>
state_t<Context> *state_t<Context>::fetch_request()
{
    state_t<Context> *next = _requested_state;
    _requested_state       = nullptr; // 消费请求，防止重复跳转
    return next;
}
```

#### 2.2 逻辑部分实现

对于任一个状态而言，用户需要重写其三个行为，分别为`enter`、`execute`、`exit`。从语法角度而言，无状态机的状态可以独立存在，但并不推荐，无状态机意味着用户需要自行管理状态的切换以及行为调用逻辑，下文仅针对有状态机管理的状态逻辑

一个周期只能执行**任务切换**或**运行循环**其中之一，当进行任务切换时，会先执行当前状态的`exit`方法，此时切换状态，再执行当前状态（此时已切换）的`enter`方法，当进行运行循环时，会执行当前状态的`execute`方法

### 3. FSM 控制器实现 (FSM Controller Internals)

`fsm_t` 继承自 `state_t` ，这意味着 FSM 本身也可以作为另一个 FSM 的子状态（即层级状态机 HFSM），可以拥有`state_t`的所有行为， 即状态机的职责可以分为两部分，一部分进行子状态的管理，负责状态切换，另一方面它作为状态，实现自身逻辑，同时还可以被更高层的状态机进行管理。

#### 3.1 状态机自身状态实现

对于`fsm_t`，其`enter`、`execute`、`exit`方法不仅要负责其自身的逻辑，还需要负责其子状态的逻辑，可以理解为对于***状态机A下的状态B,C,D***，B,C,D也是状态A的一种，也就是说，如果系统不处于A状态，其一定不处于B,C,D任一状态，同理如果系统不处于B,C,D（或空）中的任一一种，其也不处于A状态，或可理解为，只有进入A状态后，状态机A才会开始管理其下子状态。

> tip：语法上允许状态机下的初始活跃状态为空

由此可知，状态机 的`enter`、`execute`、`exit`不仅包括其自身作为状态的属性，还包含了作为状态机的属性，但对于用户而言，只需要通过重写`on_enter`、`on_execute`、`on_exit`实现其状态属性即可，其作为状态机的属性已经在内部封装，这里给出状态机的`enter`与`exit`实现，`execute`将在下文中具体说明。

> 注：下文对`on_enter`,`on_execute`,`on_exit`会称其为父状态`enter`、`execute`、`exit`，当表明是状态机`enter`、`execute`、`exit`才代表`fsm_t`的`enter`、`execute`、`exit`方法

```c++
template <typename Context>  
void fsm_t<Context>::enter(Context *ctx)  
{  
    on_enter(ctx);  
    if (_active_state)  
    {  
        _active_state->enter(ctx);  
    }  
}
```

对于`enter`方法，会先执行父状态的`enter`，若外部直接进入的是子状态，此时`_active_state`非空，会继续执行子状态`enter`

```c++
template <typename Context>  
void fsm_t<Context>::exit(Context *ctx)  
{  
    if (_active_state)  
    {  
        _active_state->exit(ctx);  
        _active_state->discard_request();  
    }  
    on_exit(ctx);  
}
```

对于`exit`方法，会先执行子状态的`exit`

逻辑链与`Cpp`语法中类与派生类的构造函数与析构函数类似，同时符合子状态也是父状态的逻辑链路。

#### 3.2 核心调度循环 (`execute`)

拥有固定的逻辑链路，即`处理状态切换->执行父状态机逻辑(触发状态转换则跳转)->执行子状态逻辑->拉取切换请求`

```c++
template <typename Context>
void fsm_t<Context>::execute(Context *ctx)
{
    // Phase A: 优先处理状态转换
    // 如果存在挂起的跳转请求，先完成 Exit/Enter 流程，再执行业务逻辑
    if (process_switch(ctx))
        return; 

    // Phase B: 执行逻辑
    // 1. 执行 FSM 自身的逻辑（如全局监控、看门狗）
    on_execute(ctx);
    
    // 如果 FSM 自身逻辑触发了跳转，立即返回，不再执行子状态逻辑
    if (_target_state)
        return;

    if (!_active_state)
        return;

    // 2. 执行当前活动子状态的业务逻辑
    _active_state->execute(ctx);

    // Phase C: 同步 (Request Bubbling)
    // 检查子状态是否发出了切换请求。
    // 如果子状态想切换，将其请求“冒泡”给 FSM，FSM 将在下一次 execute 的 Phase A 处理它。
    if (auto req = _active_state->fetch_request())
    {
        _target_state = req;
    }
}
```

#### 3.3 状态切换操作 (`process_switch`)

此函数确保了 `exit`（旧状态）和 `enter`（新状态）的执行，在这个周期内只执行切换逻辑`exit`和`enter`而不执行循环逻辑 `execute`。

```c++
template <typename Context>
bool fsm_t<Context>::process_switch(Context *ctx)
{
    if (!_target_state)
        return false;

    // 1. 退出旧状态
    if (_active_state)
    {
        _active_state->exit(ctx);
        // 重要：退出时必须丢弃该状态未处理的请求，防止逻辑残留
        _active_state->discard_request();
    }
    
    // 更新指针
    _last_state = _active_state;
    _active_state = _target_state;

    // 2. 进入新状态
    if (_active_state)
    {
        _active_state->enter(ctx);
    }

    // 清空目标，完成切换
    _target_state = nullptr;
    return true;
}
```

## Part 2: 快速上手 (Quick Start)

### 1. 定义上下文 (Define Context)

这里我们定义一个命令上下文 `CmdContext`，它包含遥控器的开关数据以及电机等硬件资源。

```c++
struct CmdContext {
    bool rc_switch_enable; // 遥控器拨杆：true=激活，false=失能
    
    // 可以在此包含硬件句柄
    // Motor* motor;
};
```

### 2. 实现具体状态 (Implement States)

定义两个核心状态：`PassiveState`（失能/安全态）和 `ActiveState`（激活/工作态）。

```c++
#include "pyro_core_fsm.h"
#include <iostream>

// 1. 失能状态：安全停机
class PassiveState : public pyro::state_t<CmdContext> {
    void enter(CmdContext *ctx) override {
        // 执行安全操作：电机断电、灭灯
        std::cout << ">>> Enter Passive: Motors OFF" << std::endl;
    }
    
    void execute(CmdContext *ctx) override {
        // 持续发送 0 力矩，确保系统安全
    }
    
    void exit(CmdContext *ctx) override {}
};

// 2. 激活状态：正常工作
class ActiveState : public pyro::state_t<CmdContext> {
    void enter(CmdContext *ctx) override {
        // 亮绿灯，系统准备就绪
        std::cout << ">>> Enter Active: System Ready" << std::endl;
    }
    
    void execute(CmdContext *ctx) override {
        // 执行具体的业务逻辑
        // run_control_loop(ctx);
    }
    
    void exit(CmdContext *ctx) override {}
};
```

### 3. 集成与运行 (Setup & Loop)

在主循环中，我们通过判断上下文中的遥控器数据 (`rc_switch_enable`)，来决定主状态机 (`fsm`) 应该处于 `Active` 还是 `Passive` 状态。

```c++
// 实例化上下文、FSM 和状态
CmdContext ctx;
pyro::fsm_t<CmdContext> fsm;
PassiveState passive_state;
ActiveState active_state;

void setup() {
    // 初始化数据：默认失能
    ctx.rc_switch_enable = false;
    
    // 设置 FSM 初始状态
    fsm.change_state(&passive_state);
    
    // 触发 FSM 的初始 enter
    fsm.enter(&ctx); 
}

void loop() {
    // 1. 更新上下文（模拟从遥控器接收数据）
    // ctx.rc_switch_enable = RC_GetSwitchState(); 
    
    // 2. 宏观逻辑控制：
    // 根据遥控器指令强制切换 FSM 的目标状态
    // 如果当前已经在目标状态，change_state 内部会自动忽略，不会重复触发 enter
    if (ctx.rc_switch_enable) {
        fsm.change_state(&active_state);
    } else {
        fsm.change_state(&passive_state);
    }

    // 3. 驱动状态机
    // execute 的 Phase A 会处理上面的 change_state 请求，实现无缝切换
    fsm.execute(&ctx);
    
    // 模拟系统延时
    Delay(10);
}
```

## Q&A