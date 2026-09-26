#[cfg(feature = "api4")]
wit_bindgen::generate!({
    path: "wit",
    world: "kovela",
    generate_all,
});

#[cfg(feature = "api4")]
use astrobox::psys_host_v4::{
    device, dialog, interconnect, notification, register, thirdpartyapp, timer, ui,
};
#[cfg(feature = "api4")]
use exports::astrobox::psys_plugin_v4::{
    event::{self, EventType},
    lifecycle,
};
#[cfg(not(feature = "api4"))]
use astrobox_ng_wit::FutureReader;
#[cfg(not(feature = "api4"))]
use astrobox_ng_wit::astrobox::psys_host::{
    device, dialog, interconnect, register, thirdpartyapp, timer, ui_v3 as ui,
};
#[cfg(not(feature = "api4"))]
use astrobox_ng_wit::exports::astrobox::psys_plugin::{
    event_v3::{self, EventType},
    lifecycle,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{cell::RefCell, time::Duration};
use uuid::Uuid;

mod theme;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Handoff {
    server_origin: String,
    handoff_token: String,
    product_id: String,
    product_name: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Issued {
    license_id: String,
    license_token: String,
    receipt_token: String,
    product_id: String,
    device_id: String,
}
#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Hello,
    Issuing,
    Installing,
    Reporting,
    Retry,
    Complete,
}
#[derive(Clone)]
struct Pending {
    id: String,
    addr: String,
    device_id: Option<String>,
    device_model: Option<String>,
    issued: Option<Issued>,
    ack: Option<bool>,
    reported: bool,
    phase: Phase,
    hello_tries: u32,
    install_retries: u32,
}
#[derive(Clone)]
struct Offer {
    product_id: String,
    product_name: String,
    handoff_token: String,
    bound_device_id: Option<String>,
}
#[derive(Default)]
struct State {
    root: Option<String>,
    order_no: String,
    offers: Vec<Offer>,
    verifying: bool,
    handoff: Option<Handoff>,
    devices: Vec<(String, String)>,
    selected: Option<usize>,
    pending: Option<Pending>,
    message: String,
    device_note: String,
    scan_gen: u32,
    scan_tries: u32,
    scanning: bool,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
struct Kovela;

/// 官方群（QQ）加群链接，页脚的「加入官群」用它打开系统浏览器。
const COMMUNITY_URL: &str = "https://qm.qq.com/q/JQRdtQcPIc";
/// 页脚链接的点击事件 id。
const COMMUNITY_EVENT: &str = "community";

async fn host_register_recv(addr: &str, package: &str) -> Result<(), String> {
    #[cfg(feature = "api4")]
    {
        register::register_interconnect_recv(addr.to_string(), package.to_string()).await
    }
    #[cfg(not(feature = "api4"))]
    {
        register::register_interconnect_recv(addr, package)
            .await
            .map_err(|()| "权限被拒绝".into())
    }
}
async fn host_send(addr: &str, package: &str, data: &str) -> Result<(), String> {
    #[cfg(feature = "api4")]
    {
        interconnect::send_qaic_message(addr.to_string(), package.to_string(), data.to_string())
            .await
    }
    #[cfg(not(feature = "api4"))]
    {
        interconnect::send_qaic_message(addr, package, data)
            .await
            .map_err(|()| "发送失败".into())
    }
}
async fn host_timeout(delay_ms: u64, payload: &str) {
    #[cfg(feature = "api4")]
    {
        let _ = timer::set_timeout(delay_ms, payload);
    }
    #[cfg(not(feature = "api4"))]
    {
        timer::set_timeout(delay_ms, payload).await;
    }
}

// 快应用必须先在前台运行并建立 interconnect 通道，插件才能收发消息。
// 设备端应用列表读不到时继续尝试发送，避免宿主版本差异导致整条链路不可用。
async fn open_app(addr: &str, package: &str) -> Result<(), String> {
    #[cfg(feature = "api4")]
    {
        let Ok(apps) = thirdpartyapp::get_thirdparty_app_list(addr.to_string()).await else {
            return Ok(());
        };
        let Some(app) = apps.into_iter().find(|app| app.package_name == package) else {
            return Err("手环上未安装该应用，请先在 AstroBox 中安装".into());
        };
        for page in ["pages/activation", "/pages/activation", "pages/index"] {
            if thirdpartyapp::launch_qa(addr.to_string(), app.clone(), page.to_string())
                .await
                .is_ok()
            {
                return Ok(());
            }
        }
        Ok(())
    }
    #[cfg(not(feature = "api4"))]
    {
        let Ok(apps) = thirdpartyapp::get_thirdparty_app_list(addr).await else {
            return Ok(());
        };
        let Some(app) = apps.into_iter().find(|app| app.package_name == package) else {
            return Err("手环上未安装该应用，请先在 AstroBox 中安装".into());
        };
        for page in ["pages/activation", "/pages/activation", "pages/index"] {
            if thirdpartyapp::launch_qa(addr, &app, page).await.is_ok() {
                return Ok(());
            }
        }
        Ok(())
    }
}


fn is_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn usable_label(value: &str) -> Option<String> {
    let text = value.trim();
    let count = text.chars().count();
    if (1..=80).contains(&count) && !text.chars().any(char::is_control) {
        Some(text.to_string())
    } else {
        None
    }
}
fn server_origin() -> &'static str {
    match option_env!("KOVELA_ORIGIN") {
        Some(origin) if !origin.is_empty() => origin,
        _ => "https://kovela.komoridevs.icu",
    }
}
fn valid_product_id(value: &str) -> bool {
    value.len() <= 128
        && value.contains('.')
        && value.split('.').all(|part| {
            part.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
        })
}
fn normalize_order(input: &str) -> Result<String, String> {
    let order: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    if (16..=32).contains(&order.len()) && order.bytes().all(|c| c.is_ascii_digit()) {
        Ok(order)
    } else {
        Err("请输入 16～32 位爱发电订单号".into())
    }
}
fn event_text(payload: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return payload.to_string();
    };
    let field = value
        .get("value")
        .or_else(|| value.get("text"))
        .or_else(|| value.get("data"));
    if let Some(text) = field.and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(number) = field.and_then(Value::as_u64) {
        return number.to_string();
    }
    if let Some(number) = field.and_then(Value::as_f64) {
        if number.is_finite() && number >= 0.0 {
            return format!("{number:.0}");
        }
    }
    value.as_str().unwrap_or(payload).to_string()
}
fn remember_order(payload: &str) {
    if payload.is_empty() || payload.len() > 4096 {
        return;
    }
    let text = event_text(payload);
    let digits: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
    let stored = if (16..=32).contains(&digits.len()) {
        digits
    } else {
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            return;
        }
        trimmed.to_string()
    };
    STATE.with(|state| state.borrow_mut().order_no = stored);
}
fn timer_body(payload: &str) -> String {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("payload")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| payload.to_string())
}
// 设备端快应用可能还在启动，hello 每条 tick 重发一次，约 20 秒后放弃。
fn hello_tick(id: &str) -> Option<Option<(String, String)>> {
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        let (phase, pending_id, tries) = match s.pending.as_ref() {
            Some(p) => (p.phase, p.id.clone(), p.hello_tries),
            None => return None,
        };
        if phase != Phase::Hello || pending_id != id {
            return None;
        }
        if tries >= 10 {
            return Some(None);
        }
        if let Some(p) = s.pending.as_mut() {
            p.hello_tries += 1;
        }
        let package = s.handoff.as_ref()?.product_id.clone();
        let addr = s.pending.as_ref()?.addr.clone();
        Some(Some((addr, package)))
    })
}
fn locked() -> bool {
    busy() || STATE.with(|state| state.borrow().verifying)
}


