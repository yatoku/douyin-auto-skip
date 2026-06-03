(function () {
  "use strict";

  const C = {
    skipAds: true,
    skipShopping: true,
    skipLive: true,
    debug: true,
    showNotification: true,
    notifDuration: 500,
    busyMs: 1500,
    detectDelay: 500,
    jumpThreshold: 3,
    rafInterval: 200,
    arrowDelay: 80,
    clickDelay: 160,
    initDelay: 1200,
  };

  let busy = false;
  let lastKey = "";
  let lastVideoSrc = "";
  let lastCt = 0;
  let lastRafCheck = 0;
  let pageVisible = !document.hidden;

  // ========== 定时器统一管理 ==========
  let rafId = 0;
  let detectTimer = 0;
  let notifTimer1 = 0;
  let notifTimer2 = 0;
  let skipWheelTimer = 0;
  let skipClickTimer = 0;
  let busyTimer = 0;
  let initTimer = 0;

  /** 清除指定定时器（传入 {id} 对象，返回清零后的对象） */
  function clearTimer(id) {
    if (id) clearTimeout(id);
  }

  /** 销毁所有定时器 + 停止 rAF + 断开 Observer */
  function destroyAll() {
    // 停止 rAF
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    // 清除所有 setTimeout
    clearTimer(detectTimer);
    clearTimer(notifTimer1);
    clearTimer(notifTimer2);
    clearTimer(skipWheelTimer);
    clearTimer(skipClickTimer);
    clearTimer(busyTimer);
    clearTimer(initTimer);
    detectTimer = notifTimer1 = notifTimer2 = 0;
    skipWheelTimer = skipClickTimer = busyTimer = 0;
    initTimer = 0;
    // 断开 MutationObserver
    if (feedObserver) feedObserver.disconnect();
    // 重置状态
    busy = false;
    lastKey = "";
    log("已销毁所有定时器和监听");
  }

  function log(...a) {
    C.debug && console.log("[抖音跳过]", ...a);
  }

  // ========== 通知（DOM 复用，避免反复创建/销毁） ==========
  let notifEl = null;
  function notify(type, text) {
    if (!C.showNotification) return;
    const colors = {
      ad: "linear-gradient(135deg,#ff416c,#ff4b2b)",
      shopping: "linear-gradient(135deg,#f7971e,#ffd200)",
      live: "linear-gradient(135deg,#8a2387,#e94057)",
      info: "linear-gradient(135deg,#11998e,#38ef7d)",
    };
    const icons = {
      ad: "\uD83D\uDEAB",
      shopping: "\uD83D\uDED2",
      live: "\uD83D\uDCFA",
      info: "\u2713",
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
        transition: "opacity .5s",
      });
      document.body.appendChild(notifEl);
    }
    clearTimer(notifTimer1);
    clearTimer(notifTimer2);
    notifEl.textContent = `${icons[type]} ${text}`;
    notifEl.style.background = colors[type];
    notifEl.style.opacity = "1";
    void notifEl.offsetHeight;
    notifTimer1 = setTimeout(() => {
      notifEl.style.opacity = "0";
      notifTimer1 = 0;
    }, C.notifDuration);
    notifTimer2 = setTimeout(() => {
      notifEl.style.opacity = "0";
      notifTimer2 = 0;
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
      r.left < innerWidth &&
      r.right > 0
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

  // ========== 广告检测 ==========
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

  // ========== 直播检测（限定在 feed 容器内查询） ==========
  function isLive(feed) {
    const root = feed || document;
    if (
      root.querySelector('[data-e2e="feed-live"]:has(video[autoplay=""])')
    ) {
      log("直播: feed-live 中有 autoplay 视频");
      return true;
    }
    return false;
  }

  // ========== 跳过操作（定时器可追踪） ==========
  function doSkip() {
    // 先清除上一轮残留
    clearTimer(skipWheelTimer);
    clearTimer(skipClickTimer);

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
    skipWheelTimer = setTimeout(() => {
      skipWheelTimer = 0;
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
      );
    }, C.arrowDelay);

    skipClickTimer = setTimeout(() => {
      skipClickTimer = 0;
      const btn = [
        ...document.querySelectorAll(
          '[class*="next-video"],[class*="arrow-down"],[class*="switch-next"],[data-e2e*="next"],[data-e2e*="arrow-down"]',
        ),
      ].find(vis);
      btn && btn.click();
    }, C.clickDelay);
  }

  // ========== 核心检测（busy 定时器可追踪） ==========
  function detect() {
    if (busy) return;
    const feed = getActiveFeed();
    const key = getKey(feed);
    if (!key || key === lastKey) return;
    lastKey = key;

    let type = "";
    if (C.skipAds && isAd(feed)) type = "ad";
    else if (C.skipShopping && isShopping(feed)) type = "shopping";
    else if (C.skipLive && isLive(feed)) type = "live";

    if (!type) return;
    busy = true;
    const names = { ad: "广告视频", shopping: "购物视频", live: "直播带货" };
    log(`跳过: ${names[type]}`);
    notify(type, `已跳过 ${names[type]}`);
    doSkip();

    clearTimer(busyTimer);
    busyTimer = setTimeout(() => {
      busyTimer = 0;
      busy = false;
      lastKey = "";
      detect();
    }, C.busyMs);
  }

  function scheduleDetect() {
    clearTimer(detectTimer);
    detectTimer = setTimeout(() => {
      detectTimer = 0;
      detect();
    }, C.detectDelay);
  }

  // ========== RAF 监控（页面隐藏时完全停止，可见时重启） ==========
  function rafLoop() {
    rafId = 0; // 执行时先清零，下一帧由 scheduleRaf 重新请求
    if (!pageVisible) return; // 不可见时不再请求下一帧 → 彻底停止
    const now = performance.now();
    if (now - lastRafCheck < C.rafInterval) {
      rafId = requestAnimationFrame(rafLoop);
      return;
    }
    lastRafCheck = now;
    if (busy) {
      rafId = requestAnimationFrame(rafLoop);
      return;
    }

    const activeV = [...document.querySelectorAll("video")].find(
      (v) => vis(v) && !v.paused && v.readyState >= 2,
    );
    if (!activeV) {
      lastCt = 0;
      lastVideoSrc = "";
      rafId = requestAnimationFrame(rafLoop);
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
    rafId = requestAnimationFrame(rafLoop);
  }

  function startRaf() {
    if (!rafId) rafId = requestAnimationFrame(rafLoop);
  }

  function stopRaf() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
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
    destroy: destroyAll,
  };

  // ========== 页面可见性监控：隐藏时停止 rAF，可见时重启 ==========
  function onVisibilityChange() {
    pageVisible = !document.hidden;
    if (pageVisible) {
      lastKey = "";
      lastVideoSrc = "";
      lastCt = 0;
      startRaf();
      scheduleDetect();
    } else {
      stopRaf();
      // 页面隐藏时清除进行中的跳过定时器
      clearTimer(skipWheelTimer);
      clearTimer(skipClickTimer);
      skipWheelTimer = skipClickTimer = 0;
    }
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // ========== MutationObserver：监听 DOM 变化辅助检测视频切换 ==========
  const feedObserver = new MutationObserver((mutations) => {
    if (busy || !pageVisible) return;
    for (const m of mutations) {
      if (m.type === "childList" && m.addedNodes.length > 0) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && (
            node.matches?.('[data-e2e="feed-active-video"]') ||
            node.querySelector?.('[data-e2e="feed-active-video"]')
          )) {
            scheduleDetect();
            return;
          }
        }
      }
      if (m.type === "attributes" && m.attributeName === "data-e2e") {
        scheduleDetect();
        return;
      }
    }
  });

  // ========== 页面卸载清理 ==========
  window.addEventListener("unload", destroyAll);

  // ========== 启动 ==========
  startRaf();

  const startObserver = () => {
    feedObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-e2e"],
    });
  };

  const start = () => {
    startObserver();
    initTimer = setTimeout(() => {
      initTimer = 0;
      notify("info", "抖音自动跳过已启动");
    }, C.initDelay);
  };
  if (document.readyState !== "loading") start();
  else document.addEventListener("DOMContentLoaded", start);
})();
