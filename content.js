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
    detectDelay: 500,
    jumpThreshold: 3,
    rafInterval: 200,
    arrowDelay: 80,
    clickDelay: 160,
    qualityDelay: 200,
    initDelay: 1200,
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

  // ========== 通知（DOM 复用，避免反复创建/销毁） ==========
  let notifEl = null;
  let notifTimer1 = 0;
  let notifTimer2 = 0;
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
    if (!notifEl) {
      notifEl = document.createElement("div");
      notifEl.id = "dy-n";
      Object.assign(notifEl.style, {
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
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        pointerEvents: "none",
      });
      document.body.appendChild(notifEl);
    }
    clearTimeout(notifTimer1);
    clearTimeout(notifTimer2);
    notifEl.textContent = `${icons[type]} ${text}`;
    notifEl.style.background = colors[type];
    notifEl.style.opacity = "1";
    notifEl.style.transition = "none";
    notifTimer1 = setTimeout(() => {
      notifEl.style.transition = "opacity .5s";
      notifEl.style.opacity = "0";
    }, C.notifDuration);
    notifTimer2 = setTimeout(() => {
      notifEl.style.opacity = "0";
    }, C.notifDuration * 2);
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
    return [...document.querySelectorAll(sel)].some(vis);
  }

  // ========== 容器获取 ==========
  function getActiveFeed() {
    return document.querySelector('[data-e2e="feed-active-video"]');
  }

  function getKey(feed) {
    if (feed) {
      const v = feed.querySelector("video");
      if (v) return v.getAttribute("poster") || v.src || "";
      return (
        feed.getAttribute("data-video-id") ||
        feed.getAttribute("data-aweme-id") ||
        ""
      );
    }
    return Date.now().toString();
  }

  // ========== 广告检测（单次 :has() 替代遍历 + 子查询） ==========
  function isAd(feed) {
    if (!feed) return false;
    if (
      feed.querySelector('[class*="account"]:has(svg[viewBox="0 0 30 16"])')
    ) {
      log("广告: 检测到'广告'标签");
      return true;
    }
    return false;
  }

  // ========== 购物检测 ==========
  function isShopping(feed) {
    if (!feed) return false;
    if (
      anyVis(
        ".xgplayer-shop-anchor,[class*='shop-anchor'],[class*='shopAnchor'],[class*='shop-bar']",
      )
    ) {
      log("购物: 购物锚点");
      return true;
    }
    if (
      [...feed.querySelectorAll("a")].some((a) => {
        const href = (a.getAttribute("href") || "").toLowerCase();
        return (
          (href.includes("haohuo") || href.includes("jinritemai")) &&
          vis(a) &&
          a.getBoundingClientRect().left < innerWidth * 0.66
        );
      })
    ) {
      log("购物: 购物链接");
      return true;
    }
    const sideBar = document.querySelector("#videoSideBar");
    if (sideBar && vis(sideBar)) {
      if (
        sideBar.querySelector(
          "[class*='good'],[class*='product'],[class*='shop'],[class*='cart'],[class*='buy']",
        )
      ) {
        log("购物: 侧边栏商品");
        return true;
      }
      if (/商品|橱窗|购物车|小黄车/.test(sideBar.textContent.slice(0, 200))) {
        log("购物: 侧边栏文字");
        return true;
      }
    }
    if (
      anyVis(
        "[class*='shopping-card'],[class*='product-card'],[class*='goods-card']",
      )
    ) {
      log("购物: 商品卡片");
      return true;
    }
    return false;
  }

  // ========== 直播检测 ==========
  function isLive() {
    if (
      document.querySelector('[data-e2e="feed-live"]:has(video[autoplay=""])')
    ) {
      log("直播: feed-live 中有 autoplay 视频");
      return true;
    }
    return false;
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
      C.arrowDelay,
    );
    setTimeout(() => {
      const btn = [
        ...document.querySelectorAll(
          '[class*="next-video"],[class*="arrow-down"],[class*="switch-next"],[data-e2e*="next"],[data-e2e*="arrow-down"]',
        ),
      ].find(vis);
      btn && btn.click();
    }, C.clickDelay);
  }

  // ========== 核心检测 ==========
  function detect() {
    if (busy) return;
    const feed = getActiveFeed();
    const key = getKey(feed);
    if (!key || key === lastKey) return;
    lastKey = key;

    let type = "";
    if (C.skipAds && isAd(feed)) type = "ad";
    else if (C.skipShopping && isShopping(feed)) type = "shopping";
    else if (C.skipLive && isLive()) type = "live";

    if (!type) return;
    busy = true;
    const names = { ad: "广告视频", shopping: "购物视频", live: "直播带货" };
    log(`跳过: ${names[type]}`);
    notify(type, `已跳过 ${names[type]}`);
    doSkip();
    setTimeout(() => {
      busy = false;
      lastKey = "";
      detect();
    }, C.busyMs);
  }

  function scheduleDetect() {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detect, C.detectDelay);
  }

  // ========== RAF 监控 ==========
  function rafLoop() {
    rafId = requestAnimationFrame(rafLoop);
    const now = performance.now();
    if (now - lastRafCheck < C.rafInterval) return;
    lastRafCheck = now;
    if (busy) return;

    const activeV = [...document.querySelectorAll("video")].find(
      (v) => vis(v) && !v.paused && v.readyState >= 2,
    );
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
      log(
        `视频切换 (srcChanged=${srcChanged}, ctJumped=${ctJumped}, ct: ${lastCt.toFixed(1)}→${ct.toFixed(1)})`,
      );
      scheduleDetect();
    }
    lastCt = ct;
    lastVideoSrc = src;
  }

  // ========== 存储 ==========
  const STORAGE_KEYS = ["blockAd", "blockShopping", "blockLive"];
  const STORAGE_PROPS = ["skipAds", "skipShopping", "skipLive"];
  chrome.storage.local.get(
    { blockAd: true, blockShopping: true, blockLive: true },
    (d) => {
      C.skipAds = d.blockAd;
      C.skipShopping = d.blockShopping;
      C.skipLive = d.blockLive;
    },
  );
  chrome.storage.onChanged.addListener((ch) => {
    STORAGE_KEYS.forEach((k, i) => {
      if (ch[k]) C[STORAGE_PROPS[i]] = ch[k].newValue;
    });
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
  };

  // ========== 启动 ==========
  rafId = requestAnimationFrame(rafLoop);
  const start = () => {
    setTimeout(() => {
      if (C.autoHighQuality) notify("info", "抖音自动跳过已启动");
    }, C.initDelay);
  };
  if (document.readyState !== "loading") start();
  else document.addEventListener("DOMContentLoaded", start);
})();
