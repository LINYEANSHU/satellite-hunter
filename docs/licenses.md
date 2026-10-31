# 许可与第三方依赖

## 本项目

MIT License（见根目录 LICENSE）。

## 第三方组件

### 运行时依赖

| 组件 | 许可 | 集成方式 |
|---|---|---|
| FastAPI / Starlette / Pydantic | MIT | Python 依赖 |
| SQLAlchemy | MIT | Python 依赖 |
| python-sgp4 | MIT | Python 依赖（SGP4 算法 Vallado 参考实现移植） |
| NumPy / SciPy | BSD | Python 依赖 |
| httpx | BSD | Python 依赖 |
| uvicorn | BSD | Python 依赖 |
| React / React DOM | MIT | npm 依赖 |
| Three.js | MIT | npm 依赖 |
| @react-three/fiber / drei | MIT | npm 依赖 |
| Zustand | MIT | npm 依赖 |
| React Router | MIT | npm 依赖 |
| Tailwind CSS | MIT | npm 依赖（构建期） |
| Vite / TypeScript / Vitest | MIT / Apache-2.0 | 开发依赖 |

### 数据与纹理

| 资源 | 来源 | 说明 |
|---|---|---|
| 轨道根数 | CelesTrak (celestrak.org) | 遵守其使用政策（≥2h 请求间隔）；Dr. T.S. Kelso 维护 |
| 地球纹理 | three-globe 示例资源 (unpkg.com/three-globe) | NASA Blue Marble / Black Marble 衍生，公有领域 |
| 测试历元 | Vallado "Revisiting Spacetrack Report #3" 标准用例 | 公开学术参考 |
| 交叉验证 | Skyfield (MIT) | 仅测试依赖 |
| de421.bsp | JPL / Skyfield 发行 | 仅测试用，公有领域 |

### SatDump（可选外部程序）

- **SatDump** 采用 **GPL-3.0** 许可（https://github.com/SatDump/SatDump）。
- 本项目通过**独立进程 CLI 调用**集成，不复制、不修改、不静态链接其源码，
  依据 GPL-3.0 的普通进程间通信边界，本项目代码无需转为 GPL。
- 用户自行安装 SatDump；本项目提供安装指引与调用适配，并在 UI 中展示其版本与归属。
- 如未来以插件形式分发 SatDump 二进制，将遵循 GPL-3.0 的对应分发条款（源码提供等）。

## 商标与归属

- "NORAD"、"CelesTrak" 等名称归各自权利人所有，此处仅作描述性使用。
- 游戏内所有"游戏事件"均为虚构并显式标注，与真实航天事件无关。
