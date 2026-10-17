import { decodeLicense, deviceFingerprint } from "@kovela/license";

// One isolated authorization state machine per application instance.
// 激活判定只解读许可证并确认它属于本机，不做签名校验：真机上一次 Ed25519
// 验签要十几秒，代价与恢复方式见 README「激活链路的等待时间」。签发仍在
// 服务端带签名，因此恢复验签只需把下面的 decodeLicense 换回 verifyLicense。
export function createActivation(
  PRODUCT_ID,
  { device, storage, interconnect },
) {
  // 授权记录：JSON {token, device, licenseId}，写入只在激活握手成功之后发生。
  // 启动只读取这一条本地记录，不重跑判定，也不调用设备服务；真机上
  // getDeviceId / getInfo 与启动存储请求并发会把系统服务挤到约半分钟
  // 不响应，使页面失去交互并可能连带应用退出。
  // 授权不过期，离线场景也无法实时撤销；日常启动无需再次请求标识。
  const LICENSE_KEY = "kovela_license_v2";
  // 旧版键只读迁移：v1 是裸授权串，device_v1 是上一版的指纹缓存。
  // 仍在使用旧激活包的设备上只有这两个键，首次读到后写入 v2。
  const LEGACY_TOKEN_KEY = "kovela_license_v1";
  const LEGACY_DEVICE_KEY = "kovela_device_v1";
  const listeners = [];
  let connection = null;
  let epoch = 0;
  let loading = false;
  // 在途读链的起始时刻：retry() 用它区分「慢」与「卡死」。
  let loadingSince = 0;
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
  // 结论未出时收到的 hello：插件每 2 秒重发一次，收到就记账，读链一出
  // 结论立刻用它回执，省掉「先丢一条、再等一个 tick」的两秒。
  let waitingHelloId = "";
  // 授权记录写盘是否在途：真机上设备调用与存储请求并发会挤住系统服务，
  // 补发的 hello 回执让到写盘回调之后（写回调丢失时插件下一轮重发仍能
  // 直接回执，不会永久搁置）。
  let writeInFlight = false;
  // 残留旧授权串的「本地授权无效」提示是否已上屏（见 adoptToken）。
  let staleNotified = false;

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
      writeInFlight = false;
      if (typeof done === "function") done();
      // 写盘在途时压住的 hello 回执在这里补发。
      answerWaitingHello();
    };
    writeInFlight = true;
    try {
      storage.set({
        key: LICENSE_KEY,
        // licenseId 非空表示这条记录来自一次写完整的激活握手：正常启动
        // 只复核记录，不再解读令牌。
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
  // 旧授权串键也必须清：只清 v2 与指纹缓存的话，下次读链会再次落到
  // 「有旧授权串、无指纹」，错误每次重进、每次重试都重新出现，永远消不掉。
  function clearLicenseCaches() {
    writeLicenseRecord("", "", "", function () {
      clearKey(LEGACY_TOKEN_KEY, function () {
        clearKey(LEGACY_DEVICE_KEY, null);
      });
    });
  }
  function clearKey(key, done) {
    const next = function () {
      if (typeof done === "function") done();
    };
    try {
      storage.set({ key: key, value: "", success: next, fail: next });
    } catch (failure) {
      // 清不掉也只是下次启动再静默清一次（见 adoptToken）。
      next();
    }
  }

  function labelPart(value) {
    if (typeof value !== "string") return "";
    return value
      .replace(/./g, function (character) { return character.charCodeAt(0) < 32 ? " " : character; })
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
  // 设备标识按需读取：激活握手（hello 回执要带指纹）与安装包的绑定比对都用，
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
    loadingSince = Date.now();
    error = "";
    const generation = epoch;
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
      // 读链期间插件已经在等回执：结论一出就补上，不让对方再等一轮 tick。
      answerWaitingHello();
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
        // 重新激活一次即可补全，激活会重写配对记录。提示每个实例只上屏
        // 一次：清理写盘还没落地时重试会再读到同一份残留，那时静默收场。
        if (!staleNotified) {
          staleNotified = true;
          error = "本地授权无效，请通过 AstroBox 重新激活";
        }
        clearLicenseCaches();
        conclude(null, "");
        return;
      }
      // 本机记录即结论：写入这条记录的只有"激活握手写完整"和"旧版迁移"
      // 两条路径，所以启动不再重跑判定。真机教训：这台引擎上跑一次
      // Ed25519 验签要十几秒（Node 参照 19ms），放在启动链路上就是一次
      // 可见的冻结；判定只在激活握手做一次（见 receive），且只解读令牌。
      //
      // 旧版键读出来的配对顺手写成 v2，下次启动只读一次。
      conclude({ licenseId: licenseId }, cachedDevice);
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
        return { token: "", device: "", licenseId: "" };
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
          // 结论还没出：记账后继续读，读链一出结论就补发回执（见 conclude）。
          waitingHelloId = value.id;
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
      // 插件超时重发的安装包：同一许可证此前已解读并落盘，直接在
      // receive 里同步回执，免去落盘回调路径的等待。
      if (activated && licenseId === value.licenseId) {
        send(Object.assign(result, { success: true }));
        return;
      }
      // 设备标识还没读到就无法比对绑定：先按需发起读取，让插件按轮次重发，
      // 而不是回 INVALID_LICENSE 把它带进「许可证不匹配」的结论。
      if (!ready || saving || !deviceId) {
        if (ready) ensureDeviceId(null);
        send(Object.assign(result, { error: "NOT_READY" }), true);
        return;
      }
      // 激活握手只解读令牌：结构、产品与设备绑定。签名不校验——真机上一次
      // Ed25519 验签要十几秒，代价与恢复方式见 README「激活链路的等待时间」。
      const payload = decodeLicense(value.licenseToken, PRODUCT_ID, deviceId);
      if (!payload || payload.licenseId !== value.licenseId) {
        linking = false;
        error = "许可证与本机不匹配";
        publish();
        send(Object.assign(result, { error: "INVALID_LICENSE" }), true);
        return;
      }
      saving = true;
      error = "";
      publish();
      const generation = epoch;
      // 一次写入完整的 v2 记录（授权串 + 刚通过配对判定的真实指纹）。以前
      // 先写裸授权串到旧键、再补写 v2：两次写之间应用被杀或手环重启，就
      // 会留下「有授权串、无指纹」的残留，之后每次启动都报本地授权无效。
      writeInFlight = true;
      const saved = function () {
        writeInFlight = false;
        if (generation !== epoch) return;
        saving = false;
        activated = true;
        linking = false;
        licenseId = value.licenseId;
        publish();
        send(Object.assign(result, { success: true }), true);
        answerWaitingHello();
      };
      const failed = function () {
        writeInFlight = false;
        if (generation !== epoch) return;
        saving = false;
        linking = false;
        error = "授权未能保存，请重试";
        publish();
        send(Object.assign(result, { error: "STORAGE_FAILED" }), true);
      };
      try {
        storage.set({
          key: LICENSE_KEY,
          value: JSON.stringify({
            token: value.licenseToken,
            device: deviceId,
            licenseId: value.licenseId,
          }),
          success: saved,
          fail: failed,
        });
      } catch (failure) {
        failed();
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
      // 机型名只用于回执标注，回执发出后再单独读：getInfo 与 getDeviceId
      // 并发会挤住真机设备服务（同一刻只应有一个在途请求），反而让指纹
      // 迟到。读不到就退回宿主连接名，不参与授权判定。
      readModel();
    });
  }
  // 读链期间收到的 hello：结论一出立刻用它回执，插件不必再等下一轮重发。
  function answerWaitingHello() {
    if (!ready || !waitingHelloId || writeInFlight) return;
    const id = waitingHelloId;
    waitingHelloId = "";
    linking = true;
    publish();
    replyDevice(id);
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
    // 读链卡住时 load() 会直接返回（loading 仍为真），点「重新连接」也救不
    // 回来。真机丢回调是已知形态：在途超过 1.5 秒就放弃重来，同 recover()；
    // 健康但慢的读取不动它，避免给存储再压一条在途请求。
    if (!ready && loading && Date.now() - loadingSince > 1500) recover();
    else load();
    publish();
  }
  function refresh() {
    load();
    publish();
  }
  // 游戏页只关心本地授权状态：重新读取记录，但不调用 connect()——
  // interconnect.instance() 是单例且 onmessage 全局唯一，谁后挂载谁收
  // 消息，激活页必须保有它才能收到插件下发的安装包。
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
    waitingHelloId = "";
    writeInFlight = false;
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
