Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_dr16_rc_drv.h"/><Badge type = "info" text="pyro_dr16_rc_drv.cpp"/><Badge type = "info" text="pyro_rc_base_drv.h"/><Badge type = "info" text="pyro_rc_base_drv.cpp"/><Badge type = "info" text="pyro_rc_core.h"/><Badge type = "info" text="pyro_virtual_rc.h"/><Badge type = "info" text="pyro_vt03_rc_drv.h"/><Badge type = "info" text="pyro_vt03_rc_drv.h"/>

# PYRo RC Driver

**基于 FreeRTOS 任务通知与发布-订阅模式的遥控器驱动框架**

该 `pyro_rc_drv` 模块采用事件驱动架构。通过统一的虚拟遥控器映射、状态机消抖以及泛型事件代理 (Broker)，提供多协议（如 DR16、VT03）的解析与事件分发功能。

## Part 1: 代码全解 (Code Deep Dive)

### 1. 全局虚拟控制器映射与硬件差异

框架将底层不同 UART 协议解析后的数据，统一映射至全局唯一的 `shared_v_rc` 虚拟控制器中。所有的模拟量（如摇杆、鼠标）和离散量（如按键、拨杆）由 `virtual_rc_t` 结构体集中管理。

```c++
// pyro_virtual_rc.h
struct virtual_rc_t
{
    struct { float lx, ly, rx, ry; float wheel; } axes{};
    struct { float x, y, z; } mouse_axes{};
    struct { tiny_switch_t left; tiny_switch_t right; tiny_switch_t gear; } switches;
    struct { tiny_button_t trigger, fn_l, fn_r, pause; ... } buttons;
    struct { tiny_button_t w, s, a, d; ... } keys;
    // ...
};
```

**需要注意的是，底层硬件的物理差异仍然存在：**
虽然应用层通过 `pyro::rc_drv_t::read()` 获取的是同一套标准化数据结构，但不同遥控器实际映射的字段不同。例如，DR16 拥有左/右拨杆，而没有 `gear` 挡位；VT03 则拥有 `gear` 挡位，而没有独立的左右拨杆。

```c++
// DR16 映射逻辑 (pyro_dr16_rc_drv.cpp)
shared_v_rc.switches.right.update(map_sw(dr16_buf->s1));
shared_v_rc.switches.left.update(map_sw(dr16_buf->s2));

// VT03 映射逻辑 (pyro_vt03_rc_drv.cpp)
shared_v_rc.switches.gear.update(map_gear(vt03_buf->gear));
```

在上层使用时，可通过 `check_online` 接口判定遥控器是否在线。

```c++
// 检测VT03是否在线
if (vt03_drv_t::instance().check_online())  
{  
    booster_vt032cmd(notify_val);  
}  
// 检测DR16是否在线
else if (dr16_drv_t::instance().check_online())  
{  
    booster_dr162cmd(notify_val);  
}
```

### 2. 遥控器优先级与抢占式调度策略

在多遥控器同时接入的场景下，框架在底层串口接收回调中实现了基于位操作的抢占式调度逻辑。每个遥控器在初始化时会被赋予一个优先级位 (`priority_bit`)，数值越小优先级越高。

例如，VT03 的优先级位为 0（高优先级），DR16 的优先级位为 1（次高优先级）：

```c++
// VT03 初始化，优先级位设为 0 (pyro_vt03_rc_drv.cpp)
vt03_drv_t::vt03_drv_t(uart_drv_t &vt03_uart)
    : rc_drv_t(vt03_uart, "vt03_task", 0, sizeof(vt03_buf_t)) {}

// DR16 初始化，优先级位设为 1 (pyro_dr16_rc_drv.cpp)
dr16_drv_t::dr16_drv_t(uart_drv_t &dr16_uart)
    : rc_drv_t(dr16_uart, "dr16_task", 1, sizeof(dr16_buf_t)) {}
```

