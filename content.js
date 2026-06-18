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
    maxConsecutiveSkips: 5,
    skipCooldownMs: 10000,
    observerThrottleMs: 300,
  };

  let busy = false;
  let lastKey = "";
  let lastVideoKey = "";
  let lastCt = 0;
  let lastRafCheck = 0;
  let pageVisible = !document.hidden;
  let consecutiveSkips = 0;
  let cooldownActive = false;
  let lastUrl = location.href;
  let observerThrottleTimer = 0;

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
    clearTimer(observerThrottleTimer);
    detectTimer = notifTimer1 = notifTimer2 = 0;
    skipWheelTimer = skipClickTimer = busyTimer = 0;
    initTimer = 0;
    observerThrottleTimer = 0;
    // 移除路由监听
    window.removeEventListener("popstate", checkUrlChange);
    window.removeEventListener("hashchange", checkUrlChange);
    // 断开 MutationObserver
    if (feedObserver) feedObserver.disconnect();
    // 重置状态
    busy = false;
    lastKey = "";
    consecutiveSkips = 0;
    cooldownActive = false;
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
    return "";
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

    if (!type) {
      consecutiveSkips = 0;
      return;
    }

    consecutiveSkips++;
    if (consecutiveSkips > C.maxConsecutiveSkips) {
      log(`连续跳过 ${consecutiveSkips} 次，进入冷却期`);
      notify("info", `连续跳过过多，暂停 ${C.skipCooldownMs / 1000} 秒`);
      cooldownActive = true;
      busy = true;
      clearTimer(busyTimer);
      busyTimer = setTimeout(() => {
        busyTimer = 0;
        busy = false;
        cooldownActive = false;
        consecutiveSkips = 0;
        lastKey = "";
        log("冷却期结束，恢复检测");
        detect();
      }, C.skipCooldownMs);
      return;
    }

    busy = true;
    const names = { ad: "广告视频", shopping: "购物视频", live: "直播带货" };
    log(`跳过: ${names[type]} (连续第${consecutiveSkips}次)`);
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
      lastVideoKey = "";
      rafId = requestAnimationFrame(rafLoop);
      return;
    }

    const ct = activeV.currentTime;
    // Fix 2: 用更稳定的标识替代 video.src（poster > 父容器 data 属性 > src 去参数）
    const feed = getActiveFeed();
    const vKey =
      (feed && feed.getAttribute("data-video-id")) ||
      (feed && feed.getAttribute("data-aweme-id")) ||
      activeV.getAttribute("poster") ||
      (activeV.src ? activeV.src.split("?")[0] : "");
    const videoChanged = vKey && vKey !== lastVideoKey;
    const ctJumped = lastCt > C.jumpThreshold && ct < 0.5;

    if (videoChanged || ctJumped) {
      log(
        `视频切换 (videoChanged=${videoChanged}, ctJumped=${ctJumped}, ct: ${lastCt.toFixed(1)}→${ct.toFixed(1)})`,
      );
      scheduleDetect();
    }
    lastCt = ct;
    lastVideoKey = vKey;
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
      consecutiveSkips = 0;
      cooldownActive = false;
      detect();
    },
    destroy: destroyAll,
  };

  // ========== SPA 路由变化检测（Fix 4） ==========
  function resetAllState() {
    lastKey = "";
    lastVideoKey = "";
    lastCt = 0;
    consecutiveSkips = 0;
    cooldownActive = false;
    busy = false;
    clearTimer(busyTimer);
    busyTimer = 0;
    log("路由变化，已重置所有状态");
    scheduleDetect();
  }

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetAllState();
    }
  }
  window.addEventListener("popstate", checkUrlChange);
  window.addEventListener("hashchange", checkUrlChange);
  // SPA 还可能通过 pushState/replaceState 跳转，劫持它们
  const _pushState = history.pushState;
  const _replaceState = history.replaceState;
  history.pushState = function (...args) {
    _pushState.apply(this, args);
    checkUrlChange();
  };
  history.replaceState = function (...args) {
    _replaceState.apply(this, args);
    checkUrlChange();
  };

  // ========== 页面可见性监控：隐藏时停止 rAF，可见时重启 ==========
  function onVisibilityChange() {
    pageVisible = !document.hidden;
    if (pageVisible) {
      lastKey = "";
      lastVideoKey = "";
      lastCt = 0;
      startRaf();
      scheduleDetect();
    } else {
      stopRaf();
      clearTimer(skipWheelTimer);
      clearTimer(skipClickTimer);
      skipWheelTimer = skipClickTimer = 0;
    }
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // ========== MutationObserver（Fix 1：节流 + 快速过滤无关变更） ==========
  const feedObserver = new MutationObserver((mutations) => {
    if (busy || !pageVisible) return;
    // 节流：短时间内多次触发只执行一次
    if (observerThrottleTimer) return;
    let relevant = false;
    for (const m of mutations) {
      if (m.type === "childList" && m.addedNodes.length > 0) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && (
            node.matches?.('[data-e2e="feed-active-video"]') ||
            node.querySelector?.('[data-e2e="feed-active-video"]')
          )) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (m.type === "attributes" && m.attributeName === "data-e2e") {
        relevant = true;
        break;
      }
    }
    if (!relevant) return;
    observerThrottleTimer = setTimeout(() => {
      observerThrottleTimer = 0;
    }, C.observerThrottleMs);
    scheduleDetect();
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
