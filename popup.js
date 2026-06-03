document.addEventListener("DOMContentLoaded", () => {
  const keys = ["blockAd", "blockShopping", "blockLive"];

  chrome.storage.local.get(
    { blockAd: true, blockShopping: true, blockLive: true },
    (config) => {
      for (const key of keys) {
        const checkbox = document.getElementById(key);
        if (checkbox) checkbox.checked = config[key];
      }
      updateStats(config);
    }
  );

  for (const key of keys) {
    const checkbox = document.getElementById(key);
    if (!checkbox) continue;

    // 点击整行 toggle-item 也能切换
    const item = checkbox.closest(".toggle-item");
    if (item) {
      item.addEventListener("click", (e) => {
        if (e.target === checkbox || e.target.closest(".switch")) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      });
    }

    checkbox.addEventListener("change", () => {
      const update = {};
      update[key] = checkbox.checked;
      chrome.storage.local.set(update);
      // 直接更新状态文字，无需再次 get
      const config = {};
      for (const k of keys) {
        const el = document.getElementById(k);
        config[k] = el ? el.checked : true;
      }
      updateStats(config);
    });
  }

  function updateStats(config) {
    const active = [];
    if (config.blockAd) active.push("广告");
    if (config.blockShopping) active.push("购物");
    if (config.blockLive) active.push("直播");

    const statsText = document.getElementById("statsText");
    if (!statsText) return;
    if (active.length === 0) {
      statsText.textContent = "所有跳过已关闭";
    } else {
      statsText.textContent = `正在跳过: ${active.join("、")}`;
    }
  }
});