/**
 * 各渠道真实可上架的SDK集成代码
 * 每个渠道使用其官方要求的API和规范
 */

module.exports = {
  /**
   * Facebook/Meta Instant Games
   * 官方文档: https://developers.facebook.com/docs/instant-games/playable-ads
   */
  facebook: `
<!-- Facebook Playable Ad SDK -->
<script>
window.FbPlayableAd = window.FbPlayableAd || {};
window.addEventListener('load', function() {
  // Facebook 要求使用特定的 API
  if (typeof FbPlayableAd !== 'undefined') {
    // 通知 Facebook 广告已加载完成
    if (typeof FbPlayableAd.onCTAClick === 'undefined') {
      FbPlayableAd.onCTAClick = function() {
        // 点击 CTA 按钮时调用
        window.location.href = window.clickTag || 'https://www.facebook.com/gaming';
      };
    }
  }

  // 等待游戏加载完成后通知 Facebook
  if (typeof window.PlayableSDK !== 'undefined') {
    setTimeout(function() {
      window.PlayableSDK.ready();
    }, 100);
  }
});
</script>
`,

  /**
   * Google Ads / Google UAC
   * 官方文档: https://developers.google.com/ad-manager/docs/playable-ads
   */
  google: `
<!-- Google Playable Ad SDK -->
<script>
// Google ExitApi - 官方要求的退出API
window.ExitApi = window.ExitApi || {
  exit: function(url) {
    // Google 要求使用 ExitApi.exit() 来打开商店链接
    var target = url || window.clickTag || window.location.href;
    window.parent.postMessage({
      type: 'adExitClick',
      url: target
    }, '*');

    // 兼容处理
    if (window.parent !== window) {
      try {
        window.parent.location = target;
      } catch(e) {
        window.open(target, '_blank');
      }
    }
  }
};

// 上报事件到 Google
window.dapi = window.dapi || {
  isReady: function() { return true; },
  addEventListener: function(event, callback) {
    if (event === 'ready' && callback) {
      setTimeout(callback, 100);
    }
  },
  removeEventListener: function() {},
  getScreenSize: function() {
    return {
      width: window.innerWidth || 375,
      height: window.innerHeight || 667
    };
  }
};

window.addEventListener('load', function() {
  // 通知 Google 广告已准备就绪
  window.parent.postMessage({ type: 'adReady' }, '*');
});
</script>
`,

  /**
   * TikTok / Pangle
   * 官方文档: https://www.pangleglobal.com/zh/playable-ads
   */
  tiktok: `
<!-- TikTok/Pangle Playable Ad SDK -->
<script>
// TikTok 要求使用 postMessage 与容器通信
window.TikTokPlayableSDK = {
  ready: function() {
    this.sendMessage('playableReady');
  },
  download: function() {
    this.sendMessage('download');
  },
  sendMessage: function(action, data) {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'playable',
        action: action,
        data: data || {}
      }, '*');
    }
  },
  track: function(eventName, params) {
    this.sendMessage('track', {
      event: eventName,
      params: params
    });
  }
};

// 点击下载
window.clickPlayableDownloadButton = function() {
  window.TikTokPlayableSDK.download();
  var url = window.clickTag || window.downloadUrl || '';
  if (url) {
    window.location.href = url;
  }
};

window.addEventListener('load', function() {
  setTimeout(function() {
    window.TikTokPlayableSDK.ready();
  }, 100);
});
</script>
`,

  /**
   * Mintegral (汇量科技)
   * 官方文档: https://www.mintegral.com/en/support/
   */
  mintegral: `
<!-- Mintegral Playable Ad SDK -->
<script>
// Mintegral MRAID 兼容
window.mraid = window.mraid || {
  state: 'loading',
  listeners: {},

  addEventListener: function(event, listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  },

  removeEventListener: function(event, listener) {
    if (this.listeners[event]) {
      var idx = this.listeners[event].indexOf(listener);
      if (idx > -1) {
        this.listeners[event].splice(idx, 1);
      }
    }
  },

  fireEvent: function(event, data) {
    if (this.listeners[event]) {
      for (var i = 0; i < this.listeners[event].length; i++) {
        this.listeners[event][i](data);
      }
    }
  },

  getState: function() {
    return this.state;
  },

  open: function(url) {
    var target = url || window.clickTag || '';
    window.location.href = target;
  },

  close: function() {
    window.parent.postMessage({ type: 'close' }, '*');
  }
};

// 标记为就绪
window.addEventListener('load', function() {
  setTimeout(function() {
    window.mraid.state = 'default';
    window.mraid.fireEvent('ready');
  }, 100);
});
</script>
`,

  /**
   * Unity Ads
   * 官方文档: https://docs.unity.com/ads/PlayableAdsGuidelines.html
   */
  unityads: `
<!-- Unity Ads Playable SDK -->
<script>
// Unity Ads MRAID 2.0 兼容
window.mraid = window.mraid || {
  state: 'loading',
  placement: 'interstitial',

  getVersion: function() { return '2.0'; },
  getState: function() { return this.state; },
  getPlacementType: function() { return this.placement; },

  addEventListener: function(event, callback) {
    window.addEventListener('mraid_' + event, callback);
  },

  removeEventListener: function(event, callback) {
    window.removeEventListener('mraid_' + event, callback);
  },

  open: function(url) {
    var target = url || window.clickTag || window.storeUrl || '';
    // Unity 要求先发送点击事件
    this.fireEvent('click');
    window.location.href = target;
  },

  close: function() {
    this.fireEvent('close');
  },

  fireEvent: function(eventName) {
    var event = new Event('mraid_' + eventName);
    window.dispatchEvent(event);
  }
};

window.addEventListener('load', function() {
  window.mraid.state = 'default';
  window.mraid.fireEvent('ready');
});
</script>
`,

  /**
   * AppLovin MAX
   * 官方文档: https://dash.applovin.com/documentation/mediation/html5/getting-started
   */
  applovin: `
<!-- AppLovin MAX Playable SDK -->
<script>
// AppLovin MRAID 实现
window.mraid = window.mraid || {
  state: 'loading',
  isViewable: true,

  getState: function() { return this.state; },
  getVersion: function() { return '3.0'; },
  isViewable: function() { return this.isViewable; },

  addEventListener: function(event, handler) {
    document.addEventListener('mraid_' + event, handler);
  },

  removeEventListener: function(event, handler) {
    document.removeEventListener('mraid_' + event, handler);
  },

  open: function(url) {
    var target = url || window.clickTag || '';
    // 通知 AppLovin SDK
    if (window.AppLovinPlayable && window.AppLovinPlayable.open) {
      window.AppLovinPlayable.open(target);
    } else {
      window.location.href = target;
    }
  },

  useCustomClose: function(useCustom) {
    // AppLovin 支持自定义关闭按钮
  },

  close: function() {
    if (window.AppLovinPlayable && window.AppLovinPlayable.close) {
      window.AppLovinPlayable.close();
    }
  },

  triggerEvent: function(event) {
    var evt = new Event('mraid_' + event);
    document.dispatchEvent(evt);
  }
};

window.addEventListener('load', function() {
  window.mraid.state = 'default';
  window.mraid.triggerEvent('ready');
  window.mraid.triggerEvent('viewableChange');
});
</script>
`,

  /**
   * ironSource
   * 官方文档: https://developers.is.com/ironsource-mobile/general/playable-ads/
   */
  ironsource: `
<!-- ironSource Playable Ad SDK -->
<script>
// ironSource MRAID 2.0
window.mraid = window.mraid || {
  state: 'loading',
  _listeners: {},

  getVersion: function() { return '2.0'; },
  getState: function() { return this.state; },

  addEventListener: function(event, listener) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(listener);
  },

  removeEventListener: function(event, listener) {
    if (this._listeners[event]) {
      var index = this._listeners[event].indexOf(listener);
      if (index !== -1) {
        this._listeners[event].splice(index, 1);
      }
    }
  },

  _fireEvent: function(event, args) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(function(listener) {
        listener.apply(null, args || []);
      });
    }
  },

  open: function(url) {
    var target = url || window.clickTag || window.clickUrl || '';
    this._fireEvent('click');
    window.location.href = target;
  },

  close: function() {
    this._fireEvent('close');
    if (window.parent !== window) {
      window.parent.postMessage({ action: 'close' }, '*');
    }
  }
};

window.addEventListener('load', function() {
  window.mraid.state = 'default';
  window.mraid._fireEvent('ready');
});
</script>
`,

  /**
   * Kwai (快手)
   * 官方文档: 快手广告平台 Playable Ads 规范
   */
  kwai: `
<!-- Kwai Playable Ad SDK -->
<script>
// 快手 Playable 要求使用特定的通信协议
window.KwaiPlayable = {
  ready: function() {
    this.postMessage('ready');
  },

  download: function() {
    this.postMessage('download');
    var url = window.clickTag || window.downloadUrl || '';
    if (url) {
      window.location.href = url;
    }
  },

  track: function(eventName, params) {
    this.postMessage('track', {
      event: eventName,
      params: params || {}
    });
  },

  postMessage: function(action, data) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'kwai_playable',
        action: action,
        data: data || {}
      }, '*');
    }
  }
};

// 点击下载
window.kwaiDownload = function() {
  window.KwaiPlayable.download();
};

window.addEventListener('load', function() {
  setTimeout(function() {
    window.KwaiPlayable.ready();
  }, 100);
});
</script>
`,

  /**
   * Vungle
   * 官方文档: https://support.vungle.com/hc/en-us/articles/360002922871
   */
  vungle: `
<!-- Vungle Playable Ad SDK -->
<script>
// Vungle MRAID 实现
window.mraid = window.mraid || {
  version: '2.0',
  state: 'loading',

  getVersion: function() { return this.version; },
  getState: function() { return this.state; },

  addEventListener: function(event, callback) {
    window.addEventListener('vungle_' + event, callback, false);
  },

  removeEventListener: function(event, callback) {
    window.removeEventListener('vungle_' + event, callback, false);
  },

  open: function(url) {
    var target = url || window.clickTag || '';
    this.dispatchEvent('click');

    // Vungle 特定的下载处理
    if (window.VunglePlayable && window.VunglePlayable.download) {
      window.VunglePlayable.download(target);
    } else {
      window.location.href = target;
    }
  },

  close: function() {
    this.dispatchEvent('close');
  },

  dispatchEvent: function(eventName) {
    var event = new Event('vungle_' + eventName);
    window.dispatchEvent(event);
  }
};

window.addEventListener('load', function() {
  window.mraid.state = 'default';
  window.mraid.dispatchEvent('ready');
});
</script>
`,

  /**
   * Snapchat
   * 官方文档: https://businesshelp.snapchat.com/s/article/playable-ad-specs
   */
  snap: `
<!-- Snapchat Playable Ad SDK -->
<script>
// Snapchat 要求的 API
window.snapPlayable = {
  ready: function() {
    this.sendEvent('ready');
  },

  install: function() {
    this.sendEvent('install');
    var url = window.clickTag || window.installUrl || '';
    if (url) {
      window.location.href = url;
    }
  },

  track: function(eventName, data) {
    this.sendEvent('track', {
      name: eventName,
      data: data || {}
    });
  },

  sendEvent: function(type, payload) {
    // Snapchat 使用 postMessage 通信
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'snapPlayable',
        event: type,
        payload: payload || {}
      }, '*');
    }
  }
};

// 点击安装
window.snapInstall = function() {
  window.snapPlayable.install();
};

window.addEventListener('load', function() {
  setTimeout(function() {
    window.snapPlayable.ready();
  }, 100);
});
</script>
`
};
