(function () {
  "use strict";

  const C = {
    skipAds: true,
    skipShopping: true,
    skipLive: true,
    autoHighQuality: true,
    qualityPriority: [
      "8K",
      "4K",
      "2K",
      "1080P",
      "720P",
      "540P",
      "480P",
      "360P",
    ],
    debug: true,
    showNotification: true,
    notifDuration: 500,
    busyMs: 1500,
    detectDelay: 500, // 视频跳变后等 DOM 渲染
    jumpThreshold: 3, // currentTime 从 >3 跳到 <0.5 视为切换
    rafInterval: 200, // RAF 检查间隔 ms
  };

  let busy = false;
  let lastKey = "";
  let detectTimer = 0;
  let lastVideoSrc = "";
  let lastCt = 0;
  let rafId = 0;
  let lastRafCheck = 0;

  function log(...a) {
    C.debug && console.log("[抖音跳过]", ...a);
  }

  // ========== 通知 ==========
  function notify(type, text) {
    if (!C.showNotification) return;
    const colors = {
      ad: "linear-gradient(135deg,#ff416c,#ff4b2b)",
      shopping: "linear-gradient(135deg,#f7971e,#ffd200)",
      live: "linear-gradient(135deg,#8a2387,#e94057)",
      info: "linear-gradient(135deg,#11998e,#38ef7d)",
      settings: "linear-gradient(135deg,#4facfe,#00f2fe)",
    };
    const icons = {
      ad: "\uD83D\uDEAB",
      shopping: "\uD83D\uDED2",
      live: "\uD83D\uDCFA",
      info: "\u2713",
      settings: "\u2699\uFE0F",
    };
    const old = document.getElementById("dy-n");
    old && old.remove();
    const el = document.createElement("div");
    el.id = "dy-n";
    el.textContent = `${icons[type]} ${text}`;
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      padding: "10px 24px",
      borderRadius: "24px",
      color: "#fff",
      fontSize: "14px",
      fontWeight: "600",
      fontFamily: "-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif",
      background: colors[type],
      boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .5s";
      el.style.opacity = "0";
    }, C.notifDuration);
    setTimeout(() => el.remove(), C.notifDuration * 2);
  }

  // ========== 辅助 ==========
  function vis(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.top < innerHeight &&
      r.bottom > 0 &&
      r.left < innerWidth
    );
  }
  function anyVis(sel) {
    try {
      return [...document.querySelectorAll(sel)].some(vis);
    } catch (_) {
      return false;
    }
  }

  // ========== 容器获取 ==========
  // 普通视频容器（广告/购物检测使用）
  function getActiveFeed() {
    return document.querySelector('[data-e2e="feed-active-video"]');
  }

  // 虚拟列表中当前活跃的 feed-item（使用有子元素的第二个元素作为当前显示的 Dom）
  function getActiveLiveItem() {
    const feed = document.querySelector(
      '[data-e2e="feed-live"]:has(video[autoplay=""])',
    );
    return feed;
  }

  function getKey() {
    const feed = getActiveFeed();
    if (feed) {
      const v = feed.querySelector("video");
      if (v) return v.getAttribute("poster") || v.src || "";
      return (
        feed.getAttribute("data-video-id") ||
        feed.getAttribute("data-aweme-id") ||
        ""
      );
    }
    // log("没有找到视频容器，使用时间戳作为 key", Date.now().toString());
    return Date.now().toString(); // 没有视频时使用时间戳，确保每次都检测
  }

  // ========== 广告检测 ==========
  function isAd() {
    const feed = getActiveFeed();
    if (!feed) return false;
    const accountEls = feed.querySelectorAll('[class*="account"]');
    for (const el of accountEls) {
      if (el.querySelectorAll("svg[viewBox='0 0 30 16']").length > 0) {
        // log("广告: 检测到'广告'标签");
        return true;
      }
    }
    return false;
  }

  // ========== 购物检测 ==========
  function isShopping() {
    const feed = getActiveFeed();
    if (!feed) return false;
    if (
      anyVis(
        ".xgplayer-shop-anchor,[class*='shop-anchor'],[class*='shopAnchor'],[class*='shop-bar']",
      )
    ) {
      // log("购物: 购物锚点");
      return true;
    }
    const shopLinks = feed.querySelectorAll("a");
    for (const a of shopLinks) {
      const href = (a.getAttribute("href") || "").toLowerCase();
      if (
        (href.includes("haohuo") || href.includes("jinritemai")) &&
        vis(a) &&
        a.getBoundingClientRect().left < innerWidth * 0.66
      ) {
        // log("购物: 购物链接");
        return true;
      }
    }
    const sideBar = document.querySelector("#videoSideBar");
    if (sideBar && vis(sideBar)) {
      if (
        sideBar.querySelector(
          "[class*='good'],[class*='product'],[class*='shop'],[class*='cart'],[class*='buy']",
        )
      ) {
        // log("购物: 侧边栏商品");
        return true;
      }
      if (/商品|橱窗|购物车|小黄车/.test(sideBar.textContent.slice(0, 200))) {
        // log("购物: 侧边栏文字");
        return true;
      }
    }
    if (
      anyVis(
        "[class*='shopping-card'],[class*='product-card'],[class*='goods-card']",
      )
    ) {
      // log("购物: 商品卡片");
      return true;
    }
    return false;
  }

  // ========== 直播检测 ==========
  function isLive() {
    const feedItem = getActiveLiveItem();
    // log("直播检测: feedItem:",  !!feedItem);
    return !!feedItem;
    // if (!feedItem) return false;

    // // 5. 全页面兜底
    // if (feedItem.querySelector('[data-e2e="feed-live"]')) {
    log("直播: feed-live");
    //   return true;
    // }

    // return false;
  }

  // ========== 跳过操作 ==========
  function doSkip() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true,
      }),
    );
    setTimeout(
      () =>
        document.dispatchEvent(
          new WheelEvent("wheel", {
            deltaX: 0,
            deltaY: 800,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            clientX: innerWidth / 2,
            clientY: innerHeight / 2,
          }),
        ),
      80,
    );
    setTimeout(() => {
      const btns = document.querySelectorAll(
        '[class*="next-video"],[class*="arrow-down"],[class*="switch-next"],[data-e2e*="next"],[data-e2e*="arrow-down"]',
      );
      for (const b of btns) {
        if (vis(b)) {
          b.click();
          break;
        }
      }
    }, 160);
  }

  // ========== 核心检测 ==========
  function detect() {
    if (busy) return;
    const key = getKey();
    // log("检测视频，key:", key, "lastKey:", lastKey  );
    if (!key || key === lastKey) return;
    lastKey = key;

    let type = "";
    if (C.skipAds && isAd()) type = "ad";
    else if (C.skipShopping && isShopping()) type = "shopping";
    else if (C.skipLive && isLive()) type = "live";

    if (!type) return;
    busy = true;
    const names = { ad: "广告视频", shopping: "购物视频", live: "直播带货" };
    // log(`跳过: ${names[type]}`);
    notify(type, `已跳过 ${names[type]}`);
    doSkip();
    setTimeout(() => {
      busy = false;
    }, C.busyMs);
  }

  function scheduleDetect() {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detect, C.detectDelay);
  }

  // ========== RAF 监控 video.currentTime 跳变 ==========
  function rafLoop() {
    rafId = requestAnimationFrame(rafLoop);
    const now = performance.now();
    if (now - lastRafCheck < C.rafInterval) return;
    lastRafCheck = now;
    if (busy) return;

    const videos = document.querySelectorAll("video");
    let activeV = null;
    for (const v of videos) {
      if (!vis(v) || v.paused || v.readyState < 2) continue;
      activeV = v;
      break;
    }
    if (!activeV) {
      lastCt = 0;
      lastVideoSrc = "";
      return;
    }

    const ct = activeV.currentTime;
    const src = activeV.src || activeV.getAttribute("poster") || "";
    const srcChanged = src && src !== lastVideoSrc;
    const ctJumped = lastCt > C.jumpThreshold && ct < 0.5;

    if (srcChanged || ctJumped) {
      // log(
      //   `视频切换 (srcChanged=${srcChanged}, ctJumped=${ctJumped}, ct: ${lastCt.toFixed(1)}→${ct.toFixed(1)})`,
      // );
      scheduleDetect();
    }
    lastCt = ct;
    lastVideoSrc = src;
  }

  // ========== 清晰度 ==========
  function setHighestQuality() {
    const btn = document.querySelector(
      '[class*="quality"],[class*="definition"],[data-e2e*="quality"]',
    );
    if (!btn) return;
    btn.click();
    setTimeout(() => {
      for (const q of C.qualityPriority) {
        const opt = [...document.querySelectorAll("li,div,span,button")].find(
          (el) => el.textContent.trim() === q && vis(el),
        );
        if (opt) {
          opt.click();
          // log("清晰度:", q);
          notify("settings", `已设置 ${q}`);
          return;
        }
      }
      btn.click();
    }, 200);
  }

  // ========== 存储 ==========
  chrome.storage.local.get(
    { blockAd: true, blockShopping: true, blockLive: true },
    (d) => {
      C.skipAds = d.blockAd;
      C.skipShopping = d.blockShopping;
      C.skipLive = d.blockLive;
    },
  );
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.blockAd) C.skipAds = ch.blockAd.newValue;
    if (ch.blockShopping) C.skipShopping = ch.blockShopping.newValue;
    if (ch.blockLive) C.skipLive = ch.blockLive.newValue;
  });

  // ========== API ==========
  window._dyAdSkip = {
    get config() {
      return { ...C };
    },
    toggleAd(v) {
      C.skipAds = v;
      chrome.storage.local.set({ blockAd: v });
    },
    toggleShopping(v) {
      C.skipShopping = v;
      chrome.storage.local.set({ blockShopping: v });
    },
    toggleLive(v) {
      C.skipLive = v;
      chrome.storage.local.set({ blockLive: v });
    },
    forceCheck() {
      lastKey = "";
      busy = false;
      detect();
    },
    setHighestQuality,
  };

  // ========== 启动 ==========
  rafId = requestAnimationFrame(rafLoop);
  const start = () => {
    setTimeout(() => {
      if (C.autoHighQuality) setHighestQuality();
      notify("info", "抖音自动跳过已启动");
    }, 1200);
  };
  if (document.readyState !== "loading") start();
  else document.addEventListener("DOMContentLoaded", start);
})();
