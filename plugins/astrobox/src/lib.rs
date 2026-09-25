#[cfg(feature = "api4")]
wit_bindgen::generate!({
    path: "wit",
    world: "kovela",
    generate_all,
});

#[cfg(feature = "api4")]
use astrobox::psys_host_v4::{device, interconnect, notification, register, timer, ui};
#[cfg(feature = "api4")]
use exports::astrobox::psys_plugin_v4::{
    event::{self, EventType},
    lifecycle,
};
#[cfg(not(feature = "api4"))]
use astrobox_ng_wit::FutureReader;
#[cfg(not(feature = "api4"))]
use astrobox_ng_wit::astrobox::psys_host::{device, interconnect, register, timer, ui_v3 as ui};
#[cfg(not(feature = "api4"))]
use astrobox_ng_wit::exports::astrobox::psys_plugin::{
    event_v3::{self, EventType},
    lifecycle,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{cell::RefCell, time::Duration};
use uuid::Uuid;

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
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
struct Kovela;
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
        Err("请输入 16～32 位数字的爱发电订单号。".into())
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
        return Err("订单响应格式错误。".into());
    };
    if items.is_empty() || items.len() > 8 {
        return Err("订单响应格式错误。".into());
    }
    let mut offers: Vec<Offer> = Vec::new();
    for item in items {
        let product_id = item.get("productId").and_then(Value::as_str).unwrap_or("");
        let product_name = item.get("productName").and_then(Value::as_str).unwrap_or("");
        let token = item.get("handoffToken").and_then(Value::as_str).unwrap_or("");
        let name = usable_label(product_name);
        if !valid_product_id(product_id) || name.is_none() || !is_hex(token) {
            return Err("订单响应与授权服务不匹配。".into());
        }
        if offers.iter().any(|offer| offer.product_id == product_id) {
            return Err("订单响应与授权服务不匹配。".into());
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
fn render() {
    let (root, message, offers, verifying, handoff, devices, selected, phase, device_note) =
        STATE.with(|state| {
            let s = state.borrow();
            (
                s.root.clone(),
                s.message.clone(),
                s.offers.clone(),
                s.verifying,
                s.handoff.clone(),
                s.devices.clone(),
                s.selected,
                s.pending.as_ref().map(|pending| pending.phase),
                s.device_note.clone(),
            )
        });
    let Some(root) = root else { return };
    let active = phase.is_some_and(|phase| !matches!(phase, Phase::Retry | Phase::Complete));
    let complete = phase == Some(Phase::Complete);
    let has_pending = phase.is_some();
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
    } else if verifying {
        "正在查询".to_string()
    } else {
        "输入订单号".to_string()
    };
    let mut page = ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .flex_direction(ui::FlexDirection::Column)
        .gap(12)
        .padding(4)
        .width_full();
    page = page.child(ui::Element::new(ui::ElementType::P, Some(&heading)).size(22));
    if !message.is_empty() {
        page = page.child(ui::Element::new(ui::ElementType::P, Some(&message)).size(16));
    } else if handoff.is_none() && offers.is_empty() {
        page = page.child(
            ui::Element::new(ui::ElementType::P, Some("填写爱发电订单号，点查询。")).size(14),
        );
    }
    if let Some(value) = progress {
        let label = value.to_string();
        page = page.child(
            ui::Element::new(ui::ElementType::Progress, None)
                .width_full()
                .prop("max", "100")
                .prop("value", &label),
        );
    }
    page = page
        .child(gate(
            ui::Element::new(ui::ElementType::Textarea, None)
                .height(48)
                .width_full()
                .prop("placeholder", "爱发电订单号")
                .on(ui::Event::Input, "order-input"),
            ui_locked,
        ))
        .child(gate(
            ui::Element::new(
                ui::ElementType::Button,
                Some(if verifying { "查询中…" } else { "查询订单" }),
            )
            .bg("#7c3aed")
            .text_color("#ffffff")
            .width_full()
            .on(ui::Event::Click, "verify"),
            ui_locked,
        ));
    for (index, offer) in offers.iter().enumerate() {
        let chosen = handoff
            .as_ref()
            .is_some_and(|item| item.product_id == offer.product_id);
        let label = match offer.bound_device_id.as_deref() {
            Some(id) => format!(
                "{} {} · {}…",
                if chosen { "已确认" } else { "确认" },
                offer.product_name,
                &id[..12]
            ),
            None => format!(
                "{} {}",
                if chosen { "已确认" } else { "确认" },
                offer.product_name
            ),
        };
        let mut button = ui::Element::new(ui::ElementType::Button, Some(&label))
            .width_full()
            .on(ui::Event::Click, &format!("offer:{index}"));
        if chosen {
            button = button.bg("#7c3aed").text_color("#ffffff");
        }
        page = page.child(gate(button, ui_locked));
    }
    if handoff.is_some() {
        page = page
            .child(ui::Element::new(ui::ElementType::Separator, None).width_full())
            .child(ui::Element::new(ui::ElementType::P, Some("选择手环")).size(16));
        if devices.is_empty() {
            let note = if device_note.is_empty() {
                "还没有已连接的手环。请先在 AstroBox 里连接设备。"
            } else {
                device_note.as_str()
            };
            page = page.child(ui::Element::new(ui::ElementType::P, Some(note)).size(14));
        }
        for (index, (addr, name)) in devices.iter().enumerate() {
            let label = if name.trim().is_empty() {
                addr.clone()
            } else if selected == Some(index) {
                format!("已选择 {name}")
            } else {
                name.clone()
            };
            let mut button = ui::Element::new(ui::ElementType::Button, Some(&label))
                .width_full()
                .on(ui::Event::Click, &format!("device:{index}"));
            if selected == Some(index) {
                button = button.bg("#7c3aed").text_color("#ffffff");
            }
            if has_pending {
                button = button.disabled();
            }
            page = page.child(button);
        }
        let action = if complete {
            "已激活"
        } else if has_pending {
            "重试"
        } else {
            "激活"
        };
        page = page
            .child(gate(
                ui::Element::new(ui::ElementType::Button, Some("刷新设备"))
                    .width_full()
                    .on(ui::Event::Click, "refresh"),
                ui_locked,
            ))
            .child(gate(
                ui::Element::new(ui::ElementType::Button, Some(action))
                    .bg("#7c3aed")
                    .text_color("#ffffff")
                    .width_full()
                    .on(ui::Event::Click, "activate"),
                ui_locked || complete || selected.is_none(),
            ));
    }
    ui::render(&root, page);
}

async fn load_devices() {
    let connected = device::get_connected_device_list()
        .await
        .into_iter()
        .map(|device| (device.addr, device.name))
        .collect::<Vec<_>>();
    let note = if connected.is_empty() {
        let known = device::get_device_list()
            .await
            .into_iter()
            .map(|device| {
                let name = device.name.trim();
                if name.is_empty() {
                    device.addr
                } else {
                    format!("{name} · {}", device.addr)
                }
            })
            .take(3)
            .collect::<Vec<_>>();
        if known.is_empty() {
            "已刷新。没有已连接设备，也没有历史记录。请在 AstroBox 设备列表里连接手环，并在手环上确认。".into()
        } else {
            format!(
                "已刷新。没有已连接设备。历史记录：{}。请在 AstroBox 设备页点连接，而不是只打开手环激活页。",
                known.join("；")
            )
        }
    } else {
        format!(
            "已刷新，找到 {} 台已连接设备。选择一台后再激活。",
            connected.len()
        )
    };
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        let replace = s
            .pending
            .as_ref()
            .is_none_or(|pending| matches!(pending.phase, Phase::Retry | Phase::Complete));
        if replace {
            s.selected = None;
            s.devices = connected;
            s.device_note = note;
        }
    });
    render();
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
        .body(serde_json::to_vec(&body).map_err(|_| "请求编码失败。")?)
        .send()
        .map_err(|_| "无法连接授权服务，请检查网络并重试。")?;
    let status = response.status_code();
    let bytes = response
        .body()
        .map_err(|_| "授权服务响应不完整，请重试。")?;
    if bytes.len() > 16384 {
        return Err("授权服务响应过长。".into());
    }
    if !(200..300).contains(&status) {
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        return Err(value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .filter(|s| s.len() < 512)
            .unwrap_or("授权请求失败，请重新验证订单。")
            .into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "授权服务响应格式错误。".into())
}
fn show(message: impl Into<String>) {
    STATE.with(|state| state.borrow_mut().message = message.into());
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
            "已确认 {}。此应用已绑定设备 {}…，只能为同一设备重新传输。",
            offer.product_name,
            &id[..12]
        ),
        None => format!("已确认 {}。请选择手环并激活。", offer.product_name),
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
                let count = offers.len();
                STATE.with(|state| {
                    let mut s = state.borrow_mut();
                    s.verifying = false;
                    s.pending = None;
                    s.handoff = None;
                    s.offers = offers;
                    s.message = format!("查到 {count} 个应用。请点确认。");
                });
                render();
            }
            Err(error) => {
                STATE.with(|state| state.borrow_mut().verifying = false);
                show(error);
            }
        },
        Err(error) => {
            let error = if error.contains("接口不存在") {
                "授权服务还没有订单查询接口。插件已更新，需要先部署新的 Worker。".into()
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
        "许可证已签发，正在等待设备验签并保存…",
    ) {
        return;
    }
    render();
    let data=json!({"v":1,"id":pending.id,"type":"install-license","licenseId":issued.license_id,"licenseToken":issued.license_token}).to_string();
    if host_send(&pending.addr, &issued.product_id, &data)
        .await
        .is_err()
    {
        fail("许可证传输失败。请打开手环应用、检查连接，然后重试当前激活。");
        return;
    }
    host_timeout(30_000, &format!("install:{}", pending.id)).await;
}

