Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_mutex.h"/><Badge type = "info" text="pyro_mutex.cpp"/><Badge type = "info" text="pyro_rw_lock.h"/><Badge type = "info" text="pyro_rw_lock.cpp"/>

# PYRo Locks

**基于 FreeRTOS 的 C++ 锁机制**

该模块 (`pyro_mutex` & `pyro_rw_lock`) 通过 C++ 的对象生命周期管理机制（RAII），解决 FreeRTOS 原生 API 在复杂业务逻辑中容易出现的“忘记解锁”等问题，同时将底层的操作系统调用与上层业务逻辑解耦。

> 语法前置知识：熟悉 C++ 类的构造与析构机制，了解 RAII 资源管理思想。

## Part 1: 代码全解 (Code Deep Dive)

### 1. 互斥锁 (Mutex)

`pyro::mutex_t` 是对 FreeRTOS 互斥信号量的封装。

#### 1.1 资源自动管理 (RAII)

在原生 C 语言开发中，`xSemaphoreTake` 和 `xSemaphoreGive` 必须严格配对。一旦在临界区发生 `return` 或 `break` 导致没有执行 Give，系统就会死锁。

本驱动引入了 `scoped_mutex_t`（作用域锁）：

- **构造即上锁**：对象创建时立即尝试获取锁（支持超时设置）。
- **析构即解锁**：当对象离开作用域（大括号 `{}` 结束）时，析构函数自动释放锁。

#### 1.2 安全性设计

`mutex_t` 对象掌管着底层的 `SemaphoreHandle_t`。为了防止多个 C++ 对象指向同一个底层句柄导致多次删除或状态混乱，代码中禁用了**拷贝构造**和**赋值操作**。

> **注意**：必须确保 `mutex_t` 对象的生命周期长于任何使用它的线程，通常建议作为全局变量或类的成员变量。

------

### 2. 读写锁 (Read-Write Lock)

`pyro::rw_lock` 是为了解决“多读单写”场景效率问题而设计的。它允许成百上千个线程同时读取数据，但写线程必须独占访问。

#### 2.1 写优先策略 (Write-Preferred Strategy)

为了防止数据更新不及时（即“写饥饿”：读者源源不断导致写者永远插不进队），本驱动采用了**写优先**策略：

1. **写者介入**：当一个写线程请求锁时，它会立即拿走“读者大门（Read Gate）”钥匙。此时，正在读取的线程可以继续读完离开，但**新的读线程**会被挡在门外阻塞。
2. **独占执行**：待所有旧读者离开后，写者独占资源进行更新。

#### 2.2 双闸门机制内部逻辑

代码内部使用了三个信号量来精细控制流量：

- `_internal_mutex`：保护内部计数器（读者数量、等待的写者数量）。
- `_read_gate`：读者的入场券。写者会抢占它来阻断新读者。
- `_write_gate`：真正的数据保护锁。

#### 2.3 超时回滚机制 (Timeout Rollback)

在带超时的操作中（例如只愿意等 10ms），如果获取锁的过程执行了一半超时了，驱动会自动执行**回滚**操作。

例如在 `write_lock(timeout)` 中，如果成功拿到了“读者大门”但在等待旧读者离开时超时了，代码会自动归还“读者大门”并恢复计数器，确保锁的状态不会因为超时而损坏。

```c++
// pyro_rw_lock.cpp 回滚示例
if (xSemaphoreTake(_write_gate, remaining_time) == pdFALSE)
{
    // 超时了，必须把之前的操作撤销，否则系统就卡死了
    _writer_waiting_count--; 
    if (first_writer && _writer_waiting_count == 0) {
        xSemaphoreGive(_read_gate); // 归还大门
    }
    return false;
}
```

## Part 2: 快速上手 (Quick Start)

### 1. 互斥锁的使用

适用于模块命令分发等任何时刻只被一个地方占用的数据。

#### 1.1 基础用法 (推荐)

利用作用域（大括号）来控制锁的范围，无需手动解锁。

```c++
#include "pyro_mutex.h"

pyro::mutex_t log_mutex; // 全局锁实例

void logger_task() {
    // ... 业务代码 ...
    
    {
        // [进入临界区] 创建局部变量，立即上锁
        pyro::scoped_mutex_t lock(log_mutex);
        
        // 在这里安全地操作共享资源
        // ...
        
    } // [离开临界区] lock 对象析构，自动解锁
    
    // ... 其他代码 ...
}
```

#### 1.2 带超时的尝试

如果你不想死等（例如尝试发送数据，如果忙就丢弃）。

```c++
void try_send_data() {
    // 尝试获取锁，最多等 10 个 Tick
    pyro::scoped_mutex_t lock(log_mutex, 10);

    // 必须检查是否成功锁上
    if (lock.is_locked()) {
        send_data();
    } else {
        // 超时了，放弃操作
        // ...
    }
}
```

### 2. 读写锁的使用

适用于**遥控器数据读取**等多读者的数据，也适用于多读多写的数据。

#### 2.1 读者线程 (并发)

多个线程可以同时运行这段代码，互不干扰。

```c++
#include "pyro_rw_lock.h"

void reader_task() {
    while(1) {
        {
            // 申请“读锁”，允许和其他读者共存
            // g_cfg是对应资源的读写锁实例
            pyro::read_scope_lock lock(data_lock);
            
            // 安全读取
            data.read();
        }
        vTaskDelay(1);
    }
}
```

#### 2.2 写者线程 (独占)

写者拥有高优先级，一旦开始请求，新读者会被阻塞。

```c++
#include "pyro_rw_lock.h"

void writer_task() {
    // 接收到新数据

    {
        // 申请“写锁”，独占访问
        pyro::write_scope_lock lock(data_lock);
        
        // 修改数据
        data.write();
        
    } // 自动释放，唤醒所有等待的读者
}
```

## Q&A