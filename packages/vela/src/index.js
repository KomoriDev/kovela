import { deviceFingerprint, verifyLicense } from "@kovela/license";

// One isolated authorization state machine per application instance.
export function createActivation(
  PRODUCT_ID,
  publicKey,
  { device, storage, interconnect },
) {
  const STORAGE_KEY = "kovela_license_v1";
  const DEVICE_KEY = "kovela_device_v1";
  const listeners = [];
  let connection = null;
  let epoch = 0;
  let loading = false;
  let saving = false;
  let ready = false;
  let activated = false;
  let licensed = false;
  let deviceId = "";
  let deviceModel = "";
  let connected = false;
  let linking = false;
  let licenseId = "";
  let error = "";

  function snapshot() {
    return {
      ready,
      activated,
      // 本机存有授权串（未必已通过校验）。设备标识读得慢时，界面先据此
      // 显示已授权，等 ready 有结果再以 activated 为准。
      licensed,
      deviceId,
      connected,
      linking,
      licenseId,
      error,
      saving,
    };
  }

  function publish() {
    const state = snapshot();
    listeners.slice().forEach(function (listener) {
      listener(state);
    });
  }

  // 设备指纹缓存：只记「上次通过真实设备标识验证通过」这一事实，让下次
  // 启动不用陪 device.getDeviceId 等全程。写失败无所谓，大不了走慢路径。
  function writeDeviceCache(value) {
    try {
      storage.set({
        key: DEVICE_KEY,
        value,
        success: function () {},
        fail: function () {},
      });
    } catch (failure) {
      // 缓存只是加速：写不进去就下次继续走慢路径。
    }
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
  // 机型名只出现在发给 AstroBox 插件的回执里，不参与授权判定，
  // 因此单独异步取，不让它拖慢 ready。
  function readModel(generation) {
    if (typeof device.getInfo !== "function") return;
    try {
      device.getInfo({
        success(info) {
          if (generation !== epoch || !info) return;
          rememberModel(info);
        },
        // 读不到机型就回空，回执里会退化成 AstroBox 的连接名。
        fail: function () {},
      });
    } catch (failure) {
      // 同步抛错同样当作读不到机型。
      deviceModel = "";
    }
  }
  function load() {
    // 未激活时允许重复校验：激活可能发生在别的页面上下文（Vela 快应用
    // 每页独立 JS 上下文，模块实例互不相通），落盘后要靠重读才能发现。
    if (loading || saving || (ready && activated)) return;
    loading = true;
    error = "";
    const generation = epoch;
    if (!/^[a-f0-9]{64}$/i.test(publicKey)) {
      loading = false;
      error = "授权公钥未配置，请联系开发者";
      publish();
      return;
    }
    // 授权串、设备指纹缓存与真实设备标识互不依赖，并行发起。存储是本地
    // 读取，很快；device.getDeviceId 要走系统服务，在真机上可能整秒才回，
    // 是整条链路里最慢的一步。
    let token = "";
    let cachedDevice = "";
    // 两个存储键（授权串 + 设备指纹缓存）都已返回的计数。
    let stored = 0;
    let identified = false;
    let concluded = false;
    // 快路径：缓存里记着上次通过真实设备标识验证时的指纹。存储一回来
    // 就用缓存指纹验签出结论，不让界面陪系统服务等全程；真实标识随后
    // 到达时再做复核（confirmRealDevice）。
    function concludeFromCache() {
      if (concluded || stored < 2 || !token || !cachedDevice) return;
      const payload = verifyLicense(token, publicKey, PRODUCT_ID, cachedDevice);
      if (!payload) return;
      concluded = true;
      deviceId = cachedDevice;
      activated = true;
      licenseId = payload.licenseId;
      loading = false;
      ready = true;
      publish();
    }
    // 慢路径：没有缓存（首次激活、缓存缺失或与授权串对不上）时，等真实
    // 设备标识一起回来再下结论。
    function finish() {
      if (concluded || generation !== epoch || !identified || stored < 2) return;
      concluded = true;
      const payload = token
        ? verifyLicense(token, publicKey, PRODUCT_ID, deviceId)
        : null;
      activated = !!payload;
      licenseId = payload ? payload.licenseId : "";
      if (token && !payload) {
        error = "本地授权无效，请通过 AstroBox 重新激活";
        // 缓存与授权串对不上号时清掉，避免下次启动再被带偏。
        writeDeviceCache("");
      } else if (payload) {
        // 记下通过真实验证的指纹，下次启动走快路径。
        writeDeviceCache(deviceId);
      }
      loading = false;
      ready = true;
      publish();
    }
    // 快路径结论之后拿真实指纹复核：缓存可能被改，或授权串连同缓存
    // 被整台搬自别的设备。授权确实属于本机就修复缓存；不属于就撤销。
    function confirmRealDevice(real) {
      if (generation !== epoch) return;
      if (real === deviceId) return;
      const payload = verifyLicense(token, publicKey, PRODUCT_ID, real);
      deviceId = real;
      if (payload) {
        writeDeviceCache(real);
      } else {
        activated = false;
        licenseId = "";
        error = "本地授权无效，请通过 AstroBox 重新激活";
        writeDeviceCache("");
      }
      publish();
    }
    readModel(generation);
    function readLicense(value) {
      stored += 1;
      token = value;
      // 本机存有授权串（未必已通过校验）。界面先据此显示已授权，
      // 等 ready 有结果再以 activated 为准。
      licensed = !!value;
      publish();
      concludeFromCache();
      finish();
    }
    function readCache(value) {
      stored += 1;
      cachedDevice = value;
      concludeFromCache();
      finish();
    }
    try {
      storage.get({
        key: STORAGE_KEY,
        default: "",
        success(value) {
          if (generation !== epoch) return;
          readLicense(typeof value === "string" ? value : "");
        },
        fail() {
          if (generation === epoch) finishError("无法读取授权，请重试");
        },
      });
    } catch (failure) {
      finishError("无法读取授权，请重试");
    }
    try {
      storage.get({
        key: DEVICE_KEY,
        default: "",
        success(value) {
          if (generation !== epoch) return;
          readCache(typeof value === "string" ? value : "");
        },
        // 缓存读不到只影响速度，不当失败处理。
        fail() {
          if (generation === epoch) readCache("");
        },
      });
    } catch (failure) {
      readCache("");
    }
    try {
      device.getDeviceId({
        success(info) {
          if (generation !== epoch) return;
          let real = "";
          try {
            real = deviceFingerprint(info.deviceId, PRODUCT_ID);
          } catch (failure) {
            // 快路径已出结论时读不出真实指纹：维持结论，等下轮再核。
            if (!concluded)
              finishError("无法读取设备标识，请授予设备信息权限");
            return;
          }
          identified = true;
          if (concluded) {
            confirmRealDevice(real);
            return;
          }
          deviceId = real;
          finish();
        },
        fail() {
          // 快路径结论在先时，读不到真实标识不推翻已有结论。
          if (generation === epoch && !concluded)
            finishError("无法读取设备标识，请授予设备信息权限");
        },
      });
    } catch (failure) {
      if (!concluded) finishError("设备信息接口不可用");
    }
    function finishError(message) {
      if (generation !== epoch || concluded) return;
      concluded = true;
      loading = false;
      activated = false;
      licenseId = "";
      error = message;
      // ready 表示本轮校验已出结果（通过或失败）。失败也置位，界面才能
      // 区分「还在读」和「确定未授权」，否则一直停在等待态。
      ready = true;
      publish();
    }
  }

  // 官方 interconnect 契约（iot.mi.com/vela/quickapp features/network/interconnect）：
  // connect.send 的 data 参数必须是对象（data: { str: 'test', num: 123 }）。
  // 传字符串会触发固件的参数校验失败——通用错误码 202“参数错误，调用时未
  // 按照 api 定义进行正确的传参”。对象由固件序列化传输，插件侧解包。
  //
  // patient 模式用于回应 install-license 的回执：紧跟插件下行消息或稍作
  // 退避后重试（插件侧 12s 一轮的安装包重发是兜底恢复路径）；其余发送
  // （如 device 回复，插件有 2s×10 的 hello 重发兜底）立即发送 + 少量快重试。
  function send(payload, patient) {
    if (!connection) return;
    const attempts = patient ? 5 : 3;
    const spacing = patient ? 2000 : 300;
    let attempt = 0;
    function deliver() {
      try {
        connection.send({
          data: payload,
          success: function () {},
          fail(data2, code) {
            if (attempt < attempts) {
              attempt += 1;
              setTimeout(deliver, spacing);
              return;
            }
            connected = false;
            error =
              "回执发送失败" +
              (code === undefined ? "" : "（" + code + "）") +
              "，请在 AstroBox 重试";
            publish();
          },
        });
      } catch (failure) {
        if (attempt < attempts) {
          attempt += 1;
          setTimeout(deliver, spacing);
          return;
        }
        connected = false;
        publish();
      }
    }
    deliver();
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
        typeof value.id !== "string"
      )
        return;
      if (
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
        linking = true;
        publish();
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
      // 插件超时重发的安装包：同一许可证此前已验签并落盘，直接在
      // receive 里同步回执，免去落盘回调路径的等待。
      if (activated && licenseId === value.licenseId) {
        send(Object.assign(result, { success: true }));
        return;
      }
      // 设备标识都没读到时无法验签，让插件继续按轮次重发，而不是回
      // INVALID_LICENSE 把它带进「许可证不匹配」的结论。
      if (!ready || saving || !deviceId) {
        send(Object.assign(result, { error: "NOT_READY" }), true);
        return;
      }
      const payload = verifyLicense(
        value.licenseToken,
        publicKey,
        PRODUCT_ID,
        deviceId,
      );
      if (!payload || payload.licenseId !== value.licenseId) {
        linking = false;
        error = "授权验证失败，设备或许可证不匹配";
        publish();
        send(Object.assign(result, { error: "INVALID_LICENSE" }), true);
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
            linking = false;
            licenseId = value.licenseId;
            // 这里的 deviceId 就是刚通过验签的真实指纹，一并落盘，
            // 下次启动即可走快路径。
            writeDeviceCache(deviceId);
            publish();
            send(Object.assign(result, { success: true }), true);
          },
          fail() {
            if (generation !== epoch) return;
            saving = false;
            linking = false;
            error = "授权未能保存，请重试";
            publish();
            send(Object.assign(result, { error: "STORAGE_FAILED" }), true);
          },
        });
      } catch (failure) {
        saving = false;
        linking = false;
        error = "授权未能保存，请重试";
        publish();
        send(Object.assign(result, { error: "STORAGE_FAILED" }), true);
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
          linking = false;
          publish();
        };
        connection.onerror = function () {
          connected = false;
          linking = false;
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
  // 游戏页只关心本地授权状态：重新校验存储，但不调用 connect()——
  // interconnect.instance() 是单例且 onmessage 全局唯一，谁后挂载谁收
  // 消息，激活页必须保有它才能收到插件下发的安装包。
  function refresh() {
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
    licensed = false;
    connected = false;
    linking = false;
    licenseId = "";
    deviceId = "";
    listeners.splice(0);
  }
  return { start, retry, refresh, subscribe, snapshot, isActivated, dispose };
}
