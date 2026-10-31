# SatDump 安装与集成说明

SatDump 是开源卫星信号解码套件（GPL-3.0）。本项目以**独立进程 CLI** 方式集成，
不复制、不修改其源码。

## 当前状态

- **未检测到 SatDump 安装**：信号实验室的"离线解码"功能会显示安装指引，
  游戏其余功能（轨道、任务、模拟接收、图鉴、成就）**完全不受影响**。
- 适配层（pipeline 探测 / 参数白名单 / 任务队列 / 日志 / 取消 / 结果解析）
  已完成并通过自动化测试（使用 mock 可执行文件替代外部进程，详见
  `backend/tests/test_satdump_adapter.py`）。
- 开发环境 WSL2 Ubuntu-24.04 的 sudo 需要密码，无法由 Agent 静默安装；
  **真实 SatDump 解码验证待用户安装后执行**（下方步骤完全兼容）。

## Windows 安装（推荐）

1. 打开 https://github.com/SatDump/SatDump/releases
2. 下载最新的 Windows 构建（`SatDump-x.x.x-win64.zip`）
3. 解压后将 `satdump.exe` 所在目录加入 PATH，或设置环境变量：
   ```bat
   setx SH_SATDUMP_BIN "D:\SatDump\satdump.exe"
   ```
4. 验证：`satdump --version`
5. 重启本游戏后端，系统状态页将显示 SatDump 版本与可用 pipeline

## WSL2 Ubuntu 24.04 安装

```bash
sudo apt update
sudo apt install satdump
satdump --version
```

后端会自动探测 WSL 发行版（默认 `Ubuntu-24.04`，可用 `SH_WSL_DISTRO` 覆盖）。

## 使用流程

1. 信号实验室 → 导入录波（支持 cu8 / cs8 / cs16 / cu16 / cf32）
2. 点击「探测 Pipeline」获取当前 CLI 实际支持的解码管线
3. 选择 pipeline 与参数 → 启动解码任务（后台进程，可取消）
4. 完成后查看输出文件，可收藏到图鉴（来源标记 `DECODED_OUTPUT`）

## 安全说明

- 输入文件限定在服务端录波目录内（拒绝路径穿越）
- 参数白名单：pipeline 必须来自 CLI 实际输出；标量参数类型/范围校验
- 不使用 shell 拼接，无命令注入面
- 遵守 GPL-3.0：SatDump 以独立进程运行，归属信息见 docs/licenses.md
