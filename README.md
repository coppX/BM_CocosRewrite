# BM_CocosRewrite - 塔防小游戏 Cocos Creator 重制版

这是一个基于Unity项目BM_Minigame使用Cocos Creator 3.8.8重新实现的3D塔防小游戏。

## 项目概述

本项目是对Unity版本塔防小游戏的完整重制，保留了原版游戏的核心玩法和场景效果：
- 3D俯视角塔防玩法
- 玩家通过虚拟摇杆控制角色移动
- 敌人沿贝塞尔曲线路径前进
- 金币收集和投递系统
- 触发器激活地图升级机制

## 已实现功能

### ✅ 核心系统
1. **事件系统** (`EventCenter.ts`)
   - 全局事件中心，单例模式
   - 支持事件注册、触发、移除

2. **游戏管理器** (`GameManager.ts`)
   - 游戏状态管理（等待开始、进行中、游戏结束）
   - 单例模式实现
   - 生命值管理

3. **生命值系统** (`HealthSystem.ts`)
   - 可配置的最大生命值和生命值倍率
   - 伤害和治疗接口
   - 生命值变化和死亡事件回调

### ✅ 玩家系统
1. **玩家控制器** (`PlayerController.ts`)
   - 移动控制和方向设置
   - 旋转速度和移动速度
   - 攻击范围设置
   - 与HealthSystem集成
   - 状态重置功能

2. **虚拟摇杆** (`JoystickController.ts`)
   - 触摸拖拽控制
   - 可视化摇杆背景和手柄
   - 自动显示/隐藏
   - 实时将输入转换为3D移动方向

### ✅ 敌人系统
1. **敌人控制器** (`EnemyController.ts`)
   - 伤害系统和生命值倍率
   - 死亡掉落金币机制
   - 击退效果
   - 对象池支持（预留接口）
   - 左右阵营标识

2. **敌人生成器** (`EnemySpawner.ts`)
   - 支持多个敌人预制体
   - 可配置生成间隔和最大数量
   - 自动生成控制

### ✅ 路径系统
1. **贝塞尔曲线** (`BezierCurve.ts`)
   - 支持任意控制点数量
   - 二次、三次和高阶贝塞尔曲线
   - 曲线长度计算
   - 最近点查询

2. **贝塞尔跟随器** (`BezierFollower.ts`)
   - 沿曲线平滑移动
   - 速度倍率控制
   - 自动朝向前进方向
   - 暂停/继续移动

### ✅ 金币系统
1. **金币组件** (`Coin.ts`)
   - 状态管理（移动中、被投递）
   - 掉落动画接口
   - 所有者标识

2. **金币管理器** (`CoinManager.ts`)
   - 全局金币注册表
   - 可用金币列表管理

3. **金币触发器** (`CoinTrigger.ts`)
   - 金币收集计数
   - 阶段触发事件
   - 地图升级触发

### ✅ 场景结构
```
MainScene
├── Camera (3D透视相机)
├── Canvas (UI根节点)
│   ├── Title (标题文本)
│   └── JoystickArea (虚拟摇杆控制区域)
│       └── JoystickBackground
│           └── JoystickHandle
├── Environment (环境节点)
│   ├── DirectionalLight (定向光)
│   └── Ground (地面)
├── Player (玩家)
│   ├── PlayerController 组件
│   ├── HealthSystem 组件
│   ├── RigidBody 组件
│   └── BoxCollider 组件
└── GamePlay (游戏逻辑容器)
    ├── Managers (管理器容器)
    │   ├── GameManager 组件
    │   └── CoinManager 组件
    ├── BezierPaths (路径容器)
    │   └── BezierCurve_L (左侧路径)
    └── Triggers (触发器容器)
        └── Trigger1 (触发器1)
```

## 脚本文件结构

```
assets/scripts/
├── Core/              # 核心系统
│   ├── EventCenter.ts
│   ├── EventName.ts
│   ├── GlobalVariables.ts
│   ├── HealthSystem.ts
│   └── CoinTrigger.ts
├── Managers/          # 管理器
│   ├── GameManager.ts
│   └── CoinManager.ts
├── Player/            # 玩家相关
│   └── PlayerController.ts
├── Enemy/             # 敌人相关
│   ├── EnemyController.ts
│   └── EnemySpawner.ts
├── Utils/             # 工具类
│   ├── BezierCurve.ts
│   ├── BezierFollower.ts
│   └── Coin.ts
└── UI/                # UI组件
    └── JoystickController.ts
```

## 待完善功能

### 🔧 需要添加的系统
1. **对象池系统** (`PoolMgr`)
   - 金币对象池
   - 敌人对象池
   - 子弹对象池

2. **金币收集系统** (`CoinCollection`)
   - 自动收集附近金币
   - 金币堆叠展示
   - 金币投递到触发器
   - 金币转移到其他收集器

3. **音频系统** (`AudioManager`)
   - BGM播放
   - 音效管理
   - 金币收集音效
   - 攻击音效

4. **武器系统** (`Weapon`, `Bow`, `Bullet`)
   - 攻击逻辑
   - 子弹发射
   - 攻击动画事件

5. **相机系统** (`CameraFollowManager`, `CameraZoom`)
   - 跟随玩家
   - 缩放控制

6. **更多管理器**
   - `EnemyManager` - 敌人统一管理
   - `BulletManager` - 子弹管理
   - `UIManager` - UI管理
   - `DeliverTargetManager` - 投递目标管理
   - `TeamManager` - 队伍管理

### 🎨 需要添加的美术资源
1. 3D模型
   - 玩家角色模型和动画
   - 敌人角色模型和动画
   - 环境模型（山、树、石头等）
   - 建筑物模型

