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
    checkbox.addEventListener("change", () => {
      const update = {};
      update[key] = checkbox.checked;
      chrome.storage.local.set(update, () => {
        chrome.storage.local.get(
          { blockAd: true, blockShopping: true, blockLive: true },
          updateStats
        );
      });
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