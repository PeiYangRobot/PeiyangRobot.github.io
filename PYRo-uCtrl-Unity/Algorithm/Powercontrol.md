Version<Badge type ="tip" text="1.0.0"/>  
File<Badge type = "info" text="pyro_power_control.h"/><Badge type = "info" text="pyro_power_control.cpp"/>

# PYRo Power Control

**RoboMaster 多电机实时功率分配与缓冲能量管理**

该 `power_controller_t` 单例模块实现基于灰盒模型的机器人底盘功率实时管理：通过二次方程建模各电机的电功率损耗，根据裁判系统功率限制 + 电容辅助功率 + 缓冲能量回血需求三个约束条件，在线求解最优的扭矩降额缩放系数 K，并在受控/免控指令之间做一阶低通平滑切换。

> 前置知识：了解 RoboMaster 裁判系统功率限制机制、缓冲能量概念、电机功率模型 (铜损+铁损+机械功)

## Part 1: 代码全解 (Code Deep Dive)

### 1. 功率模型

每个电机节点的功率消耗建模为：

```
P(i) = k1(i)×rpm(i)×cmd(i)            ← 机械功率
     + k2(i)×temp_factor×cmd(i)²       ← 铜损 (含温度补偿)
     + k3(i)×rpm(i)²                   ← 涡流/粘滞摩擦
     + k4(i)×|rpm(i)|                  ← 磁滞/库仑摩擦
     + k5(i)                           ← 静态基础功耗
```

其中 `temp_factor = 1 + alpha×(temp - 20℃)`，铜为正温度系数（温度越高，电阻越大，铜损越大）。

### 2. 核心优化问题

问题定义：给定各电机的原始扭矩需求 `cmd = target + uncontrolled`，在总功率不超过 `dyn_limit` 的约束下，求统一的扭矩缩放系数 K：

```text
目标: 全功率预测 ≤ dyn_limit
变量: K ∈ [0, 1]     ← 施加于受控扭矩 target_cmd

⇒ A·K² + B·K + C ≤ dyn_limit
⇒ K = (-B + √(B² - 4A·C')) / (2A)   (取正根)
   其中 C' = C - dyn_limit
```

系数物理意义：

| 系数 | 含义                         | 表达式                                                    |
| ---- | ---------------------------- | --------------------------------------------------------- |
| A    | 受控铜损 (K² 项)             | `Σ k2t × target²`                                         |
| B    | 受控机械功 + 交叉铜损 (K 项) | `Σ k1×rpm×target + 2·k2t×target×unctrl`                   |
| C    | 免控功耗 + 常数损耗          | `Σ k1×rpm×unctrl + k2t×unctrl² + k3×rpm² + k4×|rpm| + k5` |

### 3. 求解逻辑 (`solve`)

```text
solve(referee_power_limit, buffer_energy, cap_extra_power):

  1. 缓冲能量 PID 计算:
     p_adjust = -PID(safe_energy_ref, current_buffer_energy)

  2. 危险/死区保护:
     if buffer_energy < DANGER(30J):
         p_adjust -= (30 - buffer_energy) * 5.0   ← 强力回血惩罚
     if buffer_energy < DEAD(10J):
         referee_dyn_limit = 0                      ← 切断裁判系统功率

  3. 总动态限制 = max(0, referee_limit + p_adjust) + cap_extra_power

  4. 遍历所有节点，建立二次方程系数 A, B, C

  5. 求解 K:
     if 当前总功率 ≤ dyn_limit: K = 1.0 (不限)
     else if C > dyn_limit:     K = 0.0 (仅免控就已超标)
     else if A > 0:             K = 二次方程正根
     else if B > 0:             K = -C'/B (线性退化)

  6. 逐节点应用: safe_cmd = LPFilter(target × K) + uncontrolled_cmd
```

### 4. 一阶低通平滑

受控扭矩的缩放结果经过 `α = 0.85` 的一阶低通滤波器（替代硬限幅的瞬时截断），避免功率突降时产生的扭矩跳变引发底盘抖动：

```c++
node->last_controlled_cmd =
    0.85f * (target_cmd * K) + 0.15f * node->last_controlled_cmd;
node->safe_cmd = node->last_controlled_cmd + node->uncontrolled_cmd;
```

### 5. 电容辅助功率 (`cap_extra_power`)

