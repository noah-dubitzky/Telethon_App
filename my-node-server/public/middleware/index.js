const userAgent = navigator.userAgent || navigator.vendor || window.opera;
const isMobile = typeof navigator.userAgentData === 'object'
  ? navigator.userAgentData.mobile
  : /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

const target = isMobile ? '/mobile/index.html' : '/desktop/index.html';
window.location.replace(target);