fn connected_name(addr: &str) -> Option<String> {
    STATE.with(|state| {
        state
            .borrow()
            .devices
            .iter()
            .find(|(item, _)| item == addr)
            .and_then(|(_, name)| usable_label(name))
    })
}

fn parse_offers(value: &Value) -> Result<Vec<Offer>, String> {
    let Some(items) = value.get("items").and_then(Value::as_array) else {
        return Err("查询结果异常，请重试".into());
    };
    if items.is_empty() || items.len() > 8 {
        return Err("查询结果异常，请重试".into());
    }
    let mut offers: Vec<Offer> = Vec::new();
    for item in items {
        let product_id = item.get("productId").and_then(Value::as_str).unwrap_or("");
        let product_name = item.get("productName").and_then(Value::as_str).unwrap_or("");
        let token = item.get("handoffToken").and_then(Value::as_str).unwrap_or("");
        let name = usable_label(product_name);
        if !valid_product_id(product_id) || name.is_none() || !is_hex(token) {
            return Err("查询结果不匹配，请重试".into());
        }
        if offers.iter().any(|offer| offer.product_id == product_id) {
            return Err("查询结果不匹配，请重试".into());
        }
        offers.push(Offer {
            product_id: product_id.to_string(),
            product_name: name.unwrap(),
            handoff_token: token.to_string(),
            bound_device_id: item
                .get("boundDeviceId")
                .and_then(Value::as_str)
                .filter(|id| is_hex(id))
                .map(str::to_string),
        });
    }
    Ok(offers)
}

fn busy() -> bool {
    STATE.with(|state| {
        state
            .borrow()
            .pending
            .as_ref()
            .is_some_and(|p| !matches!(p.phase, Phase::Retry | Phase::Complete))
    })
}
fn fail(message: impl Into<String>) {
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        s.message = message.into();
        if let Some(p) = s.pending.as_mut() {
            p.phase = Phase::Retry;
        }
    });
    render();
}
fn set_phase(id: &str, phase: Phase, message: &str) -> bool {
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        if let Some(p) = s.pending.as_mut() {
            if p.id == id {
                p.phase = phase;
                s.message = message.into();
                return true;
            }
        }
        false
    })
}
fn gate(element: ui::Element, locked: bool) -> ui::Element {
    if locked { element.disabled() } else { element }
}

/// 绑定回执里的设备标识前缀，用来在卡片上区分设备。
/// 手环标识理应是十六进制串，但服务端给多短就显示多短，不在切片上 panic。
fn short_device_id(id: &str) -> String {
    id.chars().take(12).collect()
}

/// 绑定状态文案：查询结果里带设备标识就是已绑定。
fn binding_text(bound_device_id: Option<&str>) -> String {
    match bound_device_id {
        Some(id) => format!("已绑定 {}", short_device_id(id)),
        None => "尚未绑定".to_string(),
    }
}

/// 所选商品的绑定状态：订单查询结果里就有，不用再问服务端。
fn binding_note(offers: &[Offer], product_id: &str) -> String {
    binding_text(
        offers
            .iter()
            .find(|offer| offer.product_id == product_id)
            .and_then(|offer| offer.bound_device_id.as_deref()),
    )
}

/// 激活过程的四段动作，和 `Phase` 一一对应。
const ACTIVATION_STEPS: [&str; 4] = ["连接设备", "签发许可证", "写入设备", "提交回执"];

/// 商品卡片：标题 + 绑定状态 chip + 确认按钮。
///
/// 只有订单里含多个应用时才需要这张卡片——单个商品在查询成功时就自动接管了。
fn offer_card(offer: &Offer, index: usize) -> ui::Element {
    theme::card()
        .child(
            theme::row(theme::space::TWO)
                .child(theme::section(&offer.product_name))
                .child(theme::chip(&binding_text(offer.bound_device_id.as_deref()))),
        )
        .child(theme::outlined_button("确认", &format!("offer:{index}")))
}

/// 激活已经走到第几段（0 起算，等于段数表示全部走完）。
fn activation_step(pending: Option<&Pending>) -> usize {
    match pending.map(|item| item.phase) {
        Some(Phase::Hello) => 0,
        Some(Phase::Issuing) => 1,
        Some(Phase::Installing) => 2,
        Some(Phase::Reporting) => 3,
        // 重试只是回到最近失败的那一段，不能把没走过的段落标成已完成。
        Some(Phase::Retry) => {
            if pending.is_some_and(|item| item.ack.is_some() && !item.reported) {
                3 // 回执还没上报，重试会再上报一次
            } else if pending.is_some_and(|item| item.issued.is_some()) {
                2 // 许可证已拿到，重试是重发写入
            } else {
                0 // 还没连上设备，重试要从头握手
            }
        }
        Some(Phase::Complete) | None => ACTIVATION_STEPS.len(),
    }
}