`cap_extra_power` 是由外部超级电容模块提供的额外功率预算，直接叠加到总动态限制上。这使得电容放电时底盘可以使用超过裁判系统限制的功率，而电容充电/待机时不额外受限。

### 6. 节点注册

最多支持 `MAX_MOTORS = 8` 个功率节点。每个节点通过 `register_motor()` 注册一组灰盒拟合参数，返回指针供外部实时更新 `target_cmd` / `uncontrolled_cmd` / `rpm` / `temp`。

## Part 2: 快速使用

### 核心代码

```c++
#include "pyro_power_control.h"

void init_power_management()
{
    auto &pc = pyro::power_controller_t::get_instance();

    // 配置缓冲能量 PID 目标值
    pc.config_buffer_loop(60.0f);  // 目标 60J

    // 注册四个底盘电机 (各自标定参数)
    pyro::power_fit_params_t params{};
    params.k1 = 0.012f;  // 机械功率系数
    params.k2 = 0.005f;  // 铜损系数
    params.k3 = 0.001f;  // 涡流/粘滞系数
    params.k4 = 0.002f;  // 库仑摩擦
    params.k5 = 0.5f;    // 静态基础功耗

    auto *m_fl = pc.register_motor(params);
    auto *m_fr = pc.register_motor(params);
    auto *m_bl = pc.register_motor(params);
    auto *m_br = pc.register_motor(params);
}

void chassis_power_loop()
{
    auto &pc = pyro::power_controller_t::get_instance();

    // 1. 更新各电机原始扭矩需求
    m_fl->target_cmd = pid_fl_output;
    m_fr->target_cmd = pid_fr_output;
    m_fl->rpm        = current_rpm_fl;
    m_fr->rpm        = current_rpm_fr;

    // 2. 求解功率分配
    float referee_limit = referee_data.power_heat.chassis_power_limit;
    float buffer_energy = referee_data.power_heat.buffer_energy;
    float cap_power     = supercap.get_feedback().cap_power_cap;

    pc.solve(referee_limit, buffer_energy, cap_power);

    // 3. 使用安全扭矩下发
    motor_fl.send_torque(m_fl->safe_cmd);
    motor_fr.send_torque(m_fr->safe_cmd);

    // 4. 可选: 查看预测总功耗
    float total_power = pc.get_total_predicted_power();
}
```

### 数据处理