框架通过一个全局的静态变量 `sequence` 来记录当前所有在线的遥控器状态。在 UART 接收中断 (`rc_callback`) 中，系统会通过 `__builtin_ctz(sequence)` 快速计算出当前在线的最高优先级设备的位号。

如果接收到的数据包来自低优先级设备，而高优先级设备当前处于在线状态，该数据包将在中断层被直接丢弃，不会发送至消息缓冲区：

```c++
// 串口接收中断回调逻辑 (pyro_rc_base_drv.cpp)
bool rc_drv_t::rc_callback(const uint8_t *buf, const uint16_t len, BaseType_t &xHigherPriorityTaskWoken)
{
    if (len == _frame_len && check_packet(buf))
    {
        // 比较当前设备的优先级与全局最高在线优先级
        if (__builtin_ctz(sequence) >= _priority_bit)
        {
            xMessageBufferSendFromISR(_rc_msg_buffer, buf, len, &xHigherPriorityTaskWoken);
            return true;
        }
    }
    return false;
}
```

通过这种机制，当高优先级遥控器（如 VT03）上线后，会自动屏蔽低优先级遥控器（如 DR16）的数据流输入，确保控制权的唯一性与安全性。

### 3. 内部任务代理与线程安全

基类 `rc_drv_t` 的任务生命周期管理通过私有内部类 `rc_task_t` 实现，对外隐藏了任务基类的接口。

```c++
// pyro_rc_base_drv.h
class rc_drv_t
{
  private:
    class rc_task_t : public task_base_t {
      protected:
        status_t init() override;
        void run_loop() override;
      // ...
    };
    rc_task_t _task; // 包含一个任务实体，代理运行逻辑
};
```

同时，框架引入了读写锁机制 (`rw_lock`)。在底层驱动解包 (`unpack`) 数据时，会获取写锁；而在应用层读取连续量数据时，需要配合 `pyro::read_scope_lock` 获取读锁，以保证多线程环境下的数据一致性。

```c++
// 底层写入时加写锁 (pyro_dr16_rc_drv.cpp)
void dr16_drv_t::unpack(const uint8_t *buf) {
    // ...
    write_scope_lock rc_write_lock(get_lock());
    shared_v_rc.axes.rx = ...
}
```

### 4. 按键状态管理与“延迟”机制

离散控制元件的状态由 `tiny_switch_t` 和 `tiny_button_t` 类进行管理。`tiny_button_t` 内置了 1 帧的物理消抖处理。

**核心差异：`PRESS_DOWN` (按下) 与 `SINGLE_CLICK` (单击)**

- **`PRESS_DOWN` (零延迟)**：当按键电平发生变化并经过 1 帧消抖后，状态机会立刻派发 `PRESS_DOWN` 事件。因此，订阅 `PRESS_DOWN` 能够获得极致的响应速度。
- **`SINGLE_CLICK` (带有判定延迟)**：如果按键开启了多击判定，系统在按键松开后会进入等待确认态，等待最多 18 帧的时间来观察是否有后续的连击操作。只有超时确认没有连击，才会派发 `SINGLE_CLICK` 事件。

```c++
// pyro_rc_core.h (tiny_button_t::update 状态机)
switch (state) {
    case 0: // 【空闲态】
        if (current_level == active_level) {
            dispatch(btn_event_t::PRESS_DOWN); // 按下瞬间，立即派发零延迟事件
            // ...
            state = 1;
        }
        break;
    case 1: // 【按下态】
        if (current_level != active_level) {
            // ...
            if (cfg_multi_clk) state = 2; // 若开启多击判定，进入状态2等待
            else { dispatch(btn_event_t::SINGLE_CLICK); state = 0; }
        }
        break;
    case 2: // 【等待确认连击态】
        // ...
        else if (++ticks >= 18) { // 18帧 = 252ms，超时确认
            if (repeat_cnt == 1) dispatch(btn_event_t::SINGLE_CLICK); // 延迟派发
            // ...
            state = 0;
        }
        break;
}
```

### 5. 事件发布与订阅机制 (Broker)