fn render() {
    let (
        root,
        message,
        order_no,
        offers,
        verifying,
        handoff,
        devices,
        selected,
        pending,
        device_note,
        scanning,
        scan_tries,
    ) = STATE.with(|state| {
        let s = state.borrow();
        (
            s.root.clone(),
            s.message.clone(),
            s.order_no.clone(),
            s.offers.clone(),
            s.verifying,
            s.handoff.clone(),
            s.devices.clone(),
            s.selected,
            s.pending.clone(),
            s.device_note.clone(),
            s.scanning,
            s.scan_tries,
        )
    });
    let Some(root) = root else { return };
    let phase = pending.as_ref().map(|item| item.phase);
    let active = phase.is_some_and(|phase| !matches!(phase, Phase::Retry | Phase::Complete));
    let complete = phase == Some(Phase::Complete);
    let ui_locked = verifying || active;
    let progress = match phase {
        Some(Phase::Hello) => Some(35),
        Some(Phase::Issuing) => Some(55),
        Some(Phase::Installing) | Some(Phase::Retry) => Some(75),
        Some(Phase::Reporting) => Some(90),
        Some(Phase::Complete) => Some(100),
        None => None,
    };
    let heading = if complete {
        "激活完成".to_string()
    } else if let Some(item) = &handoff {
        item.product_name.clone()
    } else if !offers.is_empty() {
        "选择要激活的应用".to_string()
    } else if verifying {
        "正在查询".to_string()
    } else {
        "输入订单号".to_string()
    };
    // 两步走：查到订单结果就进第二步（选设备 + 激活），商品由订单号带出来。
    let step = if offers.is_empty() && handoff.is_none() && pending.is_none() {
        1
    } else {
        2
    };
    let mut page = theme::page()
        .child(theme::steps(step))
        .child(theme::headline(&heading));
    match step {
        1 => {
            page = page.child(if message.is_empty() {
                theme::label("请输入爱发电订单号")
            } else {
                theme::body(&message)
            });
            let verify_label = if verifying {
                "查询中…"
            } else {
                "查询订单"
            };
            let verify = gate(theme::filled_button(verify_label, "verify"), ui_locked);
            page = page
                .child(gate(theme::field("爱发电订单号", "order-input"), ui_locked))
                .child(verify);
        }
        _ => {
            if !message.is_empty() {
                page = page.child(theme::body(&message));
            }
            match &handoff {
                // 只有订单里含多个应用时才需要挑一个，单个商品查询成功就自动接管了。
                None => {
                    page = page.child(theme::label(&format!("订单 {order_no}")));
                    for (index, offer) in offers.iter().enumerate() {
                        page = page.child(gate(offer_card(offer, index), ui_locked));
                    }
                }
                Some(item) => {
                    page = page.child(
                        theme::row(theme::space::TWO)
                            .child(theme::section(&item.product_name))
                            .child(theme::chip(&binding_note(&offers, &item.product_id))),
                    );
                    if pending.is_some() {
                        // 激活进行中：进度条 + 四段动作逐段点亮。
                        if let Some(value) = progress {
                            page = page.child(theme::progress(value));
                        }
                        let reached = activation_step(pending.as_ref());
                        for (index, label) in ACTIVATION_STEPS.iter().enumerate() {
                            let state = match index.cmp(&reached) {
                                std::cmp::Ordering::Less => theme::StepState::Done,
                                std::cmp::Ordering::Equal => theme::StepState::Current,
                                std::cmp::Ordering::Greater => theme::StepState::Upcoming,
                            };
                            page = page.child(theme::substep(label, state));
                        }
                    } else {
                        // 设备信息只在选设备时占版面。
                        let device_status = if !device_note.is_empty() {
                            device_note.clone()
                        } else if scanning {
                            format!("正在读取设备列表…（第 {} 次）", scan_tries)
                        } else {
                            "点「刷新设备」读取手环列表".to_string()
                        };
                        page = page.child(theme::status(&device_status));
                        if devices.len() == 1 {
                            let (addr, name) = &devices[0];
                            let label = if name.trim().is_empty() {
                                format!("设备：{addr}")
                            } else {
                                format!("设备：{name}")
                            };
                            page = page.child(theme::body(&label));
                        }
                        for (index, (addr, name)) in devices.iter().enumerate() {
                            if devices.len() < 2 {
                                break;
                            }
                            let label = if name.trim().is_empty() {
                                addr.clone()
                            } else if selected == Some(index) {
                                format!("已选择 {name}")
                            } else {
                                name.clone()
                            };
                            let event = format!("device:{index}");
                            let button = if selected == Some(index) {
                                theme::tonal_button(&label, &event)
                            } else {
                                theme::outlined_button(&label, &event)
                            };
                            page = page.child(gate(button, ui_locked));
                        }
                        page = page.child(gate(
                            theme::outlined_button("刷新设备", "refresh"),
                            ui_locked,
                        ));
                    }
                    let action = if complete {
                        "已激活"
                    } else if phase == Some(Phase::Retry) {
                        "重试"
                    } else if active {
                        "激活中…"
                    } else {
                        "激活"
                    };
                    page = page.child(gate(
                        theme::filled_button(action, "activate"),
                        ui_locked || complete || selected.is_none(),
                    ));
                }
            }
            let cancel = if complete {
                "重新开始"
            } else {
                "重新输入"
            };
            page = page.child(gate(theme::text_button(cancel, "cancel"), ui_locked));
        }
    }
    page = page.child(theme::divider()).child(theme::footer(
        "对应用有疑问？",
        "加入官群",
        COMMUNITY_EVENT,
    ));
    ui::render(&root, page);
}

