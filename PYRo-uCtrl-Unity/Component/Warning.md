Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_warning_drv.h"/><Badge type = "info" text="pyro_warning_drv.cpp"/>

# PYRo Warning Driver

**基于 WS2812 与蜂鸣器的多级声光报警驱动**

该 `pyro_warning_drv` 模块把机器人运行中的异常状态统一抽象为“声 + 光”两路报警输出：蜂鸣器侧提供 8 级递增的报警音与一段内置旋律，RGB 侧通过 WS2812 提供 6 种颜色的倒计时式报警队列。驱动采用组合模式把 FreeRTOS 任务封装为内部私有类，对外只暴露单例与三个线程安全的设置接口，适用于低电量、超温、通信丢失、急停等需要现场人员立即感知的场景。

> 嵌入式开发前置知识：了解 FreeRTOS 任务与临界区、WS2812 的 PWM + DMA 驱动方式、蜂鸣器 PWM 发声、`task_base_t` 任务框架

## Part 1: 代码全解 (Code Deep Dive)

### 1. 整体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                       Application Layer                      │
│   set_buzzer_warning_level() / add_rgb_warning_type()        │
│   clear_rgb_warning_type() / start() / stop()                │
├──────────────────────────────────────────────────────────────┤
│                     warning_drv_t (单例)                      │
│  • 报警等级锁存（只升不降）                                    │
│  • RGB 颜色倒计时队列 + 多色分时轮播                            │
│  • 声光统一时基（tick）                                        │
├───────────────────────────┬──────────────────────────────────┤
│   warning_task_t          │  内部私有任务（组合模式）          │
│   REALTIME / 256 words    │  每 20ms 推进一次状态机            │
├───────────────────────────┴──────────────────────────────────┤
│        BuzzerPlayer (全局单例)        ws2812_t (TIM3_CH2)      │
│        • tone / music / beep          • 1 颗 RGB 灯            │
│        • 独立 buzzer_player 任务       • DMA 阻塞发送           │
└──────────────────────────────────────────────────────────────┘
```

### 2. 核心设计理念

- **组合模式 (Composition)**：`warning_drv_t` 内部持有 `warning_task_t`，后者继承 `task_base_t` 并把 `init()` / `run_loop()` 回调转发给父对象。驱动类本身不暴露任务接口，只暴露 `start()` / `stop()`，避免应用层误用任务生命周期。
- **单任务统一时基**：声、光两路输出共用同一个 `tick` 计数器，避免各自维护定时器导致节奏漂移。任务每 20ms 循环一次，每次 `tick += 8`，因此 `TICK_PERIOD = 1000` 对应 **2.5s** 的实际周期（源码注释写作 5s，见注意事项）。
- **报警等级锁存**：蜂鸣器等级只允许向上累加，调用较低等级不会降级；必须显式调用 `NONE` 才能解除。这样多任务同时上报不同故障时，最严重的那一级不会被后来的低等级覆盖。
- **颜色倒计时队列**：每种颜色独立持有一个倒计时 `rgb_waring_count[]`，`add` 时重置为满值，之后按周期衰减。多个颜色同时有效时，把当前周期均分给它们轮播；6 种颜色全部有效时退化为彩虹滚动，避免“六色同亮”变成白色。
- **声光解耦**：RGB 与蜂鸣器由同一任务驱动，但状态完全独立。可以只开灯不响、只响不亮，也可以组合成“红灯 + 三级警报”的复合提示。

### 3. 报警类型与内部状态

**RGB 颜色枚举**（`RGB_waring_type_t`，注意源码拼写为 `waring`）：

| 枚举值 | 实际输出 (R, G, B) | 典型语义 |
| --- | --- | --- |
| `GREEN` | (0, 255, 0) | 正常 / 已恢复 |
| `RED` | (255, 0, 0) | 严重故障 / 急停 |
| `BLUE` | (0, 0, 255) | 提示 / 待机 |
| `PURPLE` | (255, 0, 255) | 警告 |
| `YELLOW` | (255, 255, 0) | 注意 / 低电量 |
| `CYAN` | (0, 255, 255) | 信息 / 调试 |
| `NONE` | 不参与报警 | 空值 |
| `COUNT` | 数组长度哨兵 | 仅用于内部计数 |

**蜂鸣器等级枚举**（`buzzer_warning_level_t`）：

| 枚举值 | 行为 |
| --- | --- |
| `NONE` | 停止音乐与持续音，完全静音 |
| `PLAYING` | 循环播放内置旋律（默认《欢乐颂》，8s） |
| `WARNING_LEVEL_1` ~ `WARNING_LEVEL_8` | 每周期发出 1~8 声 1kHz 短鸣 |

**内部状态**：

```c++
// 蜂鸣器
buzzer_warning_level_t _current_buzzer_warning_level = NONE;
BuzzerTask* _buzzer_task = nullptr;   // 内置旋律事件表
bool melody_loaded = false;           // 防止每轮重复 loadTask

