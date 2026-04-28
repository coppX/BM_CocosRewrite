(function (global) {
  var CHANNEL = String(global.__CHANNEL__ || 'unknown');

  function getAdapter() {
    if (global.__PLAYABLE_CHANNEL_ADAPTER__) {
      return global.__PLAYABLE_CHANNEL_ADAPTER__;
    }
    if (global.__PLAYABLE_CHANNEL_ADAPTERS__ && global.__PLAYABLE_CHANNEL_ADAPTERS__[CHANNEL]) {
      return global.__PLAYABLE_CHANNEL_ADAPTERS__[CHANNEL];
    }
    return null;
  }

  function callAdapter(methodName) {
    var adapter = getAdapter();
    var args;
    if (!adapter || typeof adapter[methodName] !== 'function') {
      return undefined;
    }
    args = Array.prototype.slice.call(arguments, 1);
    try {
      return adapter[methodName].apply(adapter, args);
    } catch (error) {
      return undefined;
    }
  }

  function resolveTarget(url) {
    return url ||
      global.clickTag ||
      global.ClickTag ||
      global.__CLICK_URL__ ||
      global.downloadUrl ||
      global.installUrl ||
      global.storeUrl ||
      global.clickUrl ||
      '';
  }

  function safePostMessage(message) {
    try {
      if (global.parent && global.parent !== global) {
        global.parent.postMessage(message, '*');
        return true;
      }
    } catch (error) {}
    return false;
  }

  function openWindow(url) {
    if (!url) {
      return false;
    }
    try {
      global.open(url, '_blank');
      return true;
    } catch (error) {}
    return false;
  }

  function fallbackOpen(url) {
    var target = resolveTarget(url);
    var methods;
    var i;

    if (global.mraid && typeof global.mraid.open === 'function') {
      try {
        global.mraid.open(target);
        return true;
      } catch (error) {}
    }

    if (global.ExitApi && typeof global.ExitApi.exit === 'function') {
      try {
        if (target) {
          global.ExitApi.exit(target);
        } else {
          global.ExitApi.exit();
        }
        return true;
      } catch (error) {}
    }

    if (global.FbPlayableAd) {
      methods = ['onCTAClick', 'cta', 'click', 'open', 'openStore', 'openUrl', 'openURL'];
      for (i = 0; i < methods.length; i += 1) {
        try {
          if (typeof global.FbPlayableAd[methods[i]] === 'function') {
            global.FbPlayableAd[methods[i]](target);
            return true;
          }
        } catch (error) {}
      }
    }

    safePostMessage({ type: 'open', url: target });
    return openWindow(target);
  }

  function fallbackClose() {
    if (global.mraid && typeof global.mraid.close === 'function') {
      try {
        global.mraid.close();
        return true;
      } catch (error) {}
    }
    return safePostMessage({ type: 'close' });
  }

  function fallbackTrack(name, data) {
    var evt = String(name || '');
    var payload = data == null ? {} : data;
    var handled = false;
    var methods;
    var i;

    if (global.mraid && typeof global.mraid.trackEvent === 'function') {
      try {
        global.mraid.trackEvent(evt, payload);
        handled = true;
      } catch (error) {}
    }

    if (global.FbPlayableAd) {
      methods = ['logEvent', 'track', 'trackEvent', 'sendEvent', 'reportEvent'];
      for (i = 0; i < methods.length; i += 1) {
        try {
          if (typeof global.FbPlayableAd[methods[i]] === 'function') {
            global.FbPlayableAd[methods[i]](evt, payload);
            handled = true;
            break;
          }
        } catch (error) {}
      }
    }

    if (safePostMessage({ type: 'track', event: evt, data: payload })) {
      handled = true;
    }

    if (!global.__PLAYABLE_SILENT_LOG__) {
      try {
        console.log('[PlayableSDK.track]', evt, payload);
      } catch (error) {}
    }

    return handled;
  }

  function tryMraidReady(callback) {
    var mraid = global.mraid;
    var onReady;
    if (!mraid || typeof callback !== 'function') {
      return;
    }
    try {
      if (typeof mraid.getState === 'function' && mraid.getState() === 'loading' && typeof mraid.addEventListener === 'function') {
        onReady = function () {
          try {
            if (typeof mraid.removeEventListener === 'function') {
              mraid.removeEventListener('ready', onReady);
            }
          } catch (error) {}
          callback();
        };
        mraid.addEventListener('ready', onReady);
        return;
      }
    } catch (error) {}
    callback();
  }

  var PlayableSDK = {
    channel: CHANNEL,
    isReady: false,

    ready: function () {
      if (this.isReady) {
        return true;
      }
      tryMraidReady(function () {
        if (PlayableSDK.isReady) {
          return;
        }
        callAdapter('ready');
        PlayableSDK.isReady = true;
      });
      return true;
    },

    open: function (url) {
      var target = resolveTarget(url);
      var handled = callAdapter('open', target);
      if (handled) {
        return true;
      }
      return fallbackOpen(target);
    },

    close: function () {
      var handled = callAdapter('close');
      if (handled) {
        return true;
      }
      return fallbackClose();
    },

    track: function (name, data) {
      var evt = String(name || '');
      var payload = data == null ? {} : data;
      var handled = callAdapter('track', evt, payload);
      if (handled) {
        if (!global.__PLAYABLE_SILENT_LOG__) {
          try {
            console.log('[PlayableSDK.track]', evt, payload);
          } catch (error) {}
        }
        return true;
      }
      return fallbackTrack(evt, payload);
    },

    setMuted: function (muted) {
      var nextMuted = !!muted;
      var handled;
      global.__PLAYABLE_MUTED__ = nextMuted;
      handled = callAdapter('setMuted', nextMuted);
      if (handled) {
        return true;
      }
      return this.track(nextMuted ? 'mute' : 'unmute');
    }
  };

  global.PlayableSDK = PlayableSDK;

  if (global.__PLAYABLE_READY_PENDING__) {
    try {
      delete global.__PLAYABLE_READY_PENDING__;
    } catch (error) {
      global.__PLAYABLE_READY_PENDING__ = false;
    }
    setTimeout(function () {
      PlayableSDK.ready();
    }, 0);
  }
})(window);
