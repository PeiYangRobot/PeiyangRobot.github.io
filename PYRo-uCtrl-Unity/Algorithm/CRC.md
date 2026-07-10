Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_crc.h"/><Badge type = "info" text="pyro_crc.cpp"/>

# PYRo CRC

**CRC8 与 CRC16 校验算法实现**

该模块提供 RoboMaster 裁判系统协议兼容的 CRC8 与 CRC16 校验/追加函数。采用纯 C（`extern "C"`）导出接口，零堆分配，适用于 ISR 上下文中直接调用。

> 前置知识：了解 CRC（循环冗余校验）基本原理、查表法实现

## Part 1: 代码全解 (Code Deep Dive)

### 1. 设计特点

- **无堆分配**: 所有查表数据均为编译期常量 `static const`，无运行时内存开销
- **纯 C 导出**: 使用 `extern "C"` 包裹，可在 C/C++ 混合项目中直接调用
- **DJI 协议兼容**: CRC16 采用 DJI 电调协议规定的多项式与初始值（`0xFFFF`）

### 2. CRC16

多项式为 `0x1189`（对应 DJI 协议），初始值 `0xFFFF`，结果以小端序写入帧尾：

| 函数                                 | 作用                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| `verify_crc16_check_sum(p_msg, len)` | 校验帧尾 2 字节 CRC16，返回 `1` 表示通过             |
| `append_crc16_check_sum(p_msg, len)` | 将 CRC16 小端序填入 `p_msg[len-2]` 和 `p_msg[len-1]` |

```c++
// 内部查表计算
static uint16_t get_crc16_check_sum(uint8_t const *p_msg, uint16_t len, uint16_t crc16)
{
    while (len--) {
        data = *p_msg++;
        crc16 = (crc16 >> 8) ^ crc16_tab[(crc16 ^ data) & 0x00ff];
    }
    return crc16;
}
```

调用方需保证缓冲区末尾 2 字节为 CRC 预留空间。`verify_*` 会对比帧尾值与计算值，`append_*` 会覆写帧尾。

### 3. CRC8

多项式 `0x5E`，初始值 `0xFF`，结果写入帧尾 1 字节：

| 函数                                | 作用                        |
| ----------------------------------- | --------------------------- |
| `verify_crc8_check_sum(p_msg, len)` | 校验帧尾 1 字节 CRC8        |
| `append_crc8_check_sum(p_msg, len)` | 将 CRC8 填入 `p_msg[len-1]` |

### 4. 调用约定

**输入皆不修改** (`verify_*` 系列): `p_msg` 标记为 `const`  
**调用方负责缓冲区空间**: `append_*` 系列要求外层保证 `p_msg` 长 `len` 字节且末尾 CRC 区域已预留空间  
**空值保护**: `p_msg == nullptr` 或 `len` 过短时返回 `0` (false) 或直接返回

## Part 2: 快速使用

```c++
#include "pyro_crc.h"

// 校验整帧 (帧尾 2 字节为 CRC16)
if (verify_crc16_check_sum(frame, total_len)) {
    // CRC16 通过，数据完 整
}

// 帧头 CRC8 校验
if (verify_crc8_check_sum(header, 5)) {
    // 帧头通过
}

// 组帧：先写数据段（留出帧尾），再追加 CRC
uint8_t tx_frame[64];
tx_frame[0] = 0xA5;
// ... 填充数据 ...
append_crc16_check_sum(tx_frame, sizeof(tx_frame));  // 覆写末尾 2 字节
```

## Q&A