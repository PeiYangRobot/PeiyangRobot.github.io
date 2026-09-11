Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_image_drv.h"/><Badge type = "info" text="pyro_image_drv.cpp"/>

# PYRo Image Driver

**基于 FreeRTOS 消息缓冲区的 RoboMaster 图传链路驱动**

该 `pyro_image_drv` 模块实现了与 RoboMaster 图传模块的双向通信。采用轻量级命令码白名单订阅机制进行接收过滤，发送侧使用零拷贝 DMA 整包缓冲区实现高效数据下发，适用于机器人端与自定义控制器/客户端之间的低开销数据交互。

> 前置知识：了解 RoboMaster 裁判系统通信协议、DMA 堆内存管理、FreeRTOS 消息缓冲区

## Part 1: 代码全解 (Code Deep Dive)

### 1.1 整体框架数据流

#### 数据方向（上位机 → MCU）

                    UART硬件接收中断
                            ↓
            rx_callback（ISR中断上下文，禁止耗时操作）
                            ↓
                白名单过滤：只处理已经订阅的cmd_id
                            ↓
    xMessageBufferSendFromISR 将完整帧送入FreeRTOS消息缓冲区（中断退出）
                            ↓
            image_task_t 任务线程阻塞等待消息缓冲区
                            ↓
                取出完整帧 → CRC8/CRC16双重校验
                            ↓
    solve_frame 解析帧，把payload拷贝到接收缓存，更新在线状态

#### 数据方向（MCU → 上位机）
    
           用户代码拿到payload引用(DMA内存)，直接填充数据
                             ↓
        调用 send_controller_data() / send_client_data()
                             ↓
            填充帧头SOF、data_length、seq序号、cmd_id
                             ↓
                    计算帧头CRC8、整包CRC16
                             ↓
        调用底层uart write（DMA发送，缓冲区位于DMA堆，无需二次拷贝）
                             ↓
            维护发包序列号_send_seq，发送失败回滚序号

### 1.2 帧协议与接收检验（任务中）

帧结构`（#pragma pack(push,1)` 1 字节对齐，避免结构体填充字节），结构为：

SOF (0xA5)  |   data_length |   seq |   crc8    |   cmd_id  |   payload |   CRC16

```C++
// pyro_image_drv.h
#pragma pack(push, 1)
struct tx_controller_packet_t
{
    frame_header_t header;           // SOF(1) + data_length(2) + seq(1) + crc8(1) = 5字节
    uint16_t cmd_id;                 // 0x0309: 机器人→自定义控制器
    tx_controller_payload_t payload; // 30 字节负载
    uint16_t crc16;                  // 全帧校验
};

struct tx_client_packet_t
{
    frame_header_t header;
    uint16_t cmd_id;                 // 0x0310: 机器人→自定义客户端
    tx_client_payload_t payload;     // 300 字节负载
    uint16_t crc16;
};
#pragma pack(pop)
```
###  
任务循环与帧校验代码：
```C++
void image_drv_t::task_loop()
{
    uint8_t frame_temp[MAX_FRAME_LEN];
    while (true)
    {
        size_t recv_len = xMessageBufferReceive(_rx_msg_buf, frame_temp, MAX_FRAME_LEN, pdMS_TO_TICKS(100));
        if (recv_len > 0)
        {
            // 双重校验：头部 CRC8 + 全帧 CRC16
            if (verify_crc8_check_sum(frame_temp, HEADER_SIZE) &&
                verify_crc16_check_sum(frame_temp, recv_len))
            {
                solve_frame(frame_temp, static_cast<uint16_t>(recv_len));
            }
        }
        // 超时检测：500ms 未收到数据即离线
        if (dwt_drv_t::get_timeline_ms() - _last_update_time > 500.0f)
            _is_online = false;
    }
}
```
CRC8：校验帧头部分，快速校验帧头是否损坏,CRC16：校验整个完整数据包，校验全部内容
**只有两层校验全部通过，** 才会进入solve_frame解析。

每成功解析一帧，更新_last_update_time时间戳，置_is_online=true；
如果 **500ms** 没有收到合法帧，判定上位机离线，is_online()返回 false；

