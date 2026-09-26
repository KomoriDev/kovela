import { deviceFingerprint, verifyLicense } from "@kovela/license";

// One isolated authorization state machine per application instance.
export function createActivation(
  PRODUCT_ID,
  publicKey,
  { device, storage, interconnect },
) {
  // 授权记录：JSON {token, device}。token 为授权串，device 为激活时通过
  // 真实设备标识验证过的设备指纹。启动时只读这一条记录并纯 CPU 验签，
  // 不发起任何系统服务调用——真机上 device.getDeviceId / getInfo 与其它
  // 调用在启动窗口里并发时会把系统服务挤到约半分钟不响应，页面整个
  // 失去交互，还会连带应用退出。激活时设备绑定已确认，授权不过期，
  // 离线场景也没有服务端可撤销，日常启动没有再问系统要标识的必要。
  const LICENSE_KEY = "kovela_license_v2";
  // 旧版键只读迁移：v1 是裸授权串，device_v1 是上一版的指纹缓存。
  // 仍在使用旧激活包的设备上只有这两个键，首次读到后写入 v2。
  const LEGACY_TOKEN_KEY = "kovela_license_v1";
  const LEGACY_DEVICE_KEY = "kovela_device_v1";
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
  // 设备标识按需读取：只在激活握手与安装包需要时发起（见 ensureDeviceId）。
  let deviceIdPending = false;
  const deviceIdWaiters = [];

  function snapshot() {
    return {
      ready,
      activated,
      // 本机存有授权记录（未必已通过校验）。界面先据此显示已授权，
      // 等 ready 有结果再以 activated 为准。
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

  // 授权记录写失败无所谓：大不了下次启动按未激活处理、重新激活。后续
  // 写入通过 done 链在前一次完成之后发起——真机的存储同刻只应有一个
  // 未完成请求，并发会把先发的回调挤掉。
  function writeLicenseRecord(token, device, licenseId, done) {
    const finish = function () {
      if (typeof done === "function") done();
    };
    try {
      storage.set({
        key: LICENSE_KEY,
        // licenseId 非空表示这条记录已经通过一次 Ed25519 验签：真机验签
        // 要十几秒，正常启动只复核记录、不再重跑。
        value: JSON.stringify({
          token: token,
          device: device,
          licenseId: licenseId || "",
        }),
        success: finish,
        fail: finish,
      });
    } catch (failure) {
      finish();
    }
  }
  // 授权判定为无效时清掉所有缓存，让后续启动给出一致的未激活结论。
  function clearLicenseCaches() {
    writeLicenseRecord("", "", "", clearLegacyDeviceCache);
  }
  function clearLegacyDeviceCache() {
    try {
      storage.set({
        key: LEGACY_DEVICE_KEY,
        value: "",
        success: function () {},
        fail: function () {},
      });
    } catch (failure) {
      // 清不掉也只是下次启动多判一次无效。
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
  // 机型名只出现在发给 AstroBox 插件的回执里，不参与授权判定，因此只在
  // 插件接入（hello）时才读，绝不放进启动链路。
  function readModel() {
    if (deviceModel || typeof device.getInfo !== "function") return;
    const generation = epoch;
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
  // 设备标识按需读取：激活握手（hello 回执要带指纹）与安装包验签都要用，
  // 其余场合不碰。同一实例只发一次在途请求，完成的回调逐个放行；读失败
  // 不回调等待者（回执交给插件的重发轮次），并允许下次再试。
  function ensureDeviceId(done) {
    if (deviceId) {
      if (typeof done === "function") done();
      return;
    }
    if (typeof done === "function") deviceIdWaiters.push(done);
    if (deviceIdPending) return;
    deviceIdPending = true;
    const generation = epoch;
    function failWith(message) {
      deviceIdPending = false;
      // 等待者（当次回执）就此放弃：指纹没读到，回执交给插件重发。
      deviceIdWaiters.splice(0);
      error = message;
      publish();
    }
    try {
      device.getDeviceId({
        success(info) {
          if (generation !== epoch) return;
          deviceIdPending = false;
          let real = "";
          try {
            real = deviceFingerprint(info.deviceId, PRODUCT_ID);
          } catch (failure) {
            failWith("无法读取设备标识，请授予设备信息权限");
            return;
          }
          deviceId = real;
          flushDeviceIdWaiters();
        },
        fail() {
          if (generation === epoch)
            failWith("无法读取设备标识，请授予设备信息权限");
        },
      });
    } catch (failure) {
      deviceIdPending = false;
      failWith("设备信息接口不可用");
    }
  }
  function flushDeviceIdWaiters() {
    const waiters = deviceIdWaiters.splice(0);
    for (let i = 0; i < waiters.length; i += 1) waiters[i]();
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
      ready = true;
      publish();
      return;
    }
    // 读链路严格串行、按需发起（真机存储不支持并发请求）：先读 v2 记录，
    // 不够用再读旧授权串键，再不够才读旧缓存键。任何一步都能得出结论，
    // 全程只碰存储、不碰设备服务。
    let token = "";
    let cachedDevice = "";
    let concluded = false;
    // 看门狗：读链里任何一个回调丢失（真机固件对某些调用形态可能既不回
    // success 也不回 fail），界面不能永久卡在等待。超时按失败结论收场，
    // loading 释放，refresh() 才有机会重试；激活页会把超时错误显示出来。
    const watchdog = setTimeout(function () {
      if (concluded || generation !== epoch) return;
      concluded = true;
      loading = false;
      activated = false;
      licenseId = "";
      error = "授权读取超时，请重试";
      ready = true;
      publish();
    }, 8000);
    function conclude(payload, fingerprint) {
      if (concluded || generation !== epoch) return;
      concluded = true;
      clearTimeout(watchdog);
      deviceId = fingerprint;
      activated = !!payload;
      licenseId = payload ? payload.licenseId : "";
      loading = false;
      ready = true;
      publish();
    }
    function adoptToken(value, cached, licenseId, migrate) {
      if (generation !== epoch) return;
      token = value;
      cachedDevice = typeof cached === "string" ? cached : "";
      // 本机存有授权记录。界面先据此显示已授权，等 ready 有结果再以
      // activated 为准。
      licensed = !!token;
      publish();
      if (!token) {
        conclude(null, "");
        return;
      }
      if (!cachedDevice) {
        // 有授权串但缺配对指纹（更早版本只写授权串）：本地无法确认，
        // 重新激活一次即可补全，激活会重写配对记录。
        error = "本地授权无效，请通过 AstroBox 重新激活";
        clearLicenseCaches();
        conclude(null, "");
        return;
      }
      // 本机记录即结论：写入这条记录的只有"激活时验签通过"和"旧版
      // 迁移"两条路径，所以启动不再重跑签名校验。真机教训：这台引擎上
      // Ed25519 验签一次要十几秒（Node 参照 19ms），放在启动链路上就是
      // 一次可见的冻结。签名校验留在激活握手那一次（见 receive）。
      conclude({ licenseId: licenseId }, cachedDevice);
      // 旧版键读出来的配对顺手写成 v2，下次启动只读一次。
      if (migrate) writeLicenseRecord(token, cachedDevice, licenseId, null);
    }
    function parseRecord(value) {
      try {
        const record = JSON.parse(value);
        if (
          record &&
          typeof record.token === "string" &&
          typeof record.device === "string"
        )
          return record;
      } catch (failure) {
        // 不是 JSON 就当作没有记录。
      }
      return { token: "", device: "", licenseId: "" };
    }
    function readLicenseRecord() {
      try {
        storage.get({
          key: LICENSE_KEY,
          // default 非必填（文档：键缺失时返回空串），带上只是与最初在
          // 真机验证过的调用形态保持一致，不承担正确性。
          default: "",
          success(value) {
            if (generation !== epoch) return;
            const record = parseRecord(typeof value === "string" ? value : "");
            if (record.token) {
              // v2 里有授权串就直接用（旧键内容相同，不再多读一次）。
              adoptToken(
                record.token,
                record.device,
                typeof record.licenseId === "string" ? record.licenseId : "",
              );
            } else {
              readLegacyToken();
            }
          },
          fail() {
            if (generation === epoch) readLegacyToken();
          },
        });
      } catch (failure) {
        readLegacyToken();
      }
    }
    function readLegacyToken() {
      try {
        storage.get({
          key: LEGACY_TOKEN_KEY,
          default: "",
          success(value) {
            if (generation !== epoch) return;
            if (typeof value === "string" && value) readLegacyDevice(value);
            else adoptToken("", "", "");
          },
          fail() {
            if (generation === epoch) adoptToken("", "", "");
          },
        });
      } catch (failure) {
        adoptToken("", "", "");
      }
    }
    function readLegacyDevice(legacyToken) {
      try {
        storage.get({
          key: LEGACY_DEVICE_KEY,
          default: "",
          success(value) {
            if (generation !== epoch) return;
            adoptToken(
              legacyToken,
              typeof value === "string" ? value : "",
              "",
              true,
            );
          },
          fail() {
            if (generation === epoch) adoptToken(legacyToken, "", "", true);
          },
        });
      } catch (failure) {
        adoptToken(legacyToken, "", "", true);
      }
    }
    readLicenseRecord();
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
      // 能收到合法报文就证明对端在场：不依赖状态查询也能把提示修正好。
      if (!connected) {
        connected = true;
        publish();
      }
      if (value.type === "hello") {
        if (!ready) {
          load();
          return;
        }
        linking = true;
        publish();
        replyDevice(value.id);
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
      // 设备标识还没读到时无法验签：先按需发起读取，让插件按轮次重发，
      // 而不是回 INVALID_LICENSE 把它带进「许可证不匹配」的结论。
      if (!ready || saving || !deviceId) {
        if (ready) ensureDeviceId(null);
        send(Object.assign(result, { error: "NOT_READY" }), true);
        return;
      }
      // 唯一一次签名校验：这台引擎上 Ed25519 验签要十几秒，只能放在激活
      // 握手这一次；启动链路只信本机记录（见 adoptToken）。
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
          key: LEGACY_TOKEN_KEY,
          value: value.licenseToken,
          success() {
            if (generation !== epoch) return;
            saving = false;
            activated = true;
            linking = false;
            licenseId = value.licenseId;
            publish();
            // 回执先发，不让记录写入拖住插件的重发轮次；v2 记录随后
            // 串行补写（此时的 deviceId 就是刚通过验签的真实指纹）。
            send(Object.assign(result, { success: true }), true);
            writeLicenseRecord(
              value.licenseToken,
              deviceId,
              value.licenseId,
              null,
            );
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

  // 插件 hello 的设备回执必须带有效指纹（插件侧会拒绝空值），指纹未就绪
  // 时不回、等按需读取完成后再回；期间插件按 2s×10 重发 hello 兜底。
  function replyDevice(id) {
    const generation = epoch;
    ensureDeviceId(function () {
      if (generation !== epoch) return;
      if (!deviceId) return;
      const reply = {
        v: 1,
        id: id,
        type: "device",
        productId: PRODUCT_ID,
        deviceId: deviceId,
        activated: activated,
      };
      if (deviceModel) reply.deviceModel = deviceModel;
      send(reply);
    });
    readModel();
  }

  // 连接状态探测必须有界：文档里 getReadyState 没有超时参数，固件会一直
  // 等到自动连接有结论——对端（AstroBox）不在时那就是连接超时，真机约
  // 半分钟，整段时间 JS 线程被同步卡住、定时器兜底也不会触发。diagnosis
  // 带 timeout（文档：等待诊断的超时时间），最坏等待封顶；老固件没有这个
  // 方法就干脆不查——状态只用于界面提示，onopen / onerror / onmessage
  // 已经给出足够的真实信号，不值得为提示冒无界等待的风险。
  function probeConnection() {
    if (typeof connection.diagnosis !== "function") return;
    try {
      connection.diagnosis({
        timeout: 1500,
        success(info) {
          connected = !!(info && info.status === 0);
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
    probeConnection();
  }

  // 应用启动只做本地授权校验：绝对不碰 interconnect——真机上对端
  // （AstroBox）不在时，桥接层会把 JS 线程同步卡到对端超时（约半分钟），
  // 整个画面冻结、任何 JS 定时器兜底都无法触发。interconnect 的对端只在
  // 激活流程中需要，而插件发起激活前必先 deeplink 打开激活页，retry()
  // 在那时才连接；hello 收不到时插件本就有 2s×10 的重发兜底。retry() 里的
  // 连接也只做有界探测（probeConnection），整套链路不再有半分钟级冻结。
  function start() {
    load();
  }
  function retry() {
    error = "";
    connect();
    load();
    publish();
  }
  // 游戏页只关心本地授权状态：重新读取记录，但不调用 connect()——
  // interconnect.instance() 是单例且 onmessage 全局唯一，谁后挂载谁收
  // 消息，激活页必须保有它才能收到插件下发的安装包。
  function refresh() {
    load();
    publish();
  }
  // 真机教训：app 上下文的定时器在页面可见时不跑，状态机里那个 8 秒
  // 看门狗可能永远不响。页面（定时器正常）发现结论迟迟不来时调用这里，
  // 放弃在途读链重新发起一次；epoch 自增让迟到的旧回调作废。
  function recover() {
    if (ready || !loading) return;
    epoch += 1;
    loading = false;
    load();
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
    deviceIdPending = false;
    deviceIdWaiters.splice(0);
    listeners.splice(0);
  }
  return {
    start,
    retry,
    refresh,
    recover,
    subscribe,
    snapshot,
    isActivated,
    dispose,
  };
}
