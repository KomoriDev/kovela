import { deviceFingerprint, verifyLicense } from "@kovela/license";

// One isolated authorization state machine per application instance.
export function createActivation(
  PRODUCT_ID,
  publicKey,
  { device, storage, interconnect },
) {
  const STORAGE_KEY = "kovela_license_v1";
  const listeners = [];
  let connection = null;
  let epoch = 0;
  let loading = false;
  let saving = false;
  let ready = false;
  let activated = false;
  let deviceId = "";
  let deviceModel = "";
  let connected = false;
  let error = "";

  function snapshot() {
    return { ready, activated, deviceId, connected, error, saving };
  }

  function publish() {
    const state = snapshot();
    listeners.slice().forEach(function (listener) {
      listener(state);
    });
  }

  function labelPart(value) {
    if (typeof value !== "string") return "";
    return value
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  }
  function rememberModel(info) {
    const label = [labelPart(info && info.brand), labelPart(info && info.model)]
      .filter(Boolean)
      .join(" ");
    if (label) deviceModel = label.slice(0, 80);
  }
  function readModel(generation, done) {
    if (typeof device.getInfo !== "function") return done();
    let finished = false;
    function complete(info) {
      if (finished || generation !== epoch) return;
      finished = true;
      if (info) rememberModel(info);
      done();
    }
    try {
      device.getInfo({
        success: complete,
        fail() {
          complete();
        },
      });
    } catch (failure) {
      complete();
    }
  }
  function load() {
    if (loading || saving || ready) return;
    loading = true;
    error = "";
    const generation = epoch;
    if (!/^[a-f0-9]{64}$/i.test(publicKey)) {
      loading = false;
      error = "授权公钥未配置，请联系开发者";
      publish();
      return;
    }
    try {
      device.getDeviceId({
        success(info) {
          if (generation !== epoch) return;
          try {
            deviceId = deviceFingerprint(info.deviceId, PRODUCT_ID);
          } catch (failure) {
            finishError("无法读取设备标识，请授予设备信息权限");
            return;
          }
          try {
            storage.get({
              key: STORAGE_KEY,
              default: "",
              success(token) {
                if (generation !== epoch) return;
                readModel(generation, function () {
                  if (generation !== epoch) return;
                  activated = !!verifyLicense(
                    token,
                    publicKey,
                    PRODUCT_ID,
                    deviceId,
                  );
                  if (token && !activated)
                    error = "本地授权无效，请通过 AstroBox 重新激活";
                  loading = false;
                  ready = true;
                  publish();
                });
              },
              fail() {
                if (generation === epoch) finishError("无法读取授权，请重试");
              },
            });
          } catch (failure) {
            finishError("无法读取授权，请重试");
          }
        },
        fail() {
          if (generation === epoch)
            finishError("无法读取设备标识，请授予设备信息权限");
        },
      });
    } catch (failure) {
      finishError("设备信息接口不可用");
    }
    function finishError(message) {
      if (generation !== epoch) return;
      loading = false;
      activated = false;
      error = message;
      publish();
    }
  }

  function send(payload) {
    if (!connection) return;
    try {
      connection.send({
        data: payload,
        fail() {
          connected = false;
          error = "回执发送失败，请在 AstroBox 重试";
          publish();
        },
      });
    } catch (failure) {
      connected = false;
      publish();
    }
  }

  function receive(event) {
    let value = event && event.data;
    try {
      if (typeof value === "string") {
        if (value.length > 4096) return;
        value = JSON.parse(value);
      }
      if (
        !value ||
        typeof value !== "object" ||
        value.v !== 1 ||
        typeof value.id !== "string" ||
        !/^[A-Za-z0-9_-]{16,80}$/.test(value.id)
      )
        return;
      if (value.type === "hello") {
        if (!ready) {
          load();
          return;
        }
        const reply = {
          v: 1,
          id: value.id,
          type: "device",
          productId: PRODUCT_ID,
          deviceId,
          activated,
        };
        if (deviceModel) reply.deviceModel = deviceModel;
        send(reply);
        return;
      }
      if (
        value.type !== "install-license" ||
        typeof value.licenseId !== "string" ||
        !/^[A-Za-z0-9_-]{16,80}$/.test(value.licenseId)
      )
        return;
      const result = {
        v: 1,
        id: value.id,
        type: "activation-result",
        licenseId: value.licenseId,
        deviceId,
        success: false,
      };
      if (!ready || saving) {
        send(Object.assign(result, { error: "NOT_READY" }));
        return;
      }
      const payload = verifyLicense(
        value.licenseToken,
        publicKey,
        PRODUCT_ID,
        deviceId,
      );
      if (!payload || payload.licenseId !== value.licenseId) {
        error = "授权验证失败，设备或许可证不匹配";
        publish();
        send(Object.assign(result, { error: "INVALID_LICENSE" }));
        return;
      }
      saving = true;
      error = "";
      publish();
      const generation = epoch;
      try {
        storage.set({
          key: STORAGE_KEY,
          value: value.licenseToken,
          success() {
            if (generation !== epoch) return;
            saving = false;
            activated = true;
            publish();
            send(Object.assign(result, { success: true }));
          },
          fail() {
            if (generation !== epoch) return;
            saving = false;
            error = "授权未能保存，请重试";
            publish();
            send(Object.assign(result, { error: "STORAGE_FAILED" }));
          },
        });
      } catch (failure) {
        saving = false;
        error = "授权未能保存，请重试";
        publish();
        send(Object.assign(result, { error: "STORAGE_FAILED" }));
      }
    } catch (failure) {
      // Unrecognized transport payloads are not activation commands.
      return;
    }
  }

  function connect() {
    if (!connection) {
      try {
        connection = interconnect.instance();
        connection.onmessage = receive;
        connection.onopen = function () {
          connected = true;
          publish();
        };
        connection.onclose = function () {
          connected = false;
          publish();
        };
        connection.onerror = function () {
          connected = false;
          error = "请连接 AstroBox 并打开 Kovela 插件";
          publish();
        };
      } catch (failure) {
        error = "当前设备通信不可用，请检查 AstroBox 连接";
        publish();
        return;
      }
    }
    try {
      connection.getReadyState({
        success(info) {
          connected = info.status === 1;
          publish();
        },
        fail() {
          connected = false;
          publish();
        },
      });
    } catch (failure) {
      connected = false;
      publish();
    }
  }

  function start() {
    connect();
    load();
  }
  function retry() {
    error = "";
    connect();
    load();
    publish();
  }
  function subscribe(listener) {
    listeners.push(listener);
    listener(snapshot());
    return function () {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }
  function isActivated() {
    return ready && activated;
  }
  function dispose() {
    epoch += 1;
    if (connection) {
      connection.onmessage = null;
      connection.onopen = null;
      connection.onclose = null;
      connection.onerror = null;
    }
    connection = null;
    loading = false;
    saving = false;
    ready = false;
    activated = false;
    connected = false;
    deviceId = "";
    listeners.splice(0);
  }
  return { start, retry, subscribe, snapshot, isActivated, dispose };
}