// 宿主读取设备列表会先请求前端授权，可能失败或长时间不返回；
// 所以每次扫描都先排一个定时器，超时或空结果都会自动重扫。
async fn load_devices() {
    let (generation, tries) = STATE.with(|state| {
        let mut s = state.borrow_mut();
        s.scan_gen = s.scan_gen.wrapping_add(1);
        s.scan_tries = s.scan_tries.saturating_add(1);
        s.scanning = true;
        (s.scan_gen, s.scan_tries)
    });
    render();
    if tries < 6 {
        host_timeout(2_500, &format!("scan:{generation}")).await;
    }
    let connected = device::get_connected_device_list()
        .await
        .into_iter()
        .map(|device| (device.addr, device.name))
        .collect::<Vec<_>>();
    let mut history = 0;
    let mut devices = connected.clone();
    if connected.is_empty() {
        let known = device::get_device_list()
            .await
            .into_iter()
            .map(|device| (device.addr, device.name))
            .collect::<Vec<_>>();
        history = known.len();
        // 已连接的设备优先；宿主没能标记为已连接时，历史记录仍可尝试，
        // 失败会在发送阶段给出明确提示。
        for (addr, name) in known {
            if devices.iter().any(|(item, _)| item == &addr) {
                continue;
            }
            let label = name.trim();
            devices.push((
                addr.clone(),
                if label.is_empty() {
                    format!("{addr} · 历史")
                } else {
                    format!("{label} · 历史")
                },
            ));
        }
    }
    let note = if connected.len() == 1 {
        "已找到 1 台手环".to_string()
    } else if !connected.is_empty() {
        format!("已找到 {} 台手环，默认第一台，可点选其它", connected.len())
    } else if history > 0 {
        format!("未检测到已连接手环（历史 {history} 台），请在 AstroBox 中连接后点「刷新设备」")
    } else {
        "未检测到手环：请确认 AstroBox 已连接，并允许 Kovela 访问设备后点「刷新设备」".into()
    };
    let applied = STATE.with(|state| {
        let mut s = state.borrow_mut();
        if s.scan_gen != generation {
            return false;
        }
        s.scanning = false;
        let replace = s
            .pending
            .as_ref()
            .is_none_or(|pending| matches!(pending.phase, Phase::Retry | Phase::Complete));
        if replace {
            s.selected = if devices.is_empty() { None } else { Some(0) };
            s.devices = devices.clone();
            s.device_note = note;
        }
        true
    });
    if !applied {
        return;
    }
    render();
}

// 用户主动刷新或刚确认应用时重置重试次数，重新开始扫描。
async fn begin_scan() {
    STATE.with(|state| {
        state.borrow_mut().scan_tries = 0;
    });
    load_devices().await;
}

async fn scan_tick(id: &str) {
    let Some(generation) = id.parse::<u32>().ok() else {
        return;
    };
    let retry = STATE.with(|state| {
        let s = state.borrow();
        s.scan_gen == generation && s.devices.is_empty() && s.scan_tries < 6
    });
    if retry {
        load_devices().await;
    }
}

fn post<T: serde::de::DeserializeOwned>(
    origin: &str,
    path: &str,
    body: Value,
) -> Result<T, String> {
    let response = waki::Client::new()
        .post(&format!("{origin}{path}"))
        .header("Content-Type", "application/json")
        .connect_timeout(Duration::from_secs(12))
        .body(serde_json::to_vec(&body).map_err(|_| "请求发送失败")?)
        .send()
        .map_err(|_| "无法连接服务器，请检查网络后重试")?;
    let status = response.status_code();
    let bytes = response
        .body()
        .map_err(|_| "服务器响应不完整，请重试")?;
    if bytes.len() > 16384 {
        return Err("服务器响应过长".into());
    }
    if !(200..300).contains(&status) {
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        return Err(value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .filter(|s| s.len() < 512)
            .unwrap_or("查询失败，请重试")
            .into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "服务器响应无法识别".into())
}
fn show(message: impl Into<String>) {
    STATE.with(|state| state.borrow_mut().message = message.into());
    render();
}
fn reset_order() {
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        s.offers.clear();
        s.handoff = None;
        s.pending = None;
        s.selected = None;
        s.verifying = false;
        s.message = "请输入爱发电订单号".into();
    });
    render();
}
fn confirm_offer(index: usize) {
    if locked() {
        return;
    }
    let offer = STATE.with(|state| state.borrow().offers.get(index).cloned());
    let Some(offer) = offer else {
        return;
    };
    let note = match offer.bound_device_id.as_deref() {
        Some(id) => format!(
            "已确认 {}，已绑定 {}，仅可在该设备上重新传输",
            offer.product_name,
            &id[..12]
        ),
        None => format!("已确认 {}，请选择手环后激活", offer.product_name),
    };
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        s.pending = None;
        s.handoff = Some(Handoff {
            server_origin: server_origin().into(),
            handoff_token: offer.handoff_token,
            product_id: offer.product_id,
            product_name: offer.product_name,
        });
        s.message = note;
    });
    render();
}
fn queue_lookup() {
    let order = STATE.with(|state| state.borrow().order_no.clone());
    match normalize_order(&order) {
        Ok(order) => STATE.with(|state| {
            let mut s = state.borrow_mut();
            s.order_no = order;
            s.verifying = true;
            s.message = "正在查询订单…".into();
        }),
        Err(error) => STATE.with(|state| {
            let mut s = state.borrow_mut();
            s.verifying = false;
            s.message = error;
        }),
    }
}
fn finish_lookup() {
    let order = STATE.with(|state| {
        let state = state.borrow();
        if state.verifying {
            Some(state.order_no.clone())
        } else {
            None
        }
    });
    let Some(order) = order else {
        render();
        return;
    };
    match post::<Value>(
        server_origin(),
        "/api/orders/lookup",
        json!({"orderNo": order}),
    ) {
        Ok(value) => match parse_offers(&value) {
            Ok(offers) => {
                // 订单号本身就决定了商品：只有一个就直接接管，多于一个才让用户挑。
                let single = offers.len() == 1;
                STATE.with(|state| {
                    let mut s = state.borrow_mut();
                    s.verifying = false;
                    s.pending = None;
                    s.handoff = None;
                    s.offers = offers;
                    s.message = if single {
                        String::new()
                    } else {
                        "这个订单包含多个应用，请选择要激活的那个".into()
                    };
                });
                if single {
                    confirm_offer(0);
                } else {
                    render();
                }
            }
            Err(error) => {
                STATE.with(|state| state.borrow_mut().verifying = false);
                show(error);
            }
        },
        Err(error) => {
            let error = if error.contains("接口不存在") {
                "查询暂不可用，请稍后再试".into()
            } else {
                error
            };
            STATE.with(|state| state.borrow_mut().verifying = false);
            show(error);
        }
    }
}

