---
toc : true
---

# Debug配置与教学

## VSCode

### 插件

#### RTOS_Views
我们一般使用 VSCode 的时候都会下载一个名为`Cortex-Debug`的插件，这个插件除了调试模式中用到之外，还会附带着下载一些别的插件，比如这里将要讲到的`RTOS_Views`插件

想要使用这个插件，我们需要调整一些配置，请直接搜索`FreeRTOSConfig.h`文件，加入RTOS调试所必须的宏定义，具体如下：
```c
/* USER CODE BEGIN Header */
/*
 * FreeRTOS Kernel V10.3.1
 * Portion Copyright (C) 2017 Amazon.com, Inc. or its affiliates.  All Rights Reserved.
 * Portion Copyright (C) 2019 StMicroelectronics, Inc.  All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * http://www.FreeRTOS.org
 * http://aws.amazon.com/freertos
 *
 * 1 tab == 4 spaces!
 */
/* USER CODE END Header */

#ifndef FREERTOS_CONFIG_H
#define FREERTOS_CONFIG_H

/*-----------------------------------------------------------
 * Application specific definitions.
 *
 * These definitions should be adjusted for your particular hardware and
 * application requirements.
 *
 * These parameters and more are described within the 'configuration' section of the
 * FreeRTOS API documentation available on the FreeRTOS.org web site.
 *
 * See http://www.freertos.org/a00110.html
 *----------------------------------------------------------*/

/* USER CODE BEGIN Includes */
/* Section where include file can be added */
/* USER CODE END Includes */

/* Ensure definitions are only used by the compiler, and not by the assembler. */
#if defined(__ICCARM__) || defined(__CC_ARM) || defined(__GNUC__)
  #include <stdint.h>
  #include "stm32h7xx_hal.h"
  #include "core_cm7.h"
  extern uint32_t SystemCoreClock;
#endif
#define configENABLE_FPU                         0
#define configENABLE_MPU                         0

#define configUSE_PREEMPTION                     1
#define configSUPPORT_STATIC_ALLOCATION          1
#define configSUPPORT_DYNAMIC_ALLOCATION         1
#define configUSE_IDLE_HOOK                      0
#define configUSE_TICK_HOOK                      0
#define configCPU_CLOCK_HZ                       ( SystemCoreClock )
#define configTICK_RATE_HZ                       ((TickType_t)1000)
#define configMAX_PRIORITIES                     ( 7 )
#define configMINIMAL_STACK_SIZE                 ((uint16_t)128)
#define configTOTAL_HEAP_SIZE                    ((size_t)40720)
#define configMAX_TASK_NAME_LEN                  ( 16 )
#define configUSE_16_BIT_TICKS                   0
#define configUSE_MUTEXES                        1
#define configQUEUE_REGISTRY_SIZE                8
#define configUSE_PORT_OPTIMISED_TASK_SELECTION  1
/* USER CODE BEGIN MESSAGE_BUFFER_LENGTH_TYPE */
// ====================== RTOS 调试必需宏 ======================
#define configUSE_TRACE_FACILITY                1
#define configUSE_STATS_FORMATTING_FUNCTIONS     1
#define configGENERATE_RUN_TIME_STATS            1
#define configRECORD_STACK_HIGH_ADDRESS          1
/* Defaults to size_t for backward compatibility, but can be changed
   if lengths will always be less than the number of bytes in a size_t. */
#define configMESSAGE_BUFFER_LENGTH_TYPE         size_t
/* USER CODE END MESSAGE_BUFFER_LENGTH_TYPE */

/* Co-routine definitions. */
#define configUSE_CO_ROUTINES                    0
#define configMAX_CO_ROUTINE_PRIORITIES          ( 2 )

/* Set the following definitions to 1 to include the API function, or zero
to exclude the API function. */
#define INCLUDE_vTaskPrioritySet             1
#define INCLUDE_uxTaskPriorityGet            1
#define INCLUDE_vTaskDelete                  1
#define INCLUDE_vTaskCleanUpResources        0
#define INCLUDE_vTaskSuspend                 1
#define INCLUDE_vTaskDelayUntil              1
#define INCLUDE_vTaskDelay                   1
#define INCLUDE_xTaskGetSchedulerState       1

// ====================== RTOS 调试必需宏 ======================
#define INCLUDE_xTaskGetIdleTaskHandle       1
#define INCLUDE_uxTaskGetStackHighWaterMark  1

/* Cortex-M specific definitions. */
#ifdef __NVIC_PRIO_BITS
 /* __BVIC_PRIO_BITS will be specified when CMSIS is being used. */
 #define configPRIO_BITS         __NVIC_PRIO_BITS
#else
 #define configPRIO_BITS         4
#endif

/* The lowest interrupt priority that can be used in a call to a "set priority"
function. */
#define configLIBRARY_LOWEST_INTERRUPT_PRIORITY   15

/* The highest interrupt priority that can be used by any interrupt service
routine that makes calls to interrupt safe FreeRTOS API functions.  DO NOT CALL
INTERRUPT SAFE FREERTOS API FUNCTIONS FROM ANY INTERRUPT THAT HAS A HIGHER
PRIORITY THAN THIS! (higher priorities are lower numeric values. */
#define configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY 5

/* Interrupt priorities used by the kernel port layer itself.  These are generic
to all Cortex-M ports, and do not rely on any particular library functions. */
#define configKERNEL_INTERRUPT_PRIORITY 		( configLIBRARY_LOWEST_INTERRUPT_PRIORITY << (8 - configPRIO_BITS) )
/* !!!! configMAX_SYSCALL_INTERRUPT_PRIORITY must not be set to zero !!!!
See http://www.FreeRTOS.org/RTOS-Cortex-M3-M4.html. */
#define configMAX_SYSCALL_INTERRUPT_PRIORITY 	( configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY << (8 - configPRIO_BITS) )

/* Normal assert() semantics without relying on the provision of an assert.h
header file. */
/* USER CODE BEGIN 1 */
#define configASSERT( x ) if ((x) == 0) {taskDISABLE_INTERRUPTS(); for( ;; );}
/* USER CODE END 1 */

/* Definitions that map the FreeRTOS port interrupt handlers to their CMSIS
standard names. */
#define vPortSVCHandler    SVC_Handler
#define xPortPendSVHandler PendSV_Handler

/* IMPORTANT: This define is commented when used with STM32Cube firmware, when the timebase source is SysTick,
              to prevent overwriting SysTick_Handler defined within STM32Cube HAL */

#define xPortSysTickHandler SysTick_Handler

/* USER CODE BEGIN Defines */
// ====================== DWT 宏定义 ======================

#if defined(__ICCARM__) || defined(__CC_ARM) || defined(__GNUC__)
extern uint64_t get_dwt_us();

#define portCONFIGURE_TIMER_FOR_RUN_TIME_STATS()    do{}while(0)
#define portGET_RUN_TIME_COUNTER_VALUE()            get_dwt_us()

#endif
/* Section where parameter definitions can be added (for instance, to override default ones in FreeRTOS.h) */
/* USER CODE END Defines */

#endif /* FREERTOS_CONFIG_H */

```
其中`get_dwt_us()`函数应该在`pyro_dwt_drv.cpp`文件中被定义，目的是在C语言环境中使用C++的函数，具体定义如下：
```c++
extern "C"{
    uint64_t get_dwt_us()
    {
        return pyro::dwt_drv_t::get_timeline_us();
    }
}
```

