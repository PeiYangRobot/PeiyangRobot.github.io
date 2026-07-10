Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_core_dma_heap.h"/><Badge type = "info" text="pyro_core_dma_heap.cpp"/><Badge type = "info" text="pyro_core_mem.cpp"/>
# PYRo Memory

## 简介

`pyro_core_dma_heap` 是一个独立的内存管理模块，专门用于管理 DMA 相关的内存分配。它采用与 FreeRTOS `heap_4.c` 相同的空闲块合并算法，但拥有独立的堆空间，不占用系统主堆。

### 为什么需要这个模块？

在 STM32H7 架构中，默认的系统堆（System Heap）通常被配置在 DTCMRAM 中。然而，DTCM 仅通过专用总线与 CPU 直接相连，DMA无法访问 DTCMRAM 区域。

这意味着，如果你使用标准的 `pvPortMalloc` 分配缓冲区并传给 DMA，会导致传输错误或总线访问故障。

本模块通过创建一个独立的堆空间（`.dma_heap` 段），允许开发者将其放置在 **SRAM1/2/3** 或 **AXI SRAM** 等 DMA 可访问的内存区域，从而确保 DMA 传输的稳定性和安全性。

## 1. 堆的定义与配置 (Heap Definition & Configuration)

DMA 堆的内存空间由一个名为 `ucDmaHeap` 的数组定义。你可以通过 `configTOTAL_DMA_HEAP_SIZE` 宏来控制其大小，通过修改`ucDmaHeap`前的`section`字段来控制其位置（或通过修改ld文件中的`.dma_heap`）

## 2. API 参考 (API Reference)

该模块提供了一组与 FreeRTOS 标准堆函数类似的 API，但在命名中增加了 `Dma` 以示区分。使用前请包含头文件：

```c
#include "pyro_core_dma_heap.h"
```

### `pvPortDmaMalloc`

从 DMA 专用堆中分配内存。

```c
void *pvPortDmaMalloc( size_t xWantedSize );
```

- **参数**: `xWantedSize` - 需要分配的字节数。
- **返回值**: 成功时返回指向分配内存块的指针；失败（内存不足或堆大小为0）时返回 `NULL`。
- **特性**: 返回的地址自动满足系统的字节对齐要求。

### `vPortDmaFree`

释放由 `pvPortDmaMalloc` 分配的内存。

```c
void vPortDmaFree( void *pv );
```

- **参数**: `pv` - 指向要释放的内存块的指针。
- **说明**: 如果传入 `NULL`，函数将直接返回，不会执行任何操作。释放后，该内存块会自动与相邻的空闲块合并以减少碎片。

### `vPortGetDmaHeapStats`

获取 DMA 堆当前的运行状态统计信息。

```c
void vPortGetDmaHeapStats( HeapStats_t *pxHeapStats );
```

- **参数**: `pxHeapStats` - 指向 `HeapStats_t` 结构体的指针（结构体定义在 `FreeRTOS.h` 中）。
- **用途**: 可用于监控堆的剩余空间、碎片化程度以及历史最低剩余量。

## 3. 使用示例

```c
void DmaTask( void )
{
    // 1. 申请 1KB 的 DMA 缓冲区
    uint8_t *pBuffer = ( uint8_t * ) pvPortDmaMalloc( 1024 );

    if( pBuffer != NULL )
    {
        // 成功申请，执行 DMA 操作...
        
        // 2. 使用完毕后释放
        vPortDmaFree( pBuffer );
    }
}
```

## Q&A