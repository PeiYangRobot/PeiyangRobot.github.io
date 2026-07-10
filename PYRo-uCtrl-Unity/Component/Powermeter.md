Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_powermeter.h"/><Badge type = "info" text="pyro_powermeter.cpp"/>

# POWERMETER

## 接口
1. `powermeter_drv_t(uint32_t can_id, can_hub_t::which_can which)`
构造函数，通过 new 创造对象，第一个参数填入0x212（队里现在用的功率计只能用这个），第二个参数填入想使用的 CAN 
2. `status_t init()`
初始化，具体实现可以不用管，在 new 出功率计对象后、使用功率计相关函数之前 init 就好
3. `bool get_data(powermeter_data& data)
struct powermeter_data {
    float current;
    float voltage;
    float power;
};`功率计的更新函数，会将更新后的数据存放在 data 结构体中，需要在调用这个函数之前先通过`pyro::powermeter_data power_data`创建 data 结构体

示例

```
//This is a demo cpp
//include “xxx.h”
#include "pyro_powermeter.h"

#ifdef __cplusplus

extern "C"
{
//声明各种对象和结构体
...
pyro::powermeter_drv_t *power_meter;
pyro::powermeter_data power_data;
...

void demo_task(void *arg)
{
    //new对象
    ...
    power_meter = new pyro::powermeter_drv_t(0x212 ,pyro::can_hub_t::can3);
    power_meter->init();
    ...
    
    while(true)
    {
        //任务线程
        ...
        power_meter->get_data(power_data);
        ...
        
        vTaskDelay(1);
    }
}

#endif
#endif
```

这样就可以通过 power_data.xxx 访问 data 结构体中的电压，电流和功率了

## 注意事项 (Caveats)

1. **CAN 总线必须先初始化**: 调用 `powermeter_drv_t::init()` 前，对应的 CAN 总线必须已完成 `bsp_can::init_all()`。否则 `get_can()` 将返回 `nullptr`，初始化失败。
2. **无内置超时检测**: `powermeter_drv_t` 不自主判断设备离线。若需要超时逻辑，上位模块应结合 `can_msg_buffer_t::get_last_update_time()` 自行实现。
3. **ID 冲突**: 同一 CAN 总线上不能有两个 `can_msg_buffer_t` 注册相同的 ID。若多个模块需要同一功率计数据，应在应用层共享 `powermeter_data`，而非重复注册。
4. **缓冲区生命周期**: `can_msg_buffer_t` 在 `init()` 中通过 `new` 分配，由 `powermeter_drv_t` 析构时通过 `delete` 释放。确保 `powermeter_drv_t` 实例在整个使用期间保持存活（建议定义为全局变量）。

## Q&A