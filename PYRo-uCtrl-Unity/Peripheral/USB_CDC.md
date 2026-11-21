Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_usb_cdc_drv.h"/><Badge type = "info" text="pyro_usb_cdc_drv.cpp"/><Badge type = "info" text="pyro_usb_descriptors.c"/><Badge type = "info" text="tusb_config.h"/><Badge type = "info" text="usb_cdc_config.h"/>

# PYRo USB CDC Driver

**基于 TinyUSB 与 FreeRTOS 的多路虚拟串口驱动**

该模块 (`pyro_usb_cdc_drv`) 把一颗 USB 外设虚拟成**多个互相独立的串口**。它在 TinyUSB 之上加了一层**带帧协议的路由器**：每个串口收到的字节流先被解成带 CRC 校验的帧，再按 `frame_id` 分发给注册了该 ID 的业务模块。上层拿到的永远是"一帧完整的、校验过的载荷"，不需要关心 USB 端点、粘包、半包或重同步。

> 语法前置知识：了解Lambda表达式、`std::function`、`std::vector`、`std::pair` 的基础概念，局部静态变量的初始化机制（Meyers Singleton），`__attribute__((packed))` 的作用。
> 嵌入式开发前置知识：熟悉 USB 2.0 的设备枚举流程（描述符、配置、接口、端点），了解 CDC-ACM 类的基本概念，熟悉 FreeRTOS 的任务与互斥量。

## Part 1: 代码全解 (Code Deep Dive)

### 1. 核心架构与内存策略

#### 1.1 单 USB 外设如何变成多个串口

STM32H723 只有 **一个** USB 外设：`USB1_OTG_HS`，且本项目用的是它的**内置全速 PHY**（固定 `PA11` = D-、`PA12` = D+、AF10）。

所以"多串口"不是"多个 USB 外设"，而是**一个复合设备（Composite Device）里的多个 CDC-ACM 功能**：

- 每个 CDC 功能占用 **2 个接口**（一个控制接口 + 一个数据接口）和 **3 个端点**（notify IN / data OUT / data IN）。
- 用 **IAD**（Interface Association Descriptor）把这两个接口绑成一个功能，主机才知道它们是一伙的。
- Windows 的 `usbser.sys` 会为**每个功能**自动建一个 COM 口，不需要写 `.inf`。

端点预算是硬约束：

| 项                            | 值                                       |
| ----------------------------- | ---------------------------------------- |
| `dwc2_stm32.h` 的 `EP_MAX_HS` | 9（**含 EP0**）                          |
| 可用端点号                    | 1 ~ 8，共 8 个                           |
| 每个 CDC 口占用               | 2 个（notify IN + data IN/OUT 共用编号） |
| **最大 CDC 口数**             | **4**                                    |

本项目默认开 **2 路**，端点分配如下：

|                 | 控制接口 | 数据接口 | notify IN | data OUT | data IN |
| --------------- | -------- | -------- | --------- | -------- | ------- |
| `serial_id = 0` | 0        | 1        | `0x81`    | `0x02`   | `0x82`  |
| `serial_id = 1` | 2        | 3        | `0x83`    | `0x04`   | `0x84`  |

> **注意**：`serial_id` 就是 CDC 接口序号，它同时是 `tud_cdc_n_*(serial_id, ...)` 的第一个参数。**接口号、端点号、`CFG_TUD_CDC`、`_serial[]` 数组长度，这四者必须严格对齐**，任何一处不一致都会导致某个口"静默失效"。

#### 1.2 三层分工

驱动本身不碰 USB 硬件，它站在 TinyUSB 之上：

| 层           | 文件                     | 职责                                     |
| ------------ | ------------------------ | ---------------------------------------- |
| **描述符层** | `pyro_usb_descriptors.c` | 告诉主机"我是谁、有几个功能、用哪些端点" |
| **协议栈层** | `third_party/TinyUSB`    | 枚举、端点收发、每接口 FIFO              |
| **驱动层**   | `pyro_usb_cdc_drv.cpp`   | 组帧/解帧、按 `frame_id` 路由、任务调度  |

描述符层是纯 C（TinyUSB 的回调是 C 符号），驱动层是 C++。两者通过文件末尾的 **C 桥接层**连接：