### 1.3 内存分配：DMA 堆零拷贝发送

控制器数据负载仅 30 字节，而客户端数据负载高达 300 字节。两者使用独立的 DMA 缓冲区避免互相干扰
```C++
_tx_controller_pkt = static_cast<tx_controller_packet_t *>(pvPortDmaMalloc(sizeof(tx_controller_packet_t)));
_tx_client_pkt     = static_cast<tx_client_packet_t *>(pvPortDmaMalloc(sizeof(tx_client_packet_t)));

```
**pvPortDmaMalloc：** 从DMA 专用内存堆分配数据包缓冲区
发送时直接把该内存地址交给 DMA，**不需要把数据再拷贝一份**到串口发送缓冲区，实现零拷贝发包。

`send_controller_data() / send_client_data()` 负责补全帧头、CRC 并触发 DMA 发送。

`send_controller_data()` 内部执行顺序：写 SOF → 写 data_length → 写 seq → 计算头部 CRC8 → 写 cmd_id → 计算全帧 CRC16 → _uart->write() → 失败时回退 _send_seq。

### 1.4 订阅白名单机制
```C++
// pyro_image_drv.h
uint16_t _subscribed_ids[MAX_SUBSCRIBE_NUM];

// pyro_image_drv.cpp — rx_callback (ISR 上下文)
bool image_drv_t::rx_callback(const uint8_t *p, uint16_t size, BaseType_t &task_woken) const
{
    // 1. 快速通道：长度不足时直接丢弃
    if (size < HEADER_SIZE || p[0] != HEADER_SOF) return false;
    if (size < HEADER_SIZE + 2) return true;

    // 2. 解析 CMD_ID
    uint16_t cmd_id_val = p[5] | (static_cast<uint16_t>(p[6]) << 8);

    // 3. O(N) 遍历白名单过滤 (N ≤ 4)
    bool is_subscribed = false;
    for (uint8_t i = 0; i < _subscribed_count; ++i)
    {
        if (_subscribed_ids[i] == cmd_id_val) { is_subscribed = true; break; }
    }
    if (!is_subscribed) return true; // 是 0xA5 但未订阅，静默丢弃

    // 4. 整帧入队到 Task
    if (size >= total_len && _rx_msg_buf != nullptr)
        xMessageBufferSendFromISR(_rx_msg_buf, p, total_len, &task_woken);
    return true;
}
```
`MAX_SUBSCRIBE_NUM = 4`，最多订阅 4 条指令 ID。
初始化时通过 `init({cmd_id1,cmd_id2})` 将需要监听的 cmd_id 存入白名单；
在串口 ISR 回调中收到帧，遍历白名单，如果 cmd_id 不在订阅列表，直接丢弃该帧，不送入消息缓冲区。

设计意图：图传链路指令数量很少，最多 4 个就够用；在中断早期过滤无关数据包，减少消息缓冲区压力，降低 CPU 占用。

## Part 2: 快速上手 (Quick Start)

### 2.1 API总览
```c++
// 初始化，传入需要订阅的指令 ID 集合
void init(std::initializer_list<cmd_id> listening_ids)	
void init()                 // 默认初始化，订阅内置两条指令
void start() const          // 启动后台接收解析任务
[[nodiscard]] bool is_online() const      // 查询图传链路是否在线（500ms 超时）

// 获取控制器通道接收缓冲区指针
[[nodiscard]] const uint8_t* get_controller_rx_data()
// 获取客户端指令接收缓冲区指针
[[nodiscard]] const uint8_t* get_client_rx_cmd_data() const	
// 获取控制器发送 DMA payload 引用
tx_controller_payload_t &get_controller_tx_data()	
// 获取客户端发送 DMA payload 引用
tx_client_payload_t &get_client_tx_data()
        
status_t send_controller_data()      // 打包并 DMA 发送控制器数据包 0x0309
status_t send_client_data()          // 打包并 DMA 发送客户端数据包 0x0310
```

### 2.2 初始化

#### 2.2.1 默认订阅