async fn send_install(pending: Pending) {
    let Some(issued) = pending.issued.as_ref() else {
        return;
    };
    if !set_phase(
        &pending.id,
        Phase::Installing,
        "许可证已签发，正在写入设备…",
    ) {
        return;
    }
    render();
    let data=json!({"v":1,"id":pending.id,"type":"install-license","licenseId":issued.license_id,"licenseToken":issued.license_token}).to_string();
    if host_send(&pending.addr, &issued.product_id, &data)
        .await
        .is_err()
    {
        fail("传输失败，请打开手环应用并保持连接后重试");
        return;
    }
    // 宿主对快应用回包的路由可能只认最近一次注册（Daymatter 每次发送前都
    // 重新注册；回执是 install-license 之后的第二条入站消息），发送完补注
    // 册一次再等回执，手环端回执才不会因无路由被传输层拒收（202）。
    let _ = host_register_recv(&pending.addr, &issued.product_id).await;
    // 短窗口重发：手环收到重发的安装包且已激活时会同步立即回执——
    // "紧跟下行消息的发送"是实测唯一可靠的回执时机。
    host_timeout(12_000, &format!("install:{}", pending.id)).await;
}

async fn start_activation() {
    let needs_scan = STATE.with(|state| {
        let s = state.borrow();
        s.handoff.is_some() && s.devices.is_empty()
    });
    if needs_scan {
        load_devices().await;
    }
    if busy() {
        return;
    }
    let previous = STATE.with(|state| state.borrow().pending.clone());
    if let Some(p) = previous {
        if p.phase == Phase::Complete {
            return;
        }
        if p.ack.is_some() && !p.reported {
            report(p).await;
            return;
        }
        if p.issued.is_some() {
            STATE.with(|state| {
                if let Some(p) = state.borrow_mut().pending.as_mut() {
                    p.ack = None;
                    p.reported = false;
                }
            });
            send_install(p).await;
            return;
        }
    }
    let selection = STATE.with(|state| {
        let mut s = state.borrow_mut();
        let handoff = s.handoff.clone()?;
        let index = match s.selected {
            Some(index) if index < s.devices.len() => index,
            _ => 0,
        };
        let (addr, _) = s.devices.get(index)?.clone();
        let id = s
            .pending
            .as_ref()
            .map(|p| p.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        s.pending = Some(Pending {
            id: id.clone(),
            addr: addr.clone(),
            device_id: None,
            device_model: None,
            issued: None,
            ack: None,
            reported: false,
            phase: Phase::Hello,
            hello_tries: 0,
            install_retries: 0,
        });
        s.message = "正在获取设备信息…".into();
        Some((handoff, addr, id))
    });
    let Some((handoff, addr, id)) = selection else {
        fail("未检测到设备：请在 AstroBox 中连接手环，然后点「刷新设备」");
        return;
    };
    render();
    if let Err(error) = open_app(&addr, &handoff.product_id).await {
        fail(error);
        return;
    }
    if host_register_recv(&addr, &handoff.product_id)
        .await
        .is_err()
    {
        fail("无法接收设备消息，请授予权限后重试");
        return;
    }
    let message = json!({"v":1,"id":id,"type":"hello"}).to_string();
    if host_send(&addr, &handoff.product_id, &message)
        .await
        .is_err()
    {
        fail(format!(
            "无法连接{}，请在手环上打开应用",
            handoff.product_name
        ));
        return;
    }
    host_timeout(2_000, &format!("tick:{id}")).await;
}

async fn notify_activated(addr: String, product: String) {
    #[cfg(not(feature = "api4"))]
    {
        let _ = (addr, product);
    }
    #[cfg(feature = "api4")]
    {
        let message = notification::Message {
            id: 1,
            app_name: "Kovela".into(),
            title: format!("{product}已激活"),
            sub_title: String::new(),
            body: "许可证已保存在手环上，可离线使用".into(),
            timestamp_ms: None,
            live_activity: None,
        };
        let _ = notification::send(addr, message).await;
    }
}

async fn report(pending: Pending) {
    let (Some(issued), Some(success)) = (pending.issued.as_ref(), pending.ack) else {
        return;
    };
    if !set_phase(
        &pending.id,
        Phase::Reporting,
        if success {
            "手环已激活，正在同步结果…"
        } else {
            "激活未完成，正在记录结果…"
        },
    ) {
        return;
    }
    render();
    if success {
        let product = STATE.with(|state| {
            state
                .borrow()
                .handoff
                .as_ref()
                .map(|handoff| handoff.product_name.clone())
                .unwrap_or_else(|| "应用".into())
        });
        notify_activated(pending.addr.clone(), product).await;
    }
    let origin = STATE.with(|state| {
        state
            .borrow()
            .handoff
            .as_ref()
            .map(|h| h.server_origin.clone())
    });
    let Some(origin) = origin else {
        return;
    };
    let result = post::<Value>(
        &origin,
        "/api/activation/report",
        {
            let mut payload = json!({"receiptToken":issued.receipt_token,"requestId":pending.id,"licenseId":issued.license_id,"deviceId":issued.device_id,"result":if success{"activated"}else{"failed"}});
            if let Some(model) = pending.device_model.clone().or_else(|| connected_name(&pending.addr)) {
                payload["deviceModel"] = Value::String(model);
            }
            payload
        },
    );
    match result {
        Ok(value)
            if matches!(
                value.get("notification").and_then(Value::as_str),
                Some("sent" | "pending")
            ) =>
        {
            STATE.with(|state| {
                let mut s = state.borrow_mut();
                if let Some(p) = s.pending.as_mut() {
                    if p.id != pending.id {
                        return;
                    }
                    p.reported = true;
                    p.phase = if success {
                        Phase::Complete
                    } else {
                        Phase::Retry
                    };
                }
                s.message = if success {
                    if value["notification"] == "sent" {
                        "激活成功！感谢您的支持 ❤️"
                    } else {
                        "激活成功！感谢您的支持 ❤️"
                    }
                } else {
                    "激活未完成，请查看手环提示后重试"
                }
                .into();
            });
            render();
        }
        _ => fail(if success {
            "设备已激活，但通知未能发送，请保持页面打开并重试，无需重新购买"
        } else {
            "激活未完成，结果尚未提交，请重试"
        }),
    }
}

async fn on_device_message(raw: &str) {
    if raw.len() > 4096 {
        return;
    }
    let Ok(message) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    // 官方 connect.send 契约要求数据参数是对象；固件会把对象序列化后包进
    // payloadText 信封再传输（Daymatter 插件同款解包）。裸 JSON 载荷也兼容。
    let message = match message.get("payloadText").and_then(Value::as_str) {
        Some(inner) => match serde_json::from_str::<Value>(inner) {
            Ok(value) => value,
            Err(_) => return,
        },
        None => message,
    };
    let Some(pending) = STATE.with(|state| state.borrow().pending.clone()) else {
        return;
    };
    if message["v"] != 1 || message["id"] != pending.id {
        return;
    }
    if message["type"] == "device" && pending.phase == Phase::Hello {
        let Some(id) = message
            .get("deviceId")
            .and_then(Value::as_str)
            .filter(|id| is_hex(id))
        else {
            fail("设备未提供有效标识，请检查权限");
            return;
        };
        let handoff = STATE.with(|state| {
            let mut s = state.borrow_mut();
            let model = message
                .get("deviceModel")
                .and_then(Value::as_str)
                .and_then(usable_label);
            s.pending.as_mut().unwrap().device_id = Some(id.into());
            s.pending.as_mut().unwrap().device_model = model;
            s.handoff.clone()
        });
        let Some(handoff) = handoff else {
            return;
        };
        if message["productId"] != handoff.product_id {
            fail("连接到的应用不匹配");
            return;
        }
        set_phase(
            &pending.id,
            Phase::Issuing,
            "正在为该设备签发许可证…",
        );
        render();
        match post::<Issued>(
            &handoff.server_origin,
            "/api/activate",
            json!({"handoffToken":handoff.handoff_token,"productId":handoff.product_id,"deviceId":id,"requestId":pending.id}),
        ) {
            Ok(issued)
                if issued.product_id == handoff.product_id
                    && issued.device_id == id
                    && is_hex(&issued.receipt_token)
                    && issued.license_token.len() <= 2048
                    && issued.license_token.starts_with("KV1.")
                    && (16..=80).contains(&issued.license_id.len()) =>
            {
                let updated = STATE.with(|state| {
                    let mut s = state.borrow_mut();
                    let p = s.pending.as_mut()?;
                    if p.id != pending.id {
                        return None;
                    }
                    p.issued = Some(issued);
                    Some(p.clone())
                });
                if let Some(p) = updated {
                    send_install(p).await;
                }
            }
            Ok(_) => fail("许可证与所选设备不匹配"),
            Err(error) => fail(error),
        }
    } else if message["type"] == "activation-result"
        && matches!(pending.phase, Phase::Installing | Phase::Retry)
    {
        let Some(issued) = pending.issued.as_ref() else {
            return;
        };
        if message["licenseId"] != issued.license_id || message["deviceId"] != issued.device_id {
            return;
        }
        let Some(success) = message["success"].as_bool() else {
            return;
        };
        let updated = STATE.with(|state| {
            let mut s = state.borrow_mut();
            let p = s.pending.as_mut()?;
            if p.ack == Some(true) {
                return None;
            }
            p.ack = Some(success);
            p.reported = false;
            Some(p.clone())
        });
        if let Some(p) = updated {
            report(p).await;
        }
    }
}

async fn dispatch_event(kind: EventType, payload: String) {
    match kind {
        EventType::InterconnectMessage => on_device_message(&payload).await,
        EventType::Timer => {
            let body = timer_body(&payload);
            if let Some(id) = body.strip_prefix("tick:") {
                match hello_tick(id) {
                Some(Some((addr, package))) => {
                    // 每次重发 hello 前补注册：宿主对回包的路由若只认最近
                    // 一次注册，前一条回复会把路由消耗掉。
                    let _ = host_register_recv(&addr, &package).await;
                    let message = json!({"v":1,"id":id,"type":"hello"}).to_string();
                    let _ = host_send(&addr, &package, &message).await;
                    host_timeout(2_000, &format!("tick:{id}")).await;
                }
                    Some(None) => {
                        fail("连接超时，请在手环应用里点重试，或重新打开应用后再试")
                    }
                    None => {}
                }
            } else if let Some(id) = body.strip_prefix("scan:") {
                scan_tick(id).await;
            } else if let Some(pending) = STATE.with(|state| {
                let mut s = state.borrow_mut();
                let p = s.pending.as_mut()?;
                if p.phase != Phase::Installing || body != format!("install:{}", p.id) {
                    return None;
                }
                if p.install_retries >= 2 {
                    return None;
                }
                p.install_retries += 1;
                Some(p.clone())
            }) {
                // 回执丢一次先自动重发安装包（发送后会补注册路由），
                // 手环端收到重发会立即同步回执；两轮都失败才要求手动重试。
                send_install(pending).await;
            } else {
                let waiting = STATE.with(|state| {
                    let s = state.borrow();
                    s.pending.as_ref().is_some_and(|p| {
                        p.phase == Phase::Installing && body == format!("install:{}", p.id)
                    })
                });
                if waiting {
                    fail("等待设备响应超时，请保持应用打开后重试，本次尚未激活成功");
                }
            }
        }
        _ => {}
    }
}
enum UiFollow {
    None,
    Refresh,
    Scan,
    Activate,
}
fn dispatch_ui(id: &str, event: ui::Event, payload: &str) -> UiFollow {
    if matches!(
        event,
        ui::Event::Input | ui::Event::Change | ui::Event::Blur
    ) {
        remember_order(payload);
        // 渲染时不做设备调用；用户开始输入订单号时顺带读一次设备列表，
        // 省得必须去点「刷新设备」。
        let unscanned = STATE.with(|state| {
            let s = state.borrow();
            s.scan_tries == 0 && s.device_note.is_empty() && !s.scanning
        });
        return if unscanned {
            UiFollow::Scan
        } else {
            UiFollow::None
        };
    }
    // 页脚链接和订单流程无关，锁定时也要能点。
    if matches!(event, ui::Event::Click) && id == COMMUNITY_EVENT {
        dialog::open_url(COMMUNITY_URL);
        return UiFollow::None;
    }
    if !matches!(event, ui::Event::Click) || locked() {
        return UiFollow::None;
    }
    if id == "cancel" {
        reset_order();
        return UiFollow::None;
    }
    remember_order(payload);
    let first_step = STATE.with(|state| {
        let state = state.borrow();
        state.offers.is_empty() && state.handoff.is_none()
    });
    let known = id == "verify"
        || id == "cancel"
        || id == "refresh"
        || id == "activate"
        || id.starts_with("offer:")
        || id.starts_with("device:");
    if id == "verify" || id == "查询订单" || (first_step && !known) {
        queue_lookup();
        if STATE.with(|state| state.borrow().verifying) {
            finish_lookup();
            // 商品已由订单号确定，顺手把设备列表也读出来，下一步就能直接激活。
            if STATE.with(|state| state.borrow().handoff.is_some()) {
                return UiFollow::Refresh;
            }
        } else {
            render();
        }
        return UiFollow::None;
    }
    if id == "refresh" {
        return UiFollow::Refresh;
    }
    if id == "activate" {
        return UiFollow::Activate;
    }
    if let Some(index) = id
        .strip_prefix("offer:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        confirm_offer(index);
        return UiFollow::Refresh;
    }
    if let Some(index) = id
        .strip_prefix("device:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        STATE.with(|state| {
            let mut s = state.borrow_mut();
            if s.pending.is_none() && index < s.devices.len() {
                s.selected = Some(index);
            }
        });
        render();
        return UiFollow::None;
    }
    if first_step {
        queue_lookup();
        if STATE.with(|state| state.borrow().verifying) {
            finish_lookup();
        } else {
            render();
        }
        return UiFollow::None;
    }
    STATE.with(|state| {
        state.borrow_mut().message = format!("收到点击，但没有对应操作：{id}");
    });
    render();
    UiFollow::None
}
fn bind_root(id: String) {
    STATE.with(|state| state.borrow_mut().root = Some(id));
    render();
}
#[cfg(feature = "api4")]
impl lifecycle::Guest for Kovela {
    // 设备列表只在用户动作后读取，加载时不做任何宿主调用。
    async fn on_load() {}
}
#[cfg(feature = "api4")]
impl event::Guest for Kovela {
    async fn on_event(kind: EventType, payload: String) -> String {
        dispatch_event(kind, payload).await;
        String::new()
    }
    async fn on_ui_event(id: String, event: ui::Event, payload: String) -> String {
        match dispatch_ui(&id, event, &payload) {
            UiFollow::Refresh => begin_scan().await,
            UiFollow::Scan => load_devices().await,
            UiFollow::Activate => start_activation().await,
            UiFollow::None => {}
        }
        String::new()
    }
    // 渲染回调里不做任何宿主调用，也不依赖"导出返回后继续运行"的
    // 后台任务：设备列表一律由用户动作（刷新/输入/激活）触发读取。
    async fn on_ui_render(id: String) {
        bind_root(id);
    }
    async fn on_card_render(_id: String) {}
}
#[cfg(feature = "api4")]
export!(Kovela);
// Level 2/3 的导出都是同步函数，宿主不会驱动 `spawn` 出来的后台任务
// （wit-bindgen 的 spawn 只在导出调用自身的执行期间被轮询），因此所有
// 异步工作必须在导出内用 block_on 跑完。
//
// 返回的 future 只能"永不写入"（mem::forget 写端）：
// - 在导出内 block_on 写它必然死锁——write 要等宿主读，宿主要等导出返回
//   才拿到读端，宿主事件循环会报 "deadlock detected"；
// - 直接 drop 写端也不行——wit-bindgen 的 Drop 会调度用默认值补写，
//   唤醒时在无任务上下文里 panic。
// 宿主并不读取这些返回值，未写入（挂起）正是参考项目在真机上的实际行为。
#[cfg(not(feature = "api4"))]
impl lifecycle::Guest for Kovela {
    // 设备列表只在用户动作后读取，加载时不做任何宿主调用。
    fn on_load() {}
}
#[cfg(not(feature = "api4"))]
impl event_v3::Guest for Kovela {
    fn on_event(kind: EventType, payload: String) -> FutureReader<String> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<String>(String::new);
        astrobox_ng_wit::block_on(async move {
            dispatch_event(kind, payload).await;
        });
        std::mem::forget(writer);
        reader
    }
    fn on_ui_event_v3(id: String, event: ui::Event, payload: String) -> FutureReader<String> {
        let follow = dispatch_ui(&id, event, &payload);
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<String>(String::new);
        astrobox_ng_wit::block_on(async move {
            match follow {
                UiFollow::Refresh => begin_scan().await,
                UiFollow::Scan => load_devices().await,
                UiFollow::Activate => start_activation().await,
                UiFollow::None => {}
            }
        });
        std::mem::forget(writer);
        reader
    }
    fn on_ui_render(id: String) -> FutureReader<()> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<()>(|| ());
        bind_root(id);
        std::mem::forget(writer);
        reader
    }
    fn on_card_render(_id: String) -> FutureReader<()> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<()>(|| ());
        std::mem::forget(writer);
        reader
    }
}
#[cfg(not(feature = "api4"))]
astrobox_ng_wit::export!(Kovela);