```matlab
%% 1. 从表格中提取原始数据
% 确保工作区有导入的 wheel 表格变量
torque_raw = wheel.torque;
rpm_raw    = wheel.rpm;
temp_raw   = wheel.temp;
power_raw  = wheel.power;

%% 2. 简单的安全过滤 (防患于未然)
valid_idx = power_raw <= 500 & ~isnan(power_raw); 
torque_raw = torque_raw(valid_idx);
rpm_raw    = rpm_raw(valid_idx);
temp_raw   = temp_raw(valid_idx);
power_raw  = power_raw(valid_idx);

%% 3. 【核心步骤】数据量级缩放 (防止解算器崩溃)
SCALE_TORQUE = 10000.0;
SCALE_RPM    = 1000.0;

torque_scaled = torque_raw / SCALE_TORQUE;
rpm_scaled    = rpm_raw / SCALE_RPM;

%% 4. 低通滤波去噪 (预处理)
window_size = 20; 
disp('正在进行低通滤波去噪预处理...');
torque_clean = smoothdata(torque_scaled, 'gaussian', window_size);
rpm_clean    = smoothdata(rpm_scaled, 'gaussian', window_size);
temp_clean   = smoothdata(temp_raw, 'gaussian', window_size); 
power_clean  = smoothdata(power_raw, 'gaussian', window_size);

% 将清洗后的输入数据合并为 N×3 的矩阵
InputData = [torque_clean, rpm_clean, temp_clean];

%% 5. 定义灰盒功率拟合模型 (固定 k5 = 0.75)
% 待拟合参数保留 4 个：k(1)=k1(机械), k(2)=k2(铜损), k(3)=k3(高频摩擦), k(4)=k4(库仑摩擦)
power_model = @(k, x) ...
    k(2) .* max(1 + 0.00393 .* (x(:,3) - 20), 1) .* x(:,1).^2 ... % 铜损 (带温度修正)
    + max(k(1) .* x(:,1) .* x(:,2), 0) ...                        % 机械功 (去除负功)
    + k(3) .* x(:,2).^2 ...                                       % 高频摩擦损耗
    + k(4) .* abs(x(:,2)) ...                                     % 库仑摩擦损耗
    + 0.75;                                                       % 静态底噪固定为 0.75

%% 6. 设置拟合参数并执行拟合
k0 = [1.0, 1.0, 1.0, 1.0]; % 4 个初始猜测值
lb = [0, 0, 0, 0];         % 限制所有的物理系数必须大于等于 0
ub = [];                        

options = optimoptions('lsqcurvefit', ...
    'Display', 'iter', ...
    'MaxFunctionEvaluations', 5000, ...
    'MaxIterations', 1000, ...
    'StepTolerance', 1e-8, ...
    'OptimalityTolerance', 1e-8);

disp('开始 4 参数非线性拟合运算...');
[k_fit, resnorm, residual, exitflag] = lsqcurvefit(power_model, k0, InputData, power_clean, lb, ub, options);

%% 7. 打印最终结果并自动还原系数 (直接输出 C++ 代码)
% 计算决定系数 R-square
SStot = sum((power_clean - mean(power_clean)).^2);
SSres = sum(residual.^2);
Rsq = 1 - SSres/SStot;

% --- 核心修改：在后台自动除以比例，计算出真实的 C++ 物理系数 ---
k1_restored = k_fit(1) / (SCALE_TORQUE * SCALE_RPM);
k2_restored = k_fit(2) / (SCALE_TORQUE^2);
k3_restored = k_fit(3) / (SCALE_RPM^2); % 高频项对应 rpm 的平方，除以 1000^2
k4_restored = k_fit(4) / SCALE_RPM;

fprintf('\n================ 拟合与还原结果 ================\n');
fprintf('>>> 拟合优度 R-square (R²) = %.4f \n\n', Rsq);

fprintf('【您可以直接复制以下代码到 C++ 文件中 (无需在控制循环除以比例)】\n');
fprintf('------------------------------------------------------------\n');
% 这里增加了精度到小数点后 8 位 (%.8f)，防止还原后 k3 等参数过小被截断为 0
fprintf('params.k1 = %.8ff; // 机械功率项系数\n', k1_restored);
fprintf('params.k2 = %.8ff; // 铜损/热损耗系数\n', k2_restored);
fprintf('params.k3 = %.8ff; // 高频摩擦系数\n', k3_restored);
fprintf('params.k4 = %.8ff; // 库仑摩擦系数\n', k4_restored);
fprintf('params.k5 = 0.75f;         // 静态基础功耗 (强制固定)\n');
fprintf('params.alpha = 0.00393f;\n');
fprintf('------------------------------------------------------------\n');

%% 8. 可视化：去噪效果与拟合效果对比
figure('Name', '功率模型 4参数 拟合结果', 'Position', [100, 100, 1200, 500]);

% 子图1：展示去噪效果
subplot(1, 2, 1);
plot(power_raw, 'Color', [0.8 0.8 0.8], 'DisplayName', '原始含噪 Power');
hold on;
plot(power_clean, 'b', 'LineWidth', 1.5, 'DisplayName', '低通滤波后 Power');
title('Power 信号低通去噪效果');
xlabel('采样序号');
ylabel('Power (W)');
legend('Location', 'best');
grid on;

% 子图2：模型拟合输出 vs 真实输出
power_predict = power_model(k_fit, InputData);

subplot(1, 2, 2);
plot(power_clean, 'b', 'LineWidth', 1.5, 'DisplayName', '真实 Power (滤波后)');
hold on;
plot(power_predict, 'r', 'LineWidth', 1.2, 'DisplayName', '模型预测 Power');
title(sprintf('模型拟合对比 (R^2 = %.4f)', Rsq));
xlabel('采样序号');
ylabel('Power (W)');
legend('Location', 'best');
grid on;
```

跑功控参数需要先关闭功控，接好功率计（使用方法请看[功率计的使用](../Component/Powermeter.md)），通过各种能抓取调试数据的软件导出一个包含电流（torque），转速（rpm），温度（temp），功率（power）的 csv 文件，可以用 jcom，ozone，vofa 等软件实现

然后在 MATLAB 中新建脚本，将以上代码导入，通过`导入数据`功能将上述 csv 文件导入，导入时注意数据的表头名称必须准确，且将最上方的变量名称命名为`wheel`

导入数据后运行代码，命令行窗口中将输出得到的参数 k1 ~ k5，直接复制到代码中即可

## Q&A