async fn start_activation() {
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
        let (addr, _) = s.devices.get(s.selected?)?.clone();
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
        });
        s.message = "正在读取手环应用的设备标识…".into();
        Some((handoff, addr, id))
    });
    let Some((handoff, addr, id)) = selection else {
        fail("请先查询并确认订单，并选择设备。");
        return;
    };
    render();
    if host_register_recv(&addr, &handoff.product_id)
        .await
        .is_err()
    {
        fail("无法订阅设备回执，请授予消息接收权限后重试。");
        return;
    }
    let message = json!({"v":1,"id":id,"type":"hello"}).to_string();
    if host_send(&addr, &handoff.product_id, &message)
        .await
        .is_err()
    {
        fail(format!(
            "无法连接{}。请确认已安装新版应用并在手环上打开。",
            handoff.product_name
        ));
        return;
    }
    host_timeout(20_000, &format!("hello:{id}")).await;
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
            body: "许可证已保存在手环上，现在可以离线使用。".into(),
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
            "设备已确认激活，正在提交回执…"
        } else {
            "设备激活失败，正在提交结果…"
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
                        "激活成功，爱发电私信已发送。现在可离线使用应用。"
                    } else {
                        "激活成功，爱发电私信已进入发送队列。不影响离线使用。"
                    }
                } else {
                    "手环未能完成激活。请检查设备提示，修复后重试。"
                }
                .into();
            });
            render();
        }
        _ => fail(if success {
            "设备已激活，但回执未能提交。请保持插件打开并点击重试，不需要重新购买。"
        } else {
            "设备激活失败，回执尚未提交，请重试。"
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
            fail("设备没有提供有效标识，请检查权限。");
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
            fail("连接到了不匹配的应用。");
            return;
        }
        set_phase(
            &pending.id,
            Phase::Issuing,
            "正在向授权服务申请设备绑定许可证…",
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
            Ok(_) => fail("许可证响应与所选设备不匹配。"),
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

async fn startup() {
    load_devices().await;
}
async fn dispatch_event(kind: EventType, payload: String) {
    match kind {
        EventType::InterconnectMessage => on_device_message(&payload).await,
        EventType::Timer => {
            let body = timer_body(&payload);
            let waiting = STATE.with(|state| {
                let s = state.borrow();
                s.pending.as_ref().is_some_and(|p| {
                    (p.phase == Phase::Hello && body == format!("hello:{}", p.id))
                        || (p.phase == Phase::Installing && body == format!("install:{}", p.id))
                })
            });
            if waiting {
                fail("等待设备回执超时。请保持手环应用打开并重试；尚未确认激活成功。");
            }
        }
        _ => {}
    }
}
enum UiFollow {
    None,
    Refresh,
    Activate,
}
fn dispatch_ui(id: &str, event: ui::Event, payload: &str) -> UiFollow {
    if matches!(
        event,
        ui::Event::Input | ui::Event::Change | ui::Event::Blur
    ) {
        remember_order(payload);
        return UiFollow::None;
    }
    if !matches!(event, ui::Event::Click) || locked() {
        return UiFollow::None;
    }
    remember_order(payload);
    let first_step = STATE.with(|state| {
        let state = state.borrow();
        state.offers.is_empty() && state.handoff.is_none()
    });
    let known = id == "verify"
        || id == "refresh"
        || id == "activate"
        || id.starts_with("offer:")
        || id.starts_with("device:");
    if id == "verify" || id == "查询订单" || (first_step && !known) {
        queue_lookup();
        if STATE.with(|state| state.borrow().verifying) {
            finish_lookup();
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
        return UiFollow::None;
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
    async fn on_load() {
        startup().await;
    }
}
#[cfg(feature = "api4")]
impl event::Guest for Kovela {
    async fn on_event(kind: EventType, payload: String) -> String {
        dispatch_event(kind, payload).await;
        String::new()
    }
    async fn on_ui_event(id: String, event: ui::Event, payload: String) -> String {
        match dispatch_ui(&id, event, &payload) {
            UiFollow::Refresh => load_devices().await,
            UiFollow::Activate => start_activation().await,
            UiFollow::None => {}
        }
        String::new()
    }
    async fn on_ui_render(id: String) {
        bind_root(id);
    }
    async fn on_card_render(_id: String) {}
}
#[cfg(feature = "api4")]
export!(Kovela);
#[cfg(not(feature = "api4"))]
impl lifecycle::Guest for Kovela {
    fn on_load() {
        astrobox_ng_wit::spawn(async { startup().await });
    }
}
#[cfg(not(feature = "api4"))]
impl event_v3::Guest for Kovela {
    fn on_event(kind: EventType, payload: String) -> FutureReader<String> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<String>(String::new);
        astrobox_ng_wit::spawn(async move {
            dispatch_event(kind, payload).await;
            let _ = writer.write(String::new()).await;
        });
        reader
    }
    fn on_ui_event_v3(id: String, event: ui::Event, payload: String) -> FutureReader<String> {
        let follow = dispatch_ui(&id, event, &payload);
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<String>(String::new);
        astrobox_ng_wit::spawn(async move {
            match follow {
                UiFollow::Refresh => load_devices().await,
                UiFollow::Activate => start_activation().await,
                UiFollow::None => {}
            }
            let _ = writer.write(String::new()).await;
        });
        reader
    }
    fn on_ui_render(id: String) -> FutureReader<()> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<()>(|| ());
        bind_root(id);
        astrobox_ng_wit::spawn(async move {
            let _ = writer.write(()).await;
        });
        reader
    }
    fn on_card_render(_id: String) -> FutureReader<()> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<()>(|| ());
        astrobox_ng_wit::spawn(async move {
            let _ = writer.write(()).await;
        });
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

}