#[cfg(test)]
mod tests {
    use super::{normalize_order, parse_offers, remember_order};
    use serde_json::json;

    #[test]
    fn reads_products_returned_for_an_order() {
        let offers = parse_offers(&json!({"items":[{"productId":"com.komoridev.billiard","productName":"口袋台球","handoffToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","boundDeviceId":null}]})).unwrap();
        assert_eq!(offers[0].product_name, "口袋台球");
        assert!(offers[0].bound_device_id.is_none());
    }

    #[test]
    fn rejects_a_lookup_without_products() {
        assert!(parse_offers(&json!({"items":[]})).is_err());
    }
    #[test]
    fn keeps_an_order_number_embedded_in_an_input_event() {
        remember_order(r#"{"value":"订单 202609131234567890123456789"}"#);
        let stored = super::STATE.with(|state| state.borrow().order_no.clone());
        assert_eq!(stored, "202609131234567890123456789");
    }



    #[test]
    fn normalizes_an_order_number() {
        assert_eq!(
            normalize_order(" 202609131234567890123456789 ").unwrap(),
            "202609131234567890123456789"
        );
        assert!(normalize_order("123").is_err());
    }

    #[test]
    fn retries_hello_ten_times_before_giving_up() {
        super::STATE.with(|state| {
            let mut s = state.borrow_mut();
            s.handoff = Some(super::Handoff {
                server_origin: "https://kovela.komoridevs.icu".into(),
                handoff_token: "a".repeat(64),
                product_id: "com.komoridev.billiard".into(),
                product_name: "口袋台球".into(),
            });
            s.pending = Some(super::Pending {
                id: "tick-target".into(),
                addr: "AA:BB:CC:DD".into(),
                device_id: None,
                device_model: None,
                issued: None,
                ack: None,
                reported: false,
                phase: super::Phase::Hello,
                hello_tries: 0,
                install_retries: 0,
            });
        });
        assert!(super::hello_tick("other-pending").is_none());
        for _ in 0..10 {
            let plan = super::hello_tick("tick-target");
            assert!(matches!(plan, Some(Some(_))));
        }
        assert!(matches!(super::hello_tick("tick-target"), Some(None)));
        super::STATE.with(|state| {
            state.borrow_mut().pending.as_mut().unwrap().phase = super::Phase::Complete;
        });
        assert!(super::hello_tick("tick-target").is_none());
    }

    fn pending_at(phase: super::Phase, ack: Option<bool>, reported: bool) -> super::Pending {
        super::Pending {
            id: "pending".into(),
            addr: "addr".into(),
            device_id: None,
            device_model: None,
            issued: Some(super::Issued {
                license_id: "license".into(),
                license_token: "KV1.token".into(),
                receipt_token: "b".repeat(64),
                product_id: "com.komoridev.billiard".into(),
                device_id: "0816d5a8023c11".into(),
            }),
            ack,
            reported,
            phase,
            hello_tries: 0,
            install_retries: 0,
        }
    }

    #[test]
    fn shows_the_binding_state_of_the_chosen_product() {
        let bound = super::Offer {
            product_id: "com.komoridev.billiard".into(),
            product_name: "口袋台球".into(),
            handoff_token: "token".into(),
            bound_device_id: Some("0816d5a8023c11".into()),
        };
        let unbound = super::Offer {
            bound_device_id: None,
            ..bound.clone()
        };
        // 商品由订单号带出，绑定状态也一并来自查询结果。
        assert_eq!(
            super::binding_note(std::slice::from_ref(&bound), "com.komoridev.billiard"),
            "已绑定 0816d5a8023c"
        );
        assert_eq!(
            super::binding_note(std::slice::from_ref(&unbound), "com.komoridev.billiard"),
            "尚未绑定"
        );
        assert_eq!(
            super::binding_note(std::slice::from_ref(&bound), "com.komoridev.other"),
            "尚未绑定"
        );
    }

    #[test]
    fn activation_steps_follow_the_phase() {
        let phases = [
            (super::Phase::Hello, 0),
            (super::Phase::Issuing, 1),
            (super::Phase::Installing, 2),
            (super::Phase::Reporting, 3),
            (super::Phase::Complete, 4),
        ];
        for (phase, expected) in phases {
            let pending = pending_at(phase, None, false);
            assert_eq!(super::activation_step(Some(&pending)), expected);
        }
        assert_eq!(super::activation_step(None), 4);
        // 重试回到最近失败的那一段：回执还没上报就重试上报，否则重发写入，
        // 许可证都没拿到时要从头握手，不能把没走过的段落标成已完成。
        let retry_report = pending_at(super::Phase::Retry, Some(true), false);
        assert_eq!(super::activation_step(Some(&retry_report)), 3);
        let retry_install = pending_at(super::Phase::Retry, Some(false), true);
        assert_eq!(super::activation_step(Some(&retry_install)), 2);
        let retry_connect = super::Pending {
            issued: None,
            ..pending_at(super::Phase::Retry, None, false)
        };
        assert_eq!(super::activation_step(Some(&retry_connect)), 0);
    }

    // 回归守卫：Level 2/3 的导出是同步函数，宿主不会轮询 `spawn` 出来的
    // 后台任务（wit-bindgen 的 spawn 只在孕育它的 async 计算被 crank 期间
    // 运行）。曾因此导致设备扫描从未执行、界面永远停在"正在读取设备列表"。
    // v3 路径的一切异步工作必须走 block_on，这里直接扫源码防止回退。
    #[test]
    fn v3_path_never_spawns_background_tasks() {
        let source = match std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs")) {
            Ok(source) => source,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return; // 发布打包环境里源码不可得时跳过
            }
            Err(error) => panic!("{error}"),
        };
        // 运行时拼装 needle，避免测试源码里的字面量自匹配。
        let runtime = ["astrobox_ng_wit", "wit_bindgen"];
        for crate_name in runtime {
            let call = format!("{crate_name}::spawn(");
            assert!(
                !source.contains(&call),
                "导出里禁止用 spawn 起后台任务：Level 2/3 的同步导出没人轮询这些任务（v4 也不要依赖返回后继续运行的任务），必须 block_on 或内联 await"
            );
        }
        // 返回的 future 绝不能在导出内写入：write 要等宿主读、宿主要等导出
        // 返回，循环等待会触发宿主 "deadlock detected" trap；drop 写端也会
        // 因 wit-bindgen 的补写 panic。只能 mem::forget 让它保持挂起。
        let write_call = format!("writer.{}", "write(");
        assert!(
            !source.contains(&write_call),
            "禁止在导出内 block_on 写返回的 future（死锁），也不能 drop 写端（panic），只能 mem::forget"
        );
    }
}