应用层通过泛型代理类 `rc_broker_t` 订阅按键和拨杆事件。当硬件控件判定操作发生时触发 `publish`。Broker 会通过 FreeRTOS 的 `xTaskNotify` 向绑定的应用层任务发送指定的位掩码 (Event Bits)。

```c++
// pyro_rc_core.h
static void publish(TargetType *target, EventType ev) {
    for (auto &_sub : _subs) {
        if (_sub.target_ptr == target && _sub.target_ev == ev) {
            // 直接触发对应任务的通知位掩码
            xTaskNotify(_sub.task, _sub.bit, eSetBits);
        }
    }
}
```

## Part 2: 快速上手 (Quick Start)

### 1. 订阅事件 (App 级初始化)

在应用层的初始化函数中，定义任务通知位掩码，将所需的硬件动作绑定到当前任务句柄。如果对延迟敏感（如武器开火），应优先订阅 `PRESS_DOWN`。

```c++
// 1. 定义任务通知的位掩码
constexpr uint32_t EVENT_BIT_FRIC_TOGGLE   = (1 << 0);
constexpr uint32_t EVENT_BIT_FIRE          = (1 << 1);

void hero_booster_init(void *argument) {
    // 获取全局虚拟控制器引用 (确保已调用初始化)
    auto &vrc = pyro::rc_drv_t::read();
    
    // 2. 通过 Broker 登记事件
    // 订阅按键 Q "按下" (PRESS_DOWN)，享受零延迟响应
    pyro::btn_broker::subscribe(&vrc.keys.q, pyro::btn_event_t::PRESS_DOWN, 
                                booster_task_handle, EVENT_BIT_FRIC_TOGGLE);
    
    // 订阅左拨杆向下切到中档事件
    pyro::sw_broker::subscribe(&vrc.switches.left, pyro::sw_event_t::DOWN_TO_MID, 
                               booster_task_handle, EVENT_BIT_FIRE);
}
```

### 2. 检查在线状态与读取数据 (App 级循环)

在应用层的线程循环中，**必须**使用 `check_online()` 接口来判断当前是哪一款遥控器在线，以此来决定读取哪些硬件专有字段（如 VT03 的 gear，或 DR16 的 switch）。

```c++
void hero_booster_thread(void *argument) {
    while (true) {
        uint32_t notify_val = 0;
        
        // 1. 提取任务通知（非阻塞等待，超时为0）
        xTaskNotifyWait(0x00, 0xFFFFFFFF, &notify_val, 0);

        // 默认重置所有脉冲触发变量，形成严格的 1 帧电平脉冲
        quad_booster_cmd_ptr->fire_enable = false;
        
        // 2. 检查具体遥控器是否在线并分支处理
        if (vt03_drv_t::instance().check_online()) {
            // 获取读锁以保证数据一致性
            pyro::read_scope_lock lock(pyro::vt03_drv_t::instance().get_lock());
            auto &vrc = pyro::rc_drv_t::read();
            
            // VT03 专有逻辑：使用 gear 挡位
            if (pyro::sw_pos_t::DOWN == vrc.switches.gear.current_pos) {
                // ... Auto-aim 开火等业务逻辑 ...
            }
            
            // 处理事件通知
            if (notify_val & EVENT_BIT_FIRE) {
                quad_booster_cmd_ptr->fire_enable = true;
            }
            
        } else if (dr16_drv_t::instance().check_online()) {
            // 获取读锁以保证数据一致性
            pyro::read_scope_lock lock(pyro::dr16_drv_t::instance().get_lock());
            auto &vrc = pyro::rc_drv_t::read();
            
            // DR16 专有逻辑：使用 right switch
            if (pyro::sw_pos_t::DOWN == vrc.switches.right.current_pos) {
                quad_booster_cmd_ptr->mode = pyro::cmd_base_t::mode_t::PASSIVE;
            }
        }
        
        vTaskDelay(1);
    }
}
```

## Q&A