// RGB
static constexpr uint16_t RGB_NUM = 1;
static constexpr ws2812_hw_t RGB_HW = WS2812_HW_TIM3_CH2;
ws2812_t* _rgb = nullptr;

uint16_t rgb_waring_count[(int)RGB_waring_type_t::COUNT] = {0}; // 每种颜色的倒计时
RGB_waring_type_t color_lists[(int)RGB_waring_type_t::COUNT];   // 本周期要轮播的颜色
uint8_t available_color_count = 0;
```

### 4. 任务初始化 (`task_init`)

`task_init()` 在 `start()` 触发的初始化阶段执行，完成两件事：

```c++
status_t warning_drv_t::task_init()
{
    // 1. RGB：固定 1 颗灯，挂在 TIM3_CH2
    _rgb = new ws2812_t(RGB_HW);
    if (RGB_NUM > 0)
    {
        if (_rgb->init(RGB_NUM) != PYRO_OK)
            return PYRO_ERROR;
    }
    else
    {
        return PYRO_ERROR;
    }
    available_color_count = 0;
    memset(color_lists, 0, sizeof(color_lists));
    memset(rgb_waring_count, 0, sizeof(rgb_waring_count));

    // 2. 蜂鸣器：初始化播放器并装载内置旋律
    _buzzer_task = new BuzzerTask();
    BuzzerPlayer::getInstance().init();

    _buzzer_task->add_event(0,    BUZZER_GET_FREQ(BUZZER_NOTE_E4), 100);
    // ... 中间省略若干音符 ...
    _buzzer_task->add_event(8000, 0, 100);
    _buzzer_task->set_duration(8000);

    return status_t::PYRO_OK;
}
```

要点：

- `BuzzerPlayer::getInstance().init()` 内部会创建独立的 `buzzer_player` 任务（优先级 `configMAX_PRIORITIES - 2`，栈 256），旋律的实际推进由该任务完成，`warning_task_t` 只负责“装载 / 停止 / 发声”。
- 内置旋律是《欢乐颂》，事件表硬编码在 `task_init()` 中。源码里还保留了《See You Again》前奏的注释代码，需要换曲子时替换这一段事件表即可。
- 若 WS2812 初始化失败，`task_init()` 返回 `PYRO_ERROR`，`task_base_t` 不会创建循环任务；但 `warning_drv_t::start()` 的返回类型是 `void`，错误被丢弃，应用层无法感知。调试时应先单独确认 WS2812 通道可用。

### 5. 主循环时基与 RGB 调度

`task_run_loop()` 是一个 20ms 周期的无限循环：

```c++
while (true)
{
    static int tick = 0;
    tick += TICK_STEP;      // +8
    tick %= TICK_PERIOD;    // 1000

    handle_buzzer(tick, buzzer);

    if (tick == 0)
    {
        // 每个周期开始时：衰减倒计时、重建颜色轮播表
        available_color_count = 0;
        memset(color_lists, 0, sizeof(color_lists));
        for (int i = 0; i < (int)RGB_waring_type_t::COUNT - 1; i++)
        {
            if (rgb_waring_count[i] >= RGB_DECAY_STEP)   // 250
            {
                rgb_waring_count[i] -= RGB_DECAY_STEP;
                color_lists[available_color_count++] = (RGB_waring_type_t)i;
            }
            else
            {
                rgb_waring_count[i] = 0;
            }
        }
        current_each_color_shine_times =
            available_color_count > 0 ? TICK_PERIOD / available_color_count : 0;
    }

    // 根据 color_lists 输出当前颜色
    // ...
    _rgb->update();
    vTaskDelay(pdMS_TO_TICKS(20));
}
```

**颜色轮播规则**：

- 每种颜色被 `add_rgb_warning_type()` 置为 `15000`，每个周期扣 `250`，因此一种颜色从触发到熄灭约 **60 个周期**。按实际 2.5s/周期计算约为 **150s（2.5 分钟）**；源码注释按 5s/周期写的是 5 分钟。
- 同一周期内有 `N` 种颜色有效时，把 1000 个 tick 均分为 `N` 段，每段 `1000 / N` 个 tick。例如 2 种颜色各亮 1.25s，3 种颜色各亮约 0.83s。
- 6 种颜色同时有效时不再分段，直接进入彩虹模式：每 20ms 色相 `+5`，约 1.44s 转完一圈。
- 没有任何颜色有效时，每轮都写 `(0,0,0)` 并 `update()`，即熄灯。
- `clear_rgb_warning_type()` 只是把倒计时清零；如果该颜色已经进入本周期的 `color_lists`，要等到下一个 `tick == 0` 才会从轮播中移除，最坏有约 2.5s 的延迟。

### 6. 蜂鸣器状态机

`handle_buzzer()` 根据当前等级分三条路径：

```c++
switch (_current_buzzer_warning_level)
{
case NONE:
    buzzer.stop();
    buzzer.tone_stop();
    return;

case PLAYING:
    if (!melody_loaded && _buzzer_task != nullptr)
    {
        buzzer.loadTask(_buzzer_task);
        melody_loaded = true;
    }
    if (!(buzzer.getState() & BUZZER_STATE_MUSIC_PLAYING_BIT))
        melody_loaded = false;   // 播完后允许下一轮重新装载
    return;

default:  // WARNING_LEVEL_1 ~ 8
    break;
}