```c++
extern "C" {
void tud_cdc_rx_cb(uint8_t itf)  { pyro::usb_cdc_drv_t::instance().on_cdc_rx(itf); }
void tud_mount_cb(void)          { pyro::usb_cdc_drv_t::instance().on_mount(); }
void tud_umount_cb(void)         { pyro::usb_cdc_drv_t::instance().on_umount(); }
void pyro_usb_irq_handler(void)  { tusb_int_handler(BOARD_TUD_RHPORT, true); }
}
```

> **Tip**：中断向量 `OTG_HS_IRQHandler` 的定义保留在 CubeMX 生成的 `stm32h7xx_it.c` 里（USER CODE 区调用 `pyro_usb_irq_handler()`）。这样 CubeMX 重新生成代码不会造成符号丢失或重复。

#### 1.3 内存策略：静态缓冲 + 二级队列

驱动内部**没有动态缓冲区**。每个 `serial_t` 自带两块固定数组：

```c++
uint8_t  _rx_buf[usb_cdc::RX_BUF_CAPACITY];   // 512 B
uint16_t _rx_tail;
uint8_t  _tx_buf[usb_cdc::TX_BUF_CAPACITY];   // 512 B
uint16_t _tx_tail;
```

两路串口合计约 **2 KB**，加上 TinyUSB 每接口 `256 + 256` 的 FIFO（两路再 **1 KB**），整个 USB 子系统静态占用约 **3 KB RAM**。唯一 `new` 出来的是 USB 任务对象本身。

> **Warning**：`CFG_TUD_CDC_RX_BUFSIZE` / `TX_BUFSIZE` 是**每接口**的。把 `CFG_TUD_CDC` 从 1 改成 2，静态 RAM 会直接翻倍，改之前先确认链接脚本还有余量。

### 2. 帧协议与路由 (Frame Protocol & Routing)

#### 2.1 帧结构

USB CDC 是**字节流**，没有消息边界。驱动用一层自定义帧协议把流切成帧：

```
偏移   0      1          2        3        4        5 .. 5+LEN-1   末尾 2 字节
     +------+----------+--------+--------+------+--------------+----------+
     | SOF  | FRAME_ID | LEN_LO | LEN_HI | CRC8 |     DATA     |  CRC16   |
     +------+----------+--------+--------+------+--------------+----------+
      0xA5    消费者      └── uint16 小端 ──┘  帧头自校验   载荷     整帧校验
```

- **SOF** 固定 `0xA5`，用于在字节流里找帧头。
- **FRAME_ID** 是路由键，决定这一帧交给哪个业务模块。
- **LEN** 是载荷长度，上限 `MAX_DATA_LENGTH = 256`。
- **CRC8** 覆盖前 5 字节，让驱动能在**还不知道长度**的情况下先确认帧头可信。
- **CRC16** 覆盖除末尾 2 字节外的全部，确认整帧完整。
- 总长恒为 `LEN + 7`。

CRC 算法复用 `pyro_crc.h`（CRC8：init `0xFF`、反射多项式 `0x8C`；CRC16：init `0xFFFF`、反射多项式 `0x8408`，即 CRC-16/MCRF4XX）。

#### 2.2 帧头结构体与端序

帧头用 `packed` 结构体描述，而不是手工拼字节：

```c++
struct frame_header_t {
    uint8_t  sof;
    uint8_t  frame_id;
    uint16_t data_len;
    uint8_t  crc8;
} __attribute__((packed));
```

> **注意**：`data_len` 是 `uint16_t`，它在**线上**的字节序等于 MCU 在内存里的字节序。Cortex-M 系列**只支持小端**（`SCB->AIRCR.ENDIANNESS` 恒为 0），GCC 的 AAPCS 下 `packed` 结构体不插入任何填充，因此 `sizeof(frame_header_t) == 5`，可以直接 `memcpy` 到发送缓冲、也可以直接 `memcpy` 出来解析，无需任何字节序转换。这也正好符合 USB 2.0 规范 §7.1 对多字节字段一律小端的要求。

#### 2.3 路由表：键是 `(serial_id, frame_id)` 二元组

每个串口维护**自己**的一张路由表：

