function createSnippet(label, body, extraTags = '') {
  const normalizedExtraTags = extraTags ? `${extraTags}\n` : '';
  return `
<!-- ${label} -->
${normalizedExtraTags}
<script>
(function () {
  function resolveTarget(url) {
    return url ||
      window.clickTag ||
      window.ClickTag ||
      window.__CLICK_URL__ ||
      window.downloadUrl ||
      window.installUrl ||
      window.storeUrl ||
      window.clickUrl ||
      '';
  }

  function postToParent(message) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        return true;
      }
    } catch (error) {}
    return false;
  }

  function navigateTo(url) {
    if (!url) {
      return false;
    }
    try {
      window.location.href = url;
      return true;
    } catch (error) {}
    try {
      window.open(url, '_blank');
      return true;
    } catch (error) {}
    return false;
  }

  function requestPlayableReady() {
    if (window.PlayableSDK && typeof window.PlayableSDK.ready === 'function') {
      window.PlayableSDK.ready();
    } else {
      window.__PLAYABLE_READY_PENDING__ = true;
    }
  }
${body}
})();
</script>
`;
}

module.exports = {
  facebook: createSnippet('Facebook Playable Ad SDK', `
  var readySent = false;

  window.FbPlayableAd = window.FbPlayableAd || {};
  if (typeof window.FbPlayableAd.onCTAClick !== 'function') {
    window.FbPlayableAd.onCTAClick = function (url) {
      return navigateTo(resolveTarget(url) || 'https://www.facebook.com/gaming');
    };
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'facebook',
    ready: function () {
      readySent = true;
      return true;
    },
    open: function (url) {
      window.FbPlayableAd.onCTAClick(resolveTarget(url));
      return true;
    },
    track: function (eventName, params) {
      var methods = ['logEvent', 'track', 'trackEvent', 'sendEvent', 'reportEvent'];
      var payload = params || {};
      var i;
      for (i = 0; i < methods.length; i += 1) {
        if (typeof window.FbPlayableAd[methods[i]] === 'function') {
          window.FbPlayableAd[methods[i]](eventName, payload);
          return true;
        }
      }
      return false;
    }
  };

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!readySent) {
        requestPlayableReady();
      }
    }, 100);
  });
`),

  google: createSnippet('Google Playable Ad SDK', `
  var readySent = false;

  function notifyReady() {
    if (readySent) {
      return true;
    }
    readySent = true;
    return postToParent({ type: 'adReady' });
  }

  window.ExitApi = window.ExitApi || {
    exit: function (url) {
      var target = resolveTarget(url) || window.location.href;
      postToParent({
        type: 'adExitClick',
        url: target
      });

      if (window.parent !== window) {
        try {
          window.parent.location = target;
          return;
        } catch (error) {}
      }

      navigateTo(target);
    }
  };

  window.dapi = window.dapi || {
    isReady: function () { return true; },
    addEventListener: function (event, callback) {
      if (event === 'ready' && callback) {
        setTimeout(callback, 100);
      }
    },
    removeEventListener: function () {},
    getScreenSize: function () {
      return {
        width: window.innerWidth || 375,
        height: window.innerHeight || 667
      };
    }
  };

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'google',
    ready: notifyReady,
    open: function (url) {
      window.ExitApi.exit(resolveTarget(url));
      return true;
    }
  };

  window.addEventListener('load', function () {
    setTimeout(notifyReady, 100);
  });
`),

  tiktok: createSnippet('TikTok/Pangle Playable Ad SDK', `
  var readySent = false;
  var tiktokPreviewTarget = '';

  if (typeof window.openAppStore !== 'function') {
    window.openAppStore = function () {
      var target = tiktokPreviewTarget || resolveTarget();
      window.TikTokPlayableSDK.download();
      return navigateTo(target);
    };
  }

  window.TikTokPlayableSDK = window.TikTokPlayableSDK || {
    ready: function () {
      return this.sendMessage('playableReady');
    },
    download: function () {
      return this.sendMessage('download');
    },
    sendMessage: function (action, data) {
      return postToParent({
        type: 'playable',
        action: action,
        data: data || {}
      });
    },
    track: function (eventName, params) {
      return this.sendMessage('track', {
        event: eventName,
        params: params || {}
      });
    }
  };

  function triggerTikTokInstall() {
    var candidates = [
      function () {
        if (typeof window.openAppStore === 'function') {
          return window.openAppStore();
        }
        return false;
      },
      function () {
        if (window.playableSDK && typeof window.playableSDK.openAppStore === 'function') {
          return window.playableSDK.openAppStore();
        }
        return false;
      },
      function () {
        if (window.TikTokPlayableSDK && typeof window.TikTokPlayableSDK.download === 'function') {
          return window.TikTokPlayableSDK.download();
        }
        return false;
      }
    ];
    var i;
    for (i = 0; i < candidates.length; i += 1) {
      try {
        if (candidates[i]()) {
          return true;
        }
      } catch (error) {}
    }
    return true;
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'tiktok',
    ready: function () {
      if (readySent) {
        return true;
      }
      readySent = true;
      return window.TikTokPlayableSDK.ready();
    },
    open: function (url) {
      tiktokPreviewTarget = resolveTarget(url);
      return triggerTikTokInstall();
    },
    close: function () {
      return window.TikTokPlayableSDK.sendMessage('close');
    },
    track: function (eventName, params) {
      return window.TikTokPlayableSDK.track(eventName, params || {});
    }
  };

  window.clickPlayableDownloadButton = function () {
    return window.__PLAYABLE_CHANNEL_ADAPTER__.open();
  };

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!readySent) {
        window.__PLAYABLE_CHANNEL_ADAPTER__.ready();
      }
    }, 100);
  });
`, `<script src="https://sf16-sg.tiktokcdn.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"></script>`),

  mintegral: createSnippet('Mintegral Playable Ad SDK', `
  var readySent = false;

  window.mraid = window.mraid || {
    state: 'loading',
    listeners: {},

    addEventListener: function (event, listener) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(listener);
    },

    removeEventListener: function (event, listener) {
      var idx;
      if (!this.listeners[event]) {
        return;
      }
      idx = this.listeners[event].indexOf(listener);
      if (idx > -1) {
        this.listeners[event].splice(idx, 1);
      }
    },

    fireEvent: function (event, data) {
      var callbacks = this.listeners[event] || [];
      var i;
      for (i = 0; i < callbacks.length; i += 1) {
        callbacks[i](data);
      }
    },

    getState: function () {
      return this.state;
    },

    open: function (url) {
      return navigateTo(resolveTarget(url));
    },

    close: function () {
      return postToParent({ type: 'close' });
    }
  };

  function signalReady() {
    if (readySent) {
      return true;
    }
    readySent = true;
    try {
      window.mraid.state = 'default';
    } catch (error) {}
    if (typeof window.mraid.fireEvent === 'function') {
      window.mraid.fireEvent('ready');
    }
    return true;
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'mintegral',
    ready: signalReady,
    open: function (url) {
      if (window.mraid && typeof window.mraid.open === 'function') {
        window.mraid.open(resolveTarget(url));
        return true;
      }
      return navigateTo(resolveTarget(url));
    },
    close: function () {
      if (window.mraid && typeof window.mraid.close === 'function') {
        window.mraid.close();
        return true;
      }
      return postToParent({ type: 'close' });
    }
  };

  window.addEventListener('load', function () {
    setTimeout(signalReady, 100);
  });
`),

  unityads: createSnippet('Unity Ads Playable SDK', `
  var readySent = false;
  var startResolved = false;
  var startResolver = function () {};
  var unityMraid = window.mraid = window.mraid || {};

  window.__PLAYABLE_START_GATE__ = new Promise(function (resolve) {
    startResolver = function () {
      if (startResolved) {
        return true;
      }
      startResolved = true;
      resolve(true);
      return true;
    };
  });

  unityMraid.state = unityMraid.state || 'loading';
  unityMraid.placement = unityMraid.placement || 'interstitial';
  unityMraid._listeners = unityMraid._listeners || {};
  unityMraid._isViewable = !!unityMraid._isViewable;

  if (typeof unityMraid.getVersion !== 'function') {
    unityMraid.getVersion = function () { return '2.0'; };
  }
  if (typeof unityMraid.getState !== 'function') {
    unityMraid.getState = function () { return this.state; };
  }
  if (typeof unityMraid.getPlacementType !== 'function') {
    unityMraid.getPlacementType = function () { return this.placement; };
  }
  if (typeof unityMraid.isViewable !== 'function') {
    unityMraid.isViewable = function () { return !!this._isViewable; };
  }
  unityMraid.addEventListener = function (event, callback) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(callback);
  };
  unityMraid.removeEventListener = function (event, callback) {
    var listeners = this._listeners[event] || [];
    var index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
  unityMraid.open = function (url) {
    var target = resolveTarget(url);
    this.fireEvent('click');
    return navigateTo(target);
  };
  unityMraid.close = function () {
    this.fireEvent('close');
    return true;
  };
  unityMraid.fireEvent = function (eventName, detail) {
    var listeners = this._listeners[eventName] || [];
    var i;
    var event;
    for (i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i](detail);
      } catch (error) {}
    }
    try {
      event = new CustomEvent('mraid_' + eventName, { detail: detail });
    } catch (error) {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent('mraid_' + eventName, false, false, detail);
    }
    window.dispatchEvent(event);
  };
  unityMraid.setViewable = function (viewable) {
    this._isViewable = !!viewable;
    this.fireEvent('viewableChange', this._isViewable);
    if (this._isViewable) {
      startResolver();
    }
    return this._isViewable;
  };

  function signalReady() {
    if (readySent) {
      return true;
    }
    readySent = true;
    try {
      unityMraid.state = 'default';
    } catch (error) {}
    if (typeof unityMraid.fireEvent === 'function') {
      unityMraid.fireEvent('ready');
    }
    return true;
  }

  function armUnityStartGate() {
    if (typeof unityMraid.isViewable === 'function' && unityMraid.isViewable()) {
      startResolver();
      return true;
    }
    if (typeof unityMraid.addEventListener === 'function') {
      var onViewable = function (isViewable) {
        if (isViewable) {
          try {
            unityMraid.removeEventListener('viewableChange', onViewable);
          } catch (error) {}
          startResolver();
        }
      };
      unityMraid.addEventListener('viewableChange', onViewable);
      return true;
    }
    return startResolver();
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'unityads',
    ready: signalReady,
    open: function (url) {
      if (unityMraid && typeof unityMraid.open === 'function') {
        unityMraid.open(resolveTarget(url));
        return true;
      }
      return navigateTo(resolveTarget(url));
    },
    close: function () {
      if (unityMraid && typeof unityMraid.close === 'function') {
        unityMraid.close();
        return true;
      }
      return false;
    }
  };

  window.addEventListener('load', function () {
    signalReady();
    armUnityStartGate();
    setTimeout(function () {
      if (typeof unityMraid.setViewable === 'function' && !unityMraid.isViewable()) {
        unityMraid.setViewable(true);
      } else {
        startResolver();
      }
    }, 100);
  });
`),

  applovin: createSnippet('AppLovin MAX Playable SDK', `
  var readySent = false;

  window.mraid = window.mraid || {
    state: 'loading',
    _isViewable: true,

    getState: function () { return this.state; },
    getVersion: function () { return '3.0'; },
    isViewable: function () { return this._isViewable; },

    addEventListener: function (event, handler) {
      document.addEventListener('mraid_' + event, handler);
    },

    removeEventListener: function (event, handler) {
      document.removeEventListener('mraid_' + event, handler);
    },

    open: function (url) {
      var target = resolveTarget(url);
      if (window.AppLovinPlayable && typeof window.AppLovinPlayable.open === 'function') {
        window.AppLovinPlayable.open(target);
        return true;
      }
      return navigateTo(target);
    },

    useCustomClose: function () {},

    close: function () {
      if (window.AppLovinPlayable && typeof window.AppLovinPlayable.close === 'function') {
        window.AppLovinPlayable.close();
        return true;
      }
      return false;
    },

    triggerEvent: function (eventName) {
      var event = new Event('mraid_' + eventName);
      document.dispatchEvent(event);
    }
  };

  function signalReady() {
    if (readySent) {
      return true;
    }
    readySent = true;
    try {
      window.mraid.state = 'default';
    } catch (error) {}
    if (typeof window.mraid.triggerEvent === 'function') {
      window.mraid.triggerEvent('ready');
      window.mraid.triggerEvent('viewableChange');
    }
    return true;
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'applovin',
    ready: signalReady,
    open: function (url) {
      if (window.mraid && typeof window.mraid.open === 'function') {
        window.mraid.open(resolveTarget(url));
        return true;
      }
      return navigateTo(resolveTarget(url));
    },
    close: function () {
      if (window.mraid && typeof window.mraid.close === 'function') {
        return !!window.mraid.close();
      }
      return false;
    }
  };

  window.addEventListener('load', function () {
    signalReady();
  });
`),

  ironsource: createSnippet('ironSource Playable Ad SDK', `
  var readySent = false;

  window.mraid = window.mraid || {
    state: 'loading',
    _listeners: {},

    getVersion: function () { return '2.0'; },
    getState: function () { return this.state; },

    addEventListener: function (event, listener) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(listener);
    },

    removeEventListener: function (event, listener) {
      var listeners = this._listeners[event];
      var index;
      if (!listeners) {
        return;
      }
      index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    },

    _fireEvent: function (event, args) {
      var listeners = this._listeners[event] || [];
      var payload = args || [];
      var i;
      for (i = 0; i < listeners.length; i += 1) {
        listeners[i].apply(null, payload);
      }
    },

    open: function (url) {
      var target = resolveTarget(url);
      this._fireEvent('click');
      return navigateTo(target);
    },

    close: function () {
      this._fireEvent('close');
      return postToParent({ action: 'close' });
    }
  };

  function signalReady() {
    if (readySent) {
      return true;
    }
    readySent = true;
    try {
      window.mraid.state = 'default';
    } catch (error) {}
    if (typeof window.mraid._fireEvent === 'function') {
      window.mraid._fireEvent('ready');
    }
    return true;
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'ironsource',
    ready: signalReady,
    open: function (url) {
      if (window.mraid && typeof window.mraid.open === 'function') {
        window.mraid.open(resolveTarget(url));
        return true;
      }
      return navigateTo(resolveTarget(url));
    },
    close: function () {
      if (window.mraid && typeof window.mraid.close === 'function') {
        window.mraid.close();
        return true;
      }
      return postToParent({ action: 'close' });
    }
  };

  window.addEventListener('load', function () {
    signalReady();
  });
`),

  kwai: createSnippet('Kwai Playable Ad SDK', `
  var readySent = false;

  window.KwaiPlayable = window.KwaiPlayable || {
    ready: function () {
      return this.postMessage('ready');
    },
    download: function () {
      return this.postMessage('download');
    },
    track: function (eventName, params) {
      return this.postMessage('track', {
        event: eventName,
        params: params || {}
      });
    },
    postMessage: function (action, data) {
      return postToParent({
        type: 'kwai_playable',
        action: action,
        data: data || {}
      });
    }
  };

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'kwai',
    ready: function () {
      if (readySent) {
        return true;
      }
      readySent = true;
      return window.KwaiPlayable.ready();
    },
    open: function (url) {
      var target = resolveTarget(url);
      window.KwaiPlayable.download();
      if (target) {
        return navigateTo(target);
      }
      return true;
    },
    close: function () {
      return window.KwaiPlayable.postMessage('close');
    },
    track: function (eventName, params) {
      return window.KwaiPlayable.track(eventName, params || {});
    }
  };

  window.kwaiDownload = function () {
    return window.__PLAYABLE_CHANNEL_ADAPTER__.open();
  };

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!readySent) {
        window.__PLAYABLE_CHANNEL_ADAPTER__.ready();
      }
    }, 100);
  });
`),

  vungle: createSnippet('Vungle Playable Ad SDK', `
  var readySent = false;

  window.VunglePlayable = window.VunglePlayable || {};
  if (typeof window.VunglePlayable.download !== 'function') {
    window.VunglePlayable.download = function (url) {
      return navigateTo(resolveTarget(url));
    };
  }

  window.mraid = window.mraid || {
    version: '2.0',
    state: 'loading',

    getVersion: function () { return this.version; },
    getState: function () { return this.state; },

    addEventListener: function (event, callback) {
      window.addEventListener('vungle_' + event, callback, false);
    },

    removeEventListener: function (event, callback) {
      window.removeEventListener('vungle_' + event, callback, false);
    },

    open: function (url) {
      var target = resolveTarget(url);
      this.dispatchEvent('click');
      if (window.VunglePlayable && typeof window.VunglePlayable.download === 'function') {
        window.VunglePlayable.download(target);
        return true;
      }
      return false;
    },

    close: function () {
      this.dispatchEvent('close');
      return true;
    },

    dispatchEvent: function (eventName) {
      var event = new Event('vungle_' + eventName);
      window.dispatchEvent(event);
    }
  };

  function signalReady() {
    if (readySent) {
      return true;
    }
    readySent = true;
    try {
      window.mraid.state = 'default';
    } catch (error) {}
    if (typeof window.mraid.dispatchEvent === 'function') {
      window.mraid.dispatchEvent('ready');
    }
    return true;
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'vungle',
    ready: signalReady,
    open: function (url) {
      if (window.mraid && typeof window.mraid.open === 'function') {
        window.mraid.open(resolveTarget(url));
        return true;
      }
      return navigateTo(resolveTarget(url));
    },
    close: function () {
      if (window.mraid && typeof window.mraid.close === 'function') {
        return !!window.mraid.close();
      }
      return false;
    }
  };

  window.addEventListener('load', function () {
    signalReady();
  });
`),

  snap: createSnippet('Snapchat Playable Ad SDK', `
  var readySent = false;
  var snapPreviewTarget = '';

  function readCssPixels(name) {
    var value = '0';
    try {
      value = getComputedStyle(document.documentElement).getPropertyValue(name) || '0';
    } catch (error) {}
    value = parseFloat(String(value).replace('px', '').trim());
    return Number.isFinite(value) ? value : 0;
  }

  function applySnapPortraitShell() {
    var design = window.__PLAYABLE_DESIGN_SIZE__ || { width: 1280, height: 720 };
    var aspect = (design.width && design.height) ? (design.width / design.height) : (16 / 9);
    var safeLeft = readCssPixels('--safe-left');
    var safeRight = readCssPixels('--safe-right');
    var safeTop = readCssPixels('--safe-top');
    var safeBottom = readCssPixels('--safe-bottom');
    var viewportWidth = Math.max(1, window.innerWidth - safeLeft - safeRight);
    var viewportHeight = Math.max(1, window.innerHeight - safeTop - safeBottom);
    var shellWidth = viewportWidth;
    var shellHeight = shellWidth / aspect;
    var gameDiv = document.getElementById('GameDiv');
    var container = document.getElementById('Cocos3dGameContainer');
    var canvas = document.getElementById('GameCanvas');

    if (!gameDiv || !container || !canvas) {
      return false;
    }

    if (shellHeight > viewportHeight) {
      shellHeight = viewportHeight;
      shellWidth = shellHeight * aspect;
    }

    window.__PLAYABLE_PORTRAIT_SHELL__ = 'snap';
    document.documentElement.setAttribute('data-playable-shell', 'snap-portrait');
    document.body.style.display = 'block';
    document.body.style.backgroundColor = '#000';
    document.body.style.overflow = 'hidden';

    gameDiv.style.position = 'absolute';
    gameDiv.style.left = '50%';
    gameDiv.style.top = '50%';
    gameDiv.style.width = Math.round(shellWidth) + 'px';
    gameDiv.style.height = Math.round(shellHeight) + 'px';
    gameDiv.style.transform = 'translate(-50%, -50%)';
    gameDiv.style.transformOrigin = 'center center';
    gameDiv.style.borderRadius = '24px';
    gameDiv.style.overflow = 'hidden';
    gameDiv.style.boxShadow = '0 18px 60px rgba(0, 0, 0, 0.35)';
    container.style.width = '100%';
    container.style.height = '100%';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    return true;
  }

  window.snapPlayable = window.snapPlayable || {
    ready: function () {
      return this.sendEvent('ready');
    },
    install: function () {
      return this.sendEvent('install');
    },
    track: function (eventName, data) {
      return this.sendEvent('track', {
        name: eventName,
        data: data || {}
      });
    },
    sendEvent: function (type, payload) {
      return postToParent({
        type: 'snapPlayable',
        event: type,
        payload: payload || {}
      });
    }
  };

  window.ScPlayableAd = window.ScPlayableAd || {};
  if (typeof window.ScPlayableAd.onCTAClick !== 'function') {
    window.ScPlayableAd.onCTAClick = function () {
      window.snapPlayable.install();
      return navigateTo(snapPreviewTarget || resolveTarget());
    };
  }

  window.__PLAYABLE_CHANNEL_ADAPTER__ = {
    channel: 'snap',
    ready: function () {
      if (readySent) {
        return true;
      }
      readySent = true;
      return window.snapPlayable.ready();
    },
    open: function (url) {
      snapPreviewTarget = resolveTarget(url);
      if (window.ScPlayableAd && typeof window.ScPlayableAd.onCTAClick === 'function') {
        window.ScPlayableAd.onCTAClick();
        return true;
      }
      return window.snapPlayable.install();
    },
    close: function () {
      return window.snapPlayable.sendEvent('close');
    },
    track: function (eventName, data) {
      return window.snapPlayable.track(eventName, data || {});
    }
  };

  window.snapInstall = function () {
    return window.__PLAYABLE_CHANNEL_ADAPTER__.open();
  };

  window.addEventListener('load', function () {
    applySnapPortraitShell();
    setTimeout(function () {
      if (!readySent) {
        window.__PLAYABLE_CHANNEL_ADAPTER__.ready();
      }
    }, 100);
  });
  window.addEventListener('resize', applySnapPortraitShell);
`)
};