buzzer.stop();  // 报警音优先级高于音乐
int pulses = (int)_current_buzzer_warning_level -
             (int)buzzer_warning_level_t::WARNING_LEVEL_1 + 1;

if (should_play_warning_tone(tick, pulses))
{
    buzzer.tone_set(1000, 100);
    buzzer.tone_start();
}
else
{
    buzzer.tone_stop();
}
```

**脉冲时序**（`should_play_warning_tone`）：

```c++
for (int i = 0; i < level; ++i)
{
    int start = i * WARN_PULSE_GAP_TICK;   // 100 tick = 250ms
    if (tick >= start && tick < start + WARN_PULSE_ON_TICK)  // 50 tick = 125ms
        return true;
}
```

因此第 `N` 级报警在一个 2.5s 周期内发出 `N` 声短鸣，每声约 125ms，起始间隔 250ms。第 8 级占满约 1.875s，仍留有余量，不会跨周期截断。

**等级锁存规则**（`set_buzzer_warning_level`）：

- `NONE`：无条件写入，立即静音并解除锁存。
- `PLAYING`：特殊分支。若当前不是 `PLAYING`，直接切到旋律模式并重置 `melody_loaded`；若已经是 `PLAYING`，仅把 `melody_loaded` 置 `true`，不会重新从头播放。
- `WARNING_LEVEL_x`：只有 `x` 大于当前等级时才写入，否则保持原等级。也就是说，从 5 级降到 3 级必须经过 `NONE`。

### 7. 对外接口与线程安全

| 接口 | 作用 | 线程安全 |
| --- | --- | --- |
| `instance()` | 获取全局单例，首次调用时构造 | 静态局部变量，C++11 起线程安全 |
| `start()` | 初始化外设并创建 20ms 循环任务 | 只应在系统启动阶段调用一次 |
| `stop()` | 删除循环任务 | 不释放 `_rgb` / `_buzzer_task`，不建议反复启停 |
| `set_buzzer_warning_level(level)` | 设置 / 升级蜂鸣器等级 | `taskENTER_CRITICAL()` 保护 |
| `add_rgb_warning_type(type)` | 触发一种颜色，倒计时重置为满值 | `taskENTER_CRITICAL()` 保护 |
| `clear_rgb_warning_type(type)` | 清除一种颜色的倒计时 | `taskENTER_CRITICAL()` 保护 |

三个 setter 都在临界区内修改共享状态，因此可以被任意任务调用；但 RGB 的实际输出发生在 `warning_task_t` 中，setter 只改数据，不直接操作硬件。

## Part 2: 快速上手 (Quick Start)

### 1. 启动报警任务

```c++
#include "pyro_warning_drv.h"