```c++
std::vector<std::pair<uint8_t, rx_event_handler>> _rx_handlers;  // <frame_id, handler>
```

这一点很关键：路由键不是全局的 `frame_id`，而是 **`serial_id` + `frame_id`**。所以 0 号口的 `0x01` 和 1 号口的 `0x01` 是两个完全独立的消费者，互不干扰。

分发时线性查找，命中即 `break`：

```c++
void usb_cdc_drv_t::serial_t::dispatch(uint8_t frame_id, const uint8_t *data, uint16_t len) {
    for (auto it = _rx_handlers.begin(); it != _rx_handlers.end(); ++it)
        if (it->first == frame_id) {
            it->second(frame_id, data, len);
            break;   // 一个 frame_id 只对应一个消费者
        }
}
```

回调签名：

```c++
using rx_event_handler = std::function<bool(uint8_t frame_id, const uint8_t *p, uint16_t size)>;
```

`std::function` 做类型擦除，因此**普通函数、静态成员函数、捕获了 `this` 的 Lambda** 都能直接注册。

> **Tip**：返回值目前只表示"已处理"，驱动不会因为返回 `false` 而把帧转给别人（`break` 是无条件的）。保留 `bool` 是为了将来支持多播。

#### 2.4 注册与移除机制

- **注册 (`register_rx`)**：如果该 `serial_id` 上已经有同 `frame_id` 的处理器，返回 `PYRO_PARAM_ERROR` 且**不覆盖**。
- **移除 (`remove_rx`)**：按 `frame_id` 擦除，找不到返回 `PYRO_NOT_FOUND`。

> **注意**：这里用 `frame_id` 直接做键，而不是像 UART 驱动那样额外维护一个 `owner` ID。原因是 UART 驱动的回调列表允许同一模块注册多个匿名回调，`std::function` 又不可比较，只能靠 `owner` 指针反查；而 USB 驱动的 `frame_id` 天然唯一且可比较，`owner` 机制就多余了。

### 3. 数据流与任务模型 (Data Flow & Task Model)

#### 3.1 `usb_task`：唯一允许碰 TinyUSB 的地方

TinyUSB 内部的 `tu_fifo` **没有加锁**。如果两个任务同时调 `tud_cdc_n_write()`，FIFO 的读写指针会直接错乱。因此驱动把所有 `tud_*` 数据面调用**全部收敛到一个任务**里：

```c++
void usb_cdc_drv_t::usb_task_t::run_loop() {
    const tusb_rhport_init_t dev_init = {
        .role  = TUSB_ROLE_DEVICE,
        .speed = TUSB_SPEED_FULL,     // 内置 FS PHY
    };
    tusb_init(BOARD_TUD_RHPORT, &dev_init);

    while (true) {
        tud_task_ext(1, false);       // 1 ms 超时，非 ISR 上下文
        _owner->_serial[0].drain_tx();
        _owner->_serial[1].drain_tx();
    }
}
```

任务参数：栈 `512` words（2 KB），优先级 `ABOVE_NORMAL`（= 4）。

> **Warning**：`tusb_init()` 必须在这里调用，不能放在 `init()` 里。因为 TinyUSB 的 OSAL 在中断里会用到 FreeRTOS 的队列 API，必须等调度器跑起来。`run_loop()` 天然满足这个条件。

#### 3.2 接收路径

```
OTG_HS_IRQHandler
  └─ pyro_usb_irq_handler() → tusb_int_handler()
       └─ TinyUSB 把端点数据搬进该接口的 RX FIFO
usb_task: tud_task_ext()
  └─ tud_cdc_rx_cb(itf)                    ← 注意：这里是任务上下文，不是 ISR
       └─ usb_cdc_drv_t::on_cdc_rx(itf)
            └─ _serial[itf].on_cdc_rx()
                 ├─ while (tud_cdc_n_available(itf))  ← 必须抽干 FIFO
                 │    └─ tud_cdc_n_read() → _rx_buf[_rx_tail]
                 └─ process_rx()  解帧 → dispatch() → 用户 handler
```

> **注意**：`on_cdc_rx()` **必须把 FIFO 抽干**，哪怕一个 handler 都没注册。否则 256 B 的 RX FIFO 很快填满，主机会看到端点永久 NAK，表现为"设备还在，但发什么都发不进去"。

