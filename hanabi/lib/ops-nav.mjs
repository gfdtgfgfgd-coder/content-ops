// 单任务工作台路由：采火 / 调配 / 制花
// 完全独立于 app.js，直接从 index.html 加载

(function initContentOpsNav() {
  const VIEWS = ['caihuo', 'peizhi', 'zhihua'];
  let currentOpsView = null;

  function showView(name) {
    currentOpsView = name;
    for (const v of VIEWS) {
      const el = document.getElementById('view-' + v);
      if (!el) continue;
      el.hidden = v !== name;
      el.classList.toggle('active', v === name);
    }
    for (const btn of document.querySelectorAll('[data-view]')) {
      const match = btn.dataset.view === name;
      btn.classList.toggle('is-active', match);
      btn.classList.toggle('active', match);
    }
    sessionStorage.setItem('hanabi.ops-view', name);
  }

  // 让 app.js 的 renderCurrentView 调用后恢复 ops 视图
  window.__opsShowView = () => { if (currentOpsView) showView(currentOpsView); };

  // 导航按钮
  for (const btn of document.querySelectorAll('[data-view="caihuo"],[data-view="peizhi"],[data-view="zhihua"]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }

  // 生成提交后跳到制花
  document.querySelector('#content-ops-form')?.addEventListener('submit', () => {
    setTimeout(() => showView('zhihua'), 200);
  });

  // 初始视图
  const saved = sessionStorage.getItem('hanabi.ops-view');
  showView(VIEWS.includes(saved) ? saved : 'peizhi');

})();
