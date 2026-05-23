# 抖音自动跳过

Chrome 浏览器扩展，自动跳过抖音 PC 网页版中的广告视频、购物视频和直播带货，强制设置最高画质。

## 功能

- **广告跳过** — 检测视频信息区的「广告」标签，自动划到下一个视频
- **购物跳过** — 检测购物链接、商品锚点、侧边栏商品卡片
- **直播跳过** — 检测直播标签、黄色购物车、「进入直播间」按钮等 7 种特征
- **最高画质** — 自动选择可用最高清晰度（8K → 4K → 2K → 1080P …）
- **开关控制** — 点击扩展图标可独立开关三类跳过
- **零配置** — 安装即用，无需额外设置

## 安装

### Chrome 应用商店（推荐）

> 待上架

### 开发者模式加载

1. 下载本仓库 ZIP 或 `git clone`
2. 打开 Chrome，访问 `chrome://extensions/`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择本仓库目录
5. 打开 [douyin.com](https://www.douyin.com) 即可生效


## 技术原理

- 基于 `requestAnimationFrame` 监控 `video.currentTime` 跳变判断视频切换
- 在视频信息区域（屏幕左侧 2/3）检测广告/购物/直播标签
- Manifest V3，纯 content script，无后台进程

## 开发

```bash
git clone https://github.com/yatoku/douyin-auto-skip.git
# Chrome → chrome://extensions/ → 加载已解压的扩展程序 → 选择目录
```

修改 `content.js` 后，在扩展管理页点击刷新图标即可生效。

## License

MIT