**重同步语义**（`process_rx()`）——这是解帧器最关键的部分：

| 检查               | 失败时的动作                     | 原因                           |
| ------------------ | -------------------------------- | ------------------------------ |
| `rest < 5`         | `break`                          | 帧头还没收全，等下一批数据     |
| `st[0] != SOF`     | `pos++`                          | 不是帧头，往后挪一个字节继续找 |
| CRC8 错            | `pos++`                          | 帧头不可信，**只前进 1 字节**  |
| `data_len > 256`   | `pos++`                          | 长度非法，同样只前进 1 字节    |
| `rest < frame_len` | `break`                          | 半帧，等                       |
| CRC16 错           | `pos++`                          | 整帧不可信，只前进 1 字节      |
| 全部通过           | `dispatch()`，`pos += frame_len` | 消费整帧                       |

**为什么失败时只前进 1 字节而不是跳过整帧？** 因为长度字段本身可能就是被破坏的那个字节。如果按坏长度跳，很可能直接越过后面真正的帧头，导致连续丢帧。只前进 1 字节保证不会漏掉任何可能的同步点——代价是误同步时会多扫几轮，但这是纯内存操作，代价可以忽略。

处理完后把未消费的尾巴 `memmove` 回缓冲区头部：

```c++
if (pos > 0) {
    uint16_t remain_len = _rx_tail - pos;
    if (remain_len > 0)
        memmove(_rx_buf, _rx_buf + pos, remain_len);
    _rx_tail = remain_len;
}
```

#### 3.3 发送路径：组帧与搬运分离

`send()` **不直接写 TinyUSB FIFO**，而是先把帧拼进 `_tx_buf`，再由 `usb_task` 每轮搬走：

```c++
// 调用方（任意任务）
status_t usb_cdc_drv_t::send(uint8_t serial_id, uint8_t frame_id, const uint8_t *data, uint16_t len) {
    if (len > usb_cdc::MAX_DATA_LENGTH) return PYRO_PARAM_ERROR;
    if (data == nullptr)                return PYRO_PARAM_ERROR;
    if (!tud_mounted())                 return PYRO_ERROR;

    scoped_mutex_t lock(_serial[serial_id]._tx_mutex, pdMS_TO_TICKS(5));
    if (!lock.is_locked())              return PYRO_BUSY;

    uint16_t frame_len = len + 7;
    if (_tx_tail + frame_len >= usb_cdc::TX_BUF_CAPACITY)
        return PYRO_BUSY;

    uint8_t *p = _tx_buf + _tx_tail;
    frame_header_t header = { usb_cdc::SOF, frame_id, len, 0 };
    memcpy(p, &header, sizeof(header));
    append_crc8_check_sum(p, sizeof(header));
    if (len > 0) memcpy(p + sizeof(header), data, len);
    append_crc16_check_sum(p, frame_len);

    _tx_tail += frame_len;
    return PYRO_OK;      // ← 此时只是"入队成功"，还没真正发出去
}
```

搬运在 `drain_tx()` 里完成：

```c++
uint32_t space = tud_cdc_n_write_available(_id);
uint16_t chunk = (_tx_tail < space) ? _tx_tail : uint16_t(space);
uint32_t written_len = tud_cdc_n_write(_id, _tx_buf, chunk);
tud_cdc_n_write_flush(_id);          // ← 必须显式调用
memmove(_tx_buf, _tx_buf + written_len, _tx_tail - written_len);
_tx_tail -= written_len;
```

**为什么要这层二级缓冲？** 两个原因：其一，`send()` 可能被任意任务调用，而 TinyUSB 不是线程安全的，必须把真正的 FIFO 操作关进 `usb_task`；其二，FIFO 随时可能满，直接写会失败，而二级缓冲让 `send()` 变成"尽力入队"，把背压问题留给 `drain_tx()` 下一轮重试。

**为什么必须显式 `tud_cdc_n_write_flush()`？** TinyUSB 默认会攒够一个 64 B 的完整数据包才自动发起传输。本项目单帧只有十几到几十字节，不显式 flush 的话小帧会一直压在 FIFO 里，表现为"发出去很久才收到"甚至"一直收不到"。

