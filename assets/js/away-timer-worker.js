// 给 eggs.js 的「离开提示」计时：后台标签页里主线程的定时器会被浏览器对齐到约 1 秒一次，
// Worker 里的定时器不受影响。页面带内容安全策略（不允许 blob: / data: 的 Worker），所以这里是个同源小文件。
onmessage = (event) => {
  const { token, delay } = event.data || {};
  setTimeout(() => postMessage(token), Number(delay) || 0);
};
