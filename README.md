# 抖音自动跳过

> v1.1.0

Chrome 浏览器扩展，自动跳过抖音 PC 网页版中的广告视频、购物视频和直播带货视频，直接刷到下一个。

## 功能

- **广告跳过** — 检测视频信息区的「广告」SVG 标签，自动划到下一个视频
- **购物跳过** — 检测购物锚点、商品链接、侧边栏商品卡片、商品橱窗等多种特征
- **直播跳过** — 检测 feed-live 容器中的 autoplay 直播视频
- **开关控制** — 点击扩展图标可独立开关三类跳过，点击整行即可切换
- **智能节能** — 页面不可见时自动暂停检测，切回时立即恢复
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

- **双重检测机制**：`requestAnimationFrame` 监控 `video.currentTime` 跳变 + `MutationObserver` 监听 DOM 节点变化，双保险捕获视频切换
- **页面可见性优化**：通过 `visibilitychange` 事件，页面隐藏时完全停止 rAF 循环和跳过定时器，节省 CPU 资源；切回时自动重启并触发检测
- **定时器全生命周期管理**：所有 `setTimeout` / `requestAnimationFrame` 均可追踪、按需清除，页面卸载时统一销毁，杜绝内存泄漏
- **通知 DOM 复用**：提示通知复用同一 DOM 元素，避免反复创建/销毁
- 基于 Manifest V3，纯 content script，无后台 Service Worker

## 项目结构

```
douyin-adblock/
├── icons/          # 扩展图标 (16/48/128px)
├── manifest.json   # Manifest V3 配置
├── content.js      # 核心检测与跳过逻辑
├── popup.html      # 弹出面板 UI
├── popup.js        # 弹出面板交互逻辑
└── popup.css       # 弹出面板样式
```

## 开发

```bash
git clone https://github.com/yatoku/douyin-auto-skip.git
# Chrome → chrome://extensions/ → 加载已解压的扩展程序 → 选择目录
```

修改 `content.js` 后，在扩展管理页点击刷新图标即可生效。

## License

MIT