> **Warning**：`TX_BUF_CAPACITY = 512`，而单帧最长 `256 + 7 = 263` B。连续两帧满长帧需要 526 B > 511 B 可用空间，因此**背靠背发送满长帧时第二帧会返回 `PYRO_BUSY`**。这是设计内的背压，不是 bug——调用方应当检查返回值。

#### 3.4 挂载、卸载与错误恢复

USB 是**可热插拔**的，驱动必须能承受任意时刻的断开：

| 事件                    | 回调          | 动作                                                             |
| ----------------------- | ------------- | ---------------------------------------------------------------- |
| 主机完成枚举            | `on_mount()`  | 清 `_rx_tail`（**不清 handler 表**）                             |
| 主机断开 / 复位         | `on_umount()` | 清 `_rx_tail` + `_tx_tail`，并 `tud_cdc_n_read_flush()` 丢弃残留 |
| 未挂载时调用 `send()`   | —             | 直接返回 `PYRO_ERROR`                                            |
| `drain_tx()` 发现未挂载 | —             | 丢弃 `_tx_tail`，防止旧数据在下次插上时被"补发"                  |

> **Tip**：`on_mount()` 刻意**不清空 handler 表**。handler 是业务模块的注册关系，与插拔无关；清掉会导致重新插拔后所有业务静默失聪。正确做法是在 `init()` 之后、挂载之前就注册好。

## Part 2: 快速上手 (Quick Start)

### 1. 初始化与获取实例

驱动是单例，通过 `instance()` 获取引用：

```c++
#include "pyro_usb_cdc_drv.h"

// 必须在 FreeRTOS 调度器启动之后调用（内部会创建并启动 usb_task）
pyro::usb_cdc_drv_t::instance().init("PYRO-INF2-GIM");
```

序列号有严格校验：**非空、≤ 31 字符、全部可打印 ASCII**，任何一条不满足都返回 `PYRO_PARAM_ERROR`，**不做静默截断**。

> **Warning**：序列号是设备身份，不是装饰。同一台 PC 上插两块板，如果序列号相同，Windows 会把它们认成同一个设备、抢同一个 COM 号——这是最难排查的失效形态。建议按 `产品-机型-编号` 的格式给出唯一值。

### 2. 注册接收回调 (推荐模式)

用 Lambda 捕获 `this`，把成员函数注册为回调：

```c++
void AutoaimDriver::init() {
    auto &usb = pyro::usb_cdc_drv_t::instance();

    usb.register_rx(
        SERIAL_ID,   // 0 或 1：挂在哪一路虚拟串口上
        RX_FRAME_ID, // 只接收这个 ID 的帧
        [this](uint8_t frame_id, const uint8_t *data, uint16_t len) -> bool {
            return this->on_frame(frame_id, data, len);
        });

    usb.enable_rx(SERIAL_ID);
}
```

> **Tip**：`register_rx()` 必须在 `init()` **之后**调用——`init()` 内部会对每路串口调 `reset()`，而 `reset()` 会清空 handler 表。
> **Tip**：但**不需要**等 USB 挂载完成。挂载前注册才是正确做法，否则上电瞬间的帧会丢。
> **Warning**：回调运行在 `usb_task` 上下文（**不是 ISR**），因此可以用任务版 FreeRTOS API，但**绝不能阻塞**。要跨任务传数据请用 `xMessageBufferSend(..., 0)`，超时给 0——缓冲满了宁可丢这一帧，也绝不能拖住 TinyUSB 栈。

### 3. 数据发送

```c++
struct tx_data_t { float yaw; float pitch; uint8_t fire; } __attribute__((packed));

tx_data_t cmd{};
usb.send(SERIAL_ID, TX_FRAME_ID, reinterpret_cast<const uint8_t *>(&cmd), sizeof(cmd));
```

返回值含义：

| 返回值             | 含义                                             |
| ------------------ | ------------------------------------------------ |
| `PYRO_OK`          | 已入队，等待 `usb_task` 搬运                     |
| `PYRO_ERROR`       | USB 未挂载（线没插 / 枚举未完成）                |
| `PYRO_BUSY`        | `_tx_buf` 空间不足，或 5 ms 内没拿到 `_tx_mutex` |
| `PYRO_PARAM_ERROR` | `len > 256`，或 `data == nullptr`                |