然后`RTOS_Views`插件就可以使用了，在VSCode面板（一般放终端的位置，屏幕正中间下方）中的XRTOS中可以清晰地看到当前任务运行情况，示例如下：
```c
ID  | Address    | Task Name   | Status    | rity    | Start      | Top        | End        | Size | Used | Free | Peak | Runtime
0x1 | 0x20000ae0 | defaultTask | BLOCKED   | 0x3,0x3 | 0x200002d8 | 0x20000a4c | 0x20000ad0 | 2040 | 132  | 1908 | 120  | 00.75% 
0x4 | 0x2000be40 | IDLE        | READY     | 0x0,0x0 | 0x2000bea4 | 0x2000c03c | 0x2000c0a0 | 508  | 100  | 408  | 128  | 42.71%
0x5 | 0x20002568 | dr16_task   | SUSPENDED | 0x6,0x6 | 0x20002160 | 0x2000247c | 0x20002558 | 1016 | 220  | 796  | 208  | 00.00%
0x7 | 0x20003720 | ins_task    | RUNNING   | 0x2,0x2 | 0x20002f18 | 0x2000360c | 0x20003710 | 2040 | 260  | 1780 | 392  | 32.36%
```

其中`ID`为任务ID，`Address`为任务地址，`Task Name`为任务名称，`Status`为任务状态，`rity`为任务优先级，`Start`为任务开始地址，`Top`为任务栈顶地址，`End`为任务结束地址，`Size`为任务栈大小，`Used`为任务栈使用量，`Free`为任务栈剩余量，`Peak`为任务栈峰值，`Runtime`为任务运行时间。

从这里可以看出每个任务占用的栈空间，以及相对的任务运行时间。