若只需使用图传内置的自定义控制器 (0x0302) 和自定义客户端指令 (0x0311)，调用无参 init() 即可：
```C++
#include "pyro_image_drv.h"

void init_image_link()
{
    auto &image = pyro::image_drv_t::get_instance();

    // 默认订阅: 0x0302 (自定义控制器) + 0x0311 (自定义客户端指令)
    image.init();

    // 启动接收任务
    image.start();
}
```

#### 2.2.2 自定义订阅列表

若需要订阅额外的图传下行命令（如小地图交互等），使用 init({...}) 显式指定：
```C++
image.init({
    pyro::cmd_id::CUSTOM_CONTROLLER,
    pyro::cmd_id::TINY_MAP_INTERACT,    // 0x0303 小地图交互
    static_cast<pyro::cmd_id>(0x0311)   // 自定义客户端指令
});
```

### 2.3 接收数据示例

```C++
auto& image = image_drv_t::get_instance();

// 判断图传上位机是否在线
if(image.is_online())
{
    // 获取0x0302(CUSTOM_CONTROLLER)接收数据，最多30字节
    const uint8_t *p_ctrl = drv.get_controller_rx_data();

    // 获取0x0311客户端指令接收数据，最多30字节
    const uint8_t *p_client = drv.get_client_rx_cmd_data();
}
```

### 2.4 发送数据示例

重点：`get_controller_tx_data() / get_client_tx_data()`返回DMA 堆内存引用，直接写内存，**不需要自己申请缓冲区。**

```c++
// 示例 1：发送控制器数据包 cmd_id=0x0309，payload 最大 30 字节
void send_to_controller()
{
    auto& image = image_drv_t::get_instance();

    // 获取DMA payload引用，直接填充
    auto& tx_payload = image.get_controller_tx_data();
    tx_payload.data[0] = 0x01;
    tx_payload.data[1] = 0x02;
    // ...填充最多30字节

    // 组装帧头、CRC、DMA发送
    status_t ret = image.send_controller_data();
    if(ret != PYRO_OK)
    {
        // 发送失败处理
    }
}

// 示例 2：发送客户端数据包 cmd_id=0x0310，payload 最大 300 字节
void send_to_client()
{
    auto& image = image_drv_t::get_instance();
    auto& tx_client_payload = image.get_client_tx_data();

    // 直接向DMA内存写数据，无需memcpy
    memcpy(tx_client_payload.data, my_buf, sizeof(my_buf));

    status_t ret = image.send_client_data();
}
```
### 2.5 注意事项

**1. 宏与外设依赖：** `get_instance()` 接口仅当定义 **IMAGE_UART** 宏（绑定目标 UART 外设）时才可用，使用前必须配置该宏指定图传对应的串口。

**2. DMA 内存使用约束：** `tx_controller_packet_t、tx_client_packet_t` 由内部通过 pvPortDmaMalloc 从 DMA 内存池分配，缓冲区生命周期由驱动内部管理，用户层**禁止手动调用释放接口。**

**3. 订阅白名单上限：** 订阅白名单最大数量为 `MAX_SUBSCRIBE_NUM = 4`，调用init()传入的指令 ID 若超出该数量，超出项会被静默丢弃，无提示日志；图传链路指令数量少，4 个配额可满足常规业务场景。

**4. 链路离线判定逻辑：** 连续 500ms 未收到任意已订阅的合法帧，内部会置为离线状态 _is_online = false；上层业务需要主动轮询 is_online() 获取链路在线状态，自行完成超时业务处理。

**5. 分片帧处理行为：** 中断接收回调里，若接收长度满足 size < HEADER_SIZE + 2 将返回 true，代表该片段被消费但不送入消息缓冲区；该逻辑用于处理 DMA 分片带来的不完整帧头，等待后续剩余数据完成接收，属于正常行为。

**6. 接收数据无锁保护：** `get_controller_rx_data()、get_client_rx_cmd_data()` 获取的接收缓冲区由图传任务写、业务层读，驱动内部未提供互斥保护；多线程场景读取接收数据时，上层必须自行加锁，避免读到半更新的残缺数据。

## Q&A