> **注意**：`PYRO_OK` 只代表**入队成功**，不代表主机已收到。USB 全速 bulk 端点没有应用层确认机制，需要可靠性就自己在业务层加序号 + 应答。

### 4. 资源释放

模块销毁时移除注册，避免回调打到已析构的对象上：

```c++
AutoaimDriver::~AutoaimDriver() {
    pyro::usb_cdc_drv_t::instance().remove_rx(SERIAL_ID, RX_FRAME_ID);
}
```

## Q&A

**Q1：为什么不用 `tud_cdc_read()` / `tud_cdc_write()` 这类全局 API？**

那是 TinyUSB 给单串口场景准备的便捷封装，内部固定操作 `itf = 0`。本项目要支持多路串口，所有接口都必须显式带 `serial_id`，所以统一用 `tud_cdc_n_read(itf, ...)` / `tud_cdc_n_write(itf, ...)` 这一套带 `n` 的版本。驱动内部没有任何一处硬编码接口号。

**Q2：改了 `CFG_TUD_CDC` 却还是只有一个 COM 口？**

三处必须同时改，缺一不可：

1. `tusb_config.h` → `#define CFG_TUD_CDC 2`
2. `pyro_usb_descriptors.c` → `ITF_NUM_TOTAL = 4`、`CONFIG_TOTAL_LEN = 141`、两组 `TUD_CDC_DESCRIPTOR`、端点号不重复
3. `pyro_usb_cdc_drv.h` → `_serial[]` 数组长度

最容易踩的坑是**只改了第 1 处**。此时 TinyUSB 的 `tud_cdc_n_*(1, ...)` 会在 `TU_VERIFY(itf < CFG_TUD_CDC)` 处**静默返回 0/false**，不报错、不崩溃、不进 HardFault，只表现为"1 号口既收不到也发不出"。排查多串口问题时，第一眼就该看这一行。

**Q3：`send()` 返回 `PYRO_OK`，但上位机没收到？**

按这个顺序查：

1. `tud_mounted()` 是否为真——线插了但枚举失败的话 `send()` 会返回 `PYRO_ERROR`，能返回 `OK` 说明已挂载。
2. 上位机是否**打开了端口**。`CFG_TUD_CDC_TX_OVERWRITABLE_IF_NOT_CONNECTED = 1` 时，DTR=0（端口未打开）下 TX FIFO 可被覆盖，`tud_cdc_write()` 不会失败，即"设备以为在发、其实无人接收"。
3. 帧的 CRC 是否算对。CRC8 覆盖**前 5 字节**（含 CRC8 字节本身置 0 后再算），CRC16 覆盖**除末尾 2 字节外的全部**。这两条最容易写错。

**Q4：为什么最多只能 4 路？**

STM32H723 的 dwc2 控制器 `EP_MAX_HS = 9`，其中 EP0 被控制传输占用，剩 8 个可用端点号。每个 CDC 功能需要 1 个 notify IN 端点 + 1 个数据端点（IN/OUT 共用编号），所以 `8 / 2 = 4`。想要更多路只能换用 Vendor 类自定义协议，或者把多路业务复用在同一路 CDC 上靠 `frame_id` 区分。

**Q5：`frame_id` 只有 256 个，用完了怎么办？**

`frame_id` 是 `uint8_t`，但路由键是 `(serial_id, frame_id)`，两路串口合计 512 个独立 ID。实际项目里业务帧通常只有个位数，远用不满。真要扩展，把 `frame_id` 改成 `uint16_t` 即可——帧头会从 5 B 变成 6 B，`HEADER_SIZE`、`CONFIG` 里的 `LEN` 偏移、`frame_len = len + 7` 这几处要同步改。

**Q6：`enable_rx()` / `disable_rx()` 现在真的有用吗？**

**当前版本这两个函数只写标志位，接收路径并没有读取它**——也就是说，即使不调用 `enable_rx()`，数据照样会进来。保留这两个接口是为了将来支持"按需开关接收"，但请**不要依赖它们来屏蔽数据**。要屏蔽某个 `frame_id`，正确做法是不注册对应 handler（未注册的帧会被 `dispatch()` 静默丢弃）。