void init_warning()
{
    // warning_drv_t 是全局类，不在 pyro 命名空间内
    warning_drv_t &warning = warning_drv_t::instance();

    // 初始化 WS2812 + 蜂鸣器，并创建 20ms 循环任务
    warning.start();
}
```

建议在系统初始化阶段、其他外设（TIM3、DMA、蜂鸣器 PWM）就绪之后调用，且只调用一次。

### 2. 触发蜂鸣器报警

```c++
void on_low_battery()
{
    auto &warning = warning_drv_t::instance();

    // 二级报警：每周期 2 声短鸣
    warning.set_buzzer_warning_level(
        warning_drv_t::buzzer_warning_level_t::WARNING_LEVEL_2);
}

void on_battery_recovered()
{
    auto &warning = warning_drv_t::instance();

    // 必须显式回到 NONE，否则等级会一直锁存
    warning.set_buzzer_warning_level(
        warning_drv_t::buzzer_warning_level_t::NONE);
}
```

### 3. 触发 RGB 报警

```c++
void on_over_temperature()
{
    auto &warning = warning_drv_t::instance();

    // 红灯报警，默认持续约 2.5 分钟后自动熄灭
    warning.add_rgb_warning_type(
        warning_drv_t::RGB_waring_type_t::RED);
}

void on_temperature_recovered()
{
    auto &warning = warning_drv_t::instance();

    // 清除红灯（最多约 2.5s 后从当前轮播周期中移除）
    warning.clear_rgb_warning_type(
        warning_drv_t::RGB_waring_type_t::RED);
}
```

### 4. 播放内置旋律

```c++
void play_startup_melody()
{
    auto &warning = warning_drv_t::instance();

    // 循环播放 task_init() 中装载的《欢乐颂》
    warning.set_buzzer_warning_level(
        warning_drv_t::buzzer_warning_level_t::PLAYING);
}

