// ============================================================
// Shut the Box — history storage wrapper (no DOM).
// Loads in the browser (ES module) and in node (tests).
// Tracks whether storage is usable so the History screen can
// explain an empty state instead of silently showing one
// (Safari private tabs, Block All Cookies, and ITP purges all
// throw or drop localStorage data — see todo_1erfIE3l).
// ============================================================

export function createHistoryStore(getStorage, storeKey) {
  let memory = null; // in-memory copy; also the fallback when storage fails
  let broken = false; // set when storage is unavailable, throws, or drops a write

  function load() {
    if (memory) return memory;
    try {
      const storage = getStorage();
      if (!storage) throw new Error('storage unavailable');
      memory = JSON.parse(storage.getItem(storeKey) || '{}') || {};
    } catch (err) {
      console.warn('History unreadable, starting fresh:', err);
      broken = true;
      memory = {};
    }
    return memory;
  }

  function save(dateStr, result) {
    const history = load();
    history[dateStr] = result;
    try {
      const storage = getStorage();
      if (!storage) throw new Error('storage unavailable');
      storage.setItem(storeKey, JSON.stringify(history));
    } catch (err) {
      console.warn('Could not persist history:', err);
      broken = true;
    }
  }

  function isBroken() {
    return broken;
  }

  return { load, save, isBroken };
}
