# dsh-rail-pulse

给 DeepSeek Harness（DSH）右侧加一条**跟随电脑系统音频跳动**的频谱条。

![preview](docs/preview.png)

## 特性

- **系统音频直采**：用 macOS ScreenCaptureKit 采集系统播放声音，不需要 BlackHole 等虚拟声卡
- **46 段频谱**：Hann 窗 + vDSP 512 点 FFT，对数频段 + AGC 自动增益
- **彩虹 / 单色**：默认彩虹渐变、色相缓慢流动；面板里可切单色并自选颜色
- **浮窗设置**：长条右下角 `♪` 打开，含显示开关、灵敏度、平滑、炫彩开关、自定义单色
- **配置持久化**：保存在 `~/.dsh/rail-pulse/config.json`
- **默认不打扰**：`shell.overlay` 浮层默认 click-through，只有设置按钮接收点击

## 要求

- macOS 13 及以上（ScreenCaptureKit 音频采集）
- DeepSeek Harness 桌面版 0.2.x
- 系统「屏幕录制」权限：DSH 需要被允许（系统设置 → 隐私与安全性 → 屏幕录制与系统录音）
- 重新编译原生采集器需要 Xcode Command Line Tools

## 安装

### 方式一：本地安装（开发/自用）

```bash
git clone https://github.com/l1625116707-cmyk/dsh-rail-pulse.git
cd dsh-rail-pulse
./scripts/build.sh   # 重新编译 bin/railpulse-audio（仓库已带 arm64 预编译）
```

在 DSH 里用插件管理器安装这个目录，或：

```bash
dsh plugin --profile desktop add /绝对路径/dsh-rail-pulse
```

### 方式二：从 GitHub 安装

```bash
dsh plugin --profile desktop add github:l1625116707-cmyk/dsh-rail-pulse
```

装好后刷新 DSH 页面（`Cmd+R`）。

## 使用

1. 右侧出现一条竖排频谱条
2. 点右下角 `♪` 打开浮窗
3. 可调：显示/隐藏、灵敏度、平滑、炫彩色、自定义单色
4. 播放任意系统声音（音乐、视频、会议）即可看到律动

## 配置

运行时接口：

- `GET /rail-pulse/levels`：最新频谱 `{ "bands": [...], "t": ... }`
- `GET/POST /rail-pulse/config`：`{ visible, gain, smoothing, colorful, color }`

配置文件：`~/.dsh/rail-pulse/config.json`

## 原生采集器

`native/railpulse-audio.swift` 由 host 插件以子进程方式拉起，读取系统音频并逐行输出 JSON：

```json
{"bands":[0.12,0.35,...],"t":1795525475.7}
```

它只读取音频采样做频谱计算，不保存、不上传音频。

```bash
./scripts/build.sh
```

## 许可

MIT