void stop_melody()
{
    warning_drv_t::instance().set_buzzer_warning_level(
        warning_drv_t::buzzer_warning_level_t::NONE);
}
```

### 5. 组合场景：低电量 + 超温

```c++
void update_warning_state(bool battery_low, bool over_temp)
{
    auto &warning = warning_drv_t::instance();

    if (over_temp)
    {
        // 超温优先级更高：红灯 + 五级警报
        warning.add_rgb_warning_type(
            warning_drv_t::RGB_waring_type_t::RED);
        warning.set_buzzer_warning_level(
            warning_drv_t::buzzer_warning_level_t::WARNING_LEVEL_5);
    }
    else if (battery_low)
    {
        // 低电量：黄灯 + 二级警报
        warning.add_rgb_warning_type(
            warning_drv_t::RGB_waring_type_t::YELLOW);
        warning.set_buzzer_warning_level(
            warning_drv_t::buzzer_warning_level_t::WARNING_LEVEL_2);
    }
    else
    {
        // 全部恢复：清灯 + 静音
        warning.clear_rgb_warning_type(
            warning_drv_t::RGB_waring_type_t::RED);
        warning.clear_rgb_warning_type(
            warning_drv_t::RGB_waring_type_t::YELLOW);
        warning.set_buzzer_warning_level(
            warning_drv_t::buzzer_warning_level_t::NONE);
    }
}
```

注意：`add_rgb_warning_type()` 每次调用都会把倒计时重置为满值。如果上层以 10Hz 周期反复调用，颜色将永远不会衰减；应在“故障出现”的边沿调用一次，而不是在轮询循环里持续调用。

### 6. 注意事项 (Caveats)

1. **周期与注释不一致**：任务每 20ms 执行一次、`tick += 8`，`TICK_PERIOD = 1000` 的实际周期是 **2.5s**，不是注释里的 5s。由此推导，颜色倒计时 `15000` 的实际持续时间约为 **2.5 分钟**，也不是注释里的 5 分钟。若需要严格 5s 周期，应把 `TICK_STEP` 改为 4，或把 `TICK_PERIOD` 改为 2000。
2. **等级只升不降**：`WARNING_LEVEL_x` 采用锁存语义，低等级无法覆盖高等级。故障恢复后必须调用 `NONE`，否则蜂鸣器会一直响。`PLAYING` 是例外，它可以覆盖当前报警等级，也可以被更高的报警等级覆盖。
3. **蜂鸣器资源独占**：报警任务在 `WARNING_LEVEL_x` 和 `NONE` 分支中每 20ms 调用一次 `buzzer.stop()` / `tone_stop()`，会持续压制 `BuzzerPlayer` 上的其他音乐与 beep 队列。若系统中还有别的模块使用蜂鸣器播放提示音，需要约定优先级，或把提示音也接入本驱动统一调度。
4. **RGB 硬件固定**：`RGB_NUM = 1`、`RGB_HW = WS2812_HW_TIM3_CH2` 都是编译期常量，且代码只操作 `set_led(0, ...)`。如果 TIM3_CH2 已被其他 WS2812 实例占用，会出现两个实例争用同一路 PWM/DMA；需要改宏或改用其他通道。
5. **启动错误不可见**：`warning_drv_t::start()` 返回 `void`，内部 `task_base_t::start()` 的 `status_t` 被丢弃。WS2812 初始化失败时任务不会运行，但应用层没有任何返回值可判断。建议启动后观察一次灯效，或在调试阶段直接调用底层 `ws2812_t::init()` 验证。
6. **不要反复 start/stop**：`stop()` 只删除循环任务，不释放 `_rgb` 与 `_buzzer_task`；再次 `start()` 会重新 `new` 一份，造成内存泄漏。该驱动按“上电初始化一次、运行期只改状态”的方式设计。
7. **枚举拼写**：头文件中的类型名是 `RGB_waring_type_t`（少一个 `n`），不是 `RGB_warning_type_t`。写代码时以头文件为准，否则编译报错。
8. **命名空间**：`warning_drv_t` 定义在全局命名空间，而它依赖的 `ws2812_t`、`BuzzerPlayer`、`task_base_t` 等位于 `pyro` 命名空间。应用层使用时写 `warning_drv_t::instance()`，不要加 `pyro::`。
9. **颜色数量上限**：内部循环排除了 `NONE` 与 `COUNT`，实际可轮播的颜色最多 6 种；`add_rgb_warning_type(NONE)` 与 `add_rgb_warning_type(COUNT)` 会被静默忽略。
10. **清除有延迟**：`clear_rgb_warning_type()` 只清倒计时，已经进入当前周期轮播表的颜色最多还会亮 2.5s。需要“立即熄灯”时应同时等待下一个周期，或直接调用底层 `ws2812_t::clear()`（不推荐绕过驱动）。

## Q&A

**Q：为什么报警等级要设计成只升不降？**

A：机器人上多个任务可能同时检测到不同故障。如果允许低等级覆盖高等级，后上报的轻微故障会把严重故障的提示压掉。锁存后，最严重等级会一直保持，直到上层确认所有故障都已恢复并显式调用 `NONE`。

**Q：RGB 倒计时为什么按“周期”而不是按毫秒？**

A：主循环本身就是一个 2.5s 的周期状态机，颜色轮播也以周期为单位分配时间片。用周期计数可以避免在 20ms 循环里做浮点计时，代价是时间粒度较粗（2.5s），且实际时长依赖 `TICK_STEP` 与延时。

**Q：可以只报警不响蜂鸣器吗？**

A：可以。只调用 `add_rgb_warning_type()`，不调用 `set_buzzer_warning_level()`，蜂鸣器保持 `NONE` 即可。反过来只响不亮也一样。

**Q：内置旋律能换成自己的歌吗？**

A：当前没有对外的“注入旋律”接口。内置旋律在 `task_init()` 中通过 `BuzzerTask::add_event()` 硬编码，替换这一段事件表即可；也可以后续给 `warning_drv_t` 增加一个 `set_melody(BuzzerTask*)` 接口，把 `_buzzer_task` 的所有权交给调用方管理。

**Q：为什么 6 种颜色同时报警会变成彩虹？**

A：6 种颜色均分 2.5s 后每种只剩约 0.42s，视觉上接近白色闪烁，提示效果反而变差。代码在 `available_color_count == 6` 时切换到彩虹滚动，用颜色变化本身表达“多种故障同时存在”。