2. UI资源
   - 摇杆贴图
   - 血条UI
   - 金币图标
   - 按钮和面板

3. 特效
   - 攻击特效
   - 死亡特效
   - 金币飞行拖尾

## 使用说明

### 开发环境
- Cocos Creator 3.8.8
- TypeScript
- 支持WebGL和原生平台

### 运行项目
1. 使用Cocos Creator 3.8.8打开本项目
2. 打开`assets/scenes/MainScene.scene`场景
3. 点击预览按钮运行

### 控制方式
- **移动**：在屏幕任意位置按下并拖动，出现虚拟摇杆控制玩家移动
- **攻击**：靠近敌人自动攻击（需完善武器系统）

## 与Unity版本的对应关系

| Unity组件 | Cocos组件 | 说明 |
|----------|----------|------|
| Rigidbody | cc.RigidBody | 刚体物理 |
| BoxCollider | cc.BoxCollider | 碰撞器 |
| MeshRenderer | cc.MeshRenderer | 网格渲染 |
| Animator | cc.Animation | 动画控制 |
| Light | cc.DirectionalLight | 光照 |
| Camera | cc.Camera | 相机 |

## 技术要点

### TypeScript类型安全
所有脚本使用TypeScript编写，提供完整的类型检查和IDE智能提示。

### 组件化架构
遵循Cocos Creator的ECS架构，每个功能独立封装为组件。

### 事件驱动
使用EventCenter实现松耦合的事件系统，模块间通过事件通信。

### 对象池优化
为频繁创建销毁的对象（金币、敌人、子弹）预留了对象池接口。

## 开发进度

- [x] 核心架构搭建
- [x] 玩家控制系统
- [x] 虚拟摇杆UI
- [x] 敌人基础系统
- [x] 贝塞尔路径系统
- [x] 金币系统框架
- [x] 触发器系统
- [ ] 对象池系统
- [ ] 金币收集逻辑
- [ ] 武器和战斗系统
- [ ] 音频系统
- [ ] 相机跟随系统
- [ ] 完整的UI系统
- [ ] 美术资源导入
- [ ] 动画系统
- [ ] 粒子特效

## 📦 资源迁移状态

### ✅ 已完成资源迁移

| 资源类型 | 数量 | 路径 | 状态 |
|---------|------|------|------|
| 📦 FBX模型 | 33个 | `assets/resources/models/` | ✅ 已迁移 |
| 🖼️ 贴图文件 | 80个 | `assets/resources/textures/` | ✅ 已迁移 |
| 🔊 音频文件 | 8个 | `assets/audio/` | ✅ 已迁移 |
| 🧱 材质文件 | 5个 | `assets/materials/` | ✅ 已迁移 |

### 🎯 自动预制体生成系统

项目现已支持**一键生成17个游戏预制体**！

#### VisualPrefabGenerator.ts ⭐
运行游戏时自动创建：
- **核心对象** (4个): Coin, MainBase, ArrowLine, GreenArrow
- **敌人** (3个): Zombie02, ShieldZombie, Soldier
- **防御塔** (2个): MachineGunTower, BowTower
- **特效** (5个): Fx_Upgrade, Fx_Bow_Bullet, Fx_Bow_Hit, Fx_MachineGun_Bullet, Fx_MachineGun_Muzzle
- **其他** (3个): BowArrow, Gate, CavalryCamp

**特点**：
- ✅ 自动加载FBX模型和贴图
- ✅ 资源加载失败时使用临时几何体
- ✅ 只创建视觉组件（mesh、material、animation）
- ✅ 无需手动配置，一键生成

**使用方法**：
1. 点击播放按钮 ▶️
2. GameManager自动调用VisualPrefabGenerator
3. 场景中自动创建17个预制体
4. 停止游戏后拖拽节点到`assets/prefabs/`保存

### 📚 详细文档

- [项目目录结构.md](./项目目录结构.md) - 完整的项目结构说明
- [修复完成测试说明.md](./修复完成测试说明.md) - 测试步骤和问题排查
- [纯视觉预制体生成器.md](./纯视觉预制体生成器.md) - 生成器使用指南
- [完整预制体生成器说明.md](./完整预制体生成器说明.md) - 详细API文档

## 下一步计划

1. ✅ ~~导入3D模型和贴图~~ (已完成)
2. ✅ ~~实现预制体自动生成系统~~ (已完成)
3. **完善预制体游戏逻辑**：为生成的预制体添加游戏脚本
4. **实现对象池系统**：优化性能，避免频繁GC
5. **完善金币收集逻辑**：实现自动收集、堆叠、投递
6. **添加武器系统**：弓箭攻击、子弹轨迹
7. **添加动画**：角色移动、攻击、死亡动画
8. **完善UI系统**：血条、金币计数、结算界面

## 注意事项

1. 相机已设置为3D透视模式，FOV=60，与Unity场景匹配
2. 玩家初始位置(14, 0, 14)与Unity版本一致
3. 虚拟摇杆将输入转换为3D世界坐标系的移动向量
4. 所有管理器采用单例模式，确保全局唯一
5. 组件引用通过MCP工具设置，避免运行时查找
6. 贝塞尔曲线控制点需在编辑器中配置

## 开发工具

本项目使用了Cocos MCP和Unity MCP工具进行开发：
- **Cocos MCP**：场景操作、节点创建、组件配置
- **Unity MCP**：分析原Unity项目结构和逻辑

## 联系方式

项目重制基于原Unity项目`BM_Minigame`，视频演示见`QQ20260311-111234-HD.mp4`。
