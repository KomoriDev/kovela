use astrobox_ng_wit::FutureReader;
use astrobox_ng_wit::astrobox::psys_host::{device, interconnect, register, timer, ui_v3 as ui};
use astrobox_ng_wit::exports::astrobox::psys_plugin::{
    event_v3::{self, EventType},
    lifecycle,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{cell::RefCell, time::Duration};
use url::Url;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Handoff {
    v: u8,
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
#[derive(Default)]
struct State {
    root: Option<String>,
    input: String,
    handoff: Option<Handoff>,
    devices: Vec<(String, String)>,
    selected: Option<usize>,
    pending: Option<Pending>,
    message: String,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
struct Kovela;

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

fn parse_handoff(input: &str) -> Result<Handoff, String> {
    if input.len() > 4096 {
        return Err("激活链接过长。".into());
    }
    let owned;
    let source = if input.trim().starts_with("astrobox://") {
        let url = Url::parse(input.trim()).map_err(|_| "激活链接格式错误。")?;
        if url.host_str() != Some("open") {
            return Err("这不是 Kovela 激活链接。".into());
        }
        let mut named = false;
        let mut payload = None;
        let mut legacy = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "name" | "pluginName" if value == "Kovela" => named = true,
                "payload" => payload = Some(value.into_owned()),
                "data" => legacy = Some(value.into_owned()),
                _ => {}
            }
        }
        if !named {
            return Err("这不是 Kovela 激活链接。".into());
        }
        owned = payload.or(legacy).ok_or("激活链接缺少凭证。")?;
        owned.as_str()
    } else {
        input.trim()
    };
    let handoff: Handoff =
        serde_json::from_str(source).map_err(|_| "请粘贴网页提供的完整激活链接。")?;
    let origin = Url::parse(&handoff.server_origin).map_err(|_| "服务地址无效。")?;
    let local = cfg!(debug_assertions)
        && origin.scheme() == "http"
        && matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if handoff.v != 2
        || handoff.product_id.len() > 128
        || !handoff.product_id.contains('.')
        || !handoff.product_id.split('.').all(|part| {
            part.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
        })
        || handoff.product_name.trim().is_empty()
        || handoff.product_name.chars().count() > 80
        || !is_hex(&handoff.handoff_token)
        || (!local && origin.scheme() != "https")
        || origin.origin().ascii_serialization() != handoff.server_origin
    {
        return Err("仅接受可信 HTTPS 服务的有效激活链接，请在网页重新验证订单。".into());
    }
    Ok(handoff)
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

fn render() {
    let (root, message, server, product, devices, selected, active, has_pending, complete) = STATE
        .with(|state| {
            let s = state.borrow();
            (
                s.root.clone(),
                s.message.clone(),
                s.handoff.as_ref().map(|h| h.server_origin.clone()),
                s.handoff
                    .as_ref()
                    .map(|h| format!("{} · 设备授权", h.product_name)),
                s.devices.clone(),
                s.selected,
                s.pending
                    .as_ref()
                    .is_some_and(|p| !matches!(p.phase, Phase::Retry | Phase::Complete)),
                s.pending.is_some(),
                s.pending
                    .as_ref()
                    .is_some_and(|p| p.phase == Phase::Complete),
            )
        });
    let Some(root) = root else {
        return;
    };
    let mut page = ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .flex_direction(ui::FlexDirection::Column)
        .gap(14)
        .padding(20)
        .width_full();
    page = page.child(
        ui::Element::new(ui::ElementType::P, Some("Kovela"))
            .size(28)
            .text_color("#8b5cf6"),
    );
    page = page.child(
        ui::Element::new(
            ui::ElementType::P,
            Some(product.as_deref().unwrap_or("MI-VELA 应用授权")),
        )
        .size(18),
    );
    page = page.child(ui::Element::new(
        ui::ElementType::P,
        Some("先在网页验证订单，再点击一键激活，或在下面粘贴完整链接。请保持手环应用打开。"),
    ));
    if let Some(server) = server {
        page = page.child(
            ui::Element::new(
                ui::ElementType::P,
                Some(&format!(
                    "授权服务：{server}\n请核对域名。点击激活将向此服务提交设备标识。"
                )),
            )
            .text_color("#8b5cf6"),
        );
    }
    let mut input = ui::Element::new(ui::ElementType::Textarea, None)
        .height(80)
        .width_full()
        .on(ui::Event::Input, "handoff-input");
    if active {
        input = input.disabled();
    }
    page = page.child(input);
    let mut load = ui::Element::new(ui::ElementType::Button, Some("读取激活链接"))
        .on(ui::Event::Click, "load-link");
    let mut refresh = ui::Element::new(ui::ElementType::Button, Some("刷新已连接设备"))
        .on(ui::Event::Click, "refresh");
    if active {
        load = load.disabled();
        refresh = refresh.disabled();
    }
    page = page.child(load).child(refresh);
    if devices.is_empty() {
        page = page.child(ui::Element::new(
            ui::ElementType::P,
            Some("尚未找到已连接设备。请先在 AstroBox 连接手环，并允许设备权限。"),
        ));
    }
    for (index, (addr, name)) in devices.iter().enumerate() {
        let title = format!(
            "{} {} · {}",
            if selected == Some(index) {
                "已选择"
            } else {
                "选择"
            },
            name,
            addr
        );
        let mut button = ui::Element::new(ui::ElementType::Button, Some(&title))
            .on(ui::Event::Click, &format!("device:{index}"));
        if selected == Some(index) {
            button = button.bg("#7c3aed").text_color("#ffffff");
        }
        if has_pending {
            button = button.disabled();
        }
        page = page.child(button);
    }
    let title = if complete {
        "设备已激活"
    } else if has_pending {
        "重试当前激活"
    } else {
        "信任此服务，激活所选设备"
    };
    let mut activate = ui::Element::new(ui::ElementType::Button, Some(title))
        .bg("#7c3aed")
        .text_color("#ffffff")
        .on(ui::Event::Click, "activate");
    if active || complete || selected.is_none() {
        activate = activate.disabled();
    }
    page = page.child(activate);
    if !message.is_empty() {
        page = page.child(ui::Element::new(ui::ElementType::P, Some(&message)));
    }
    page=page.child(ui::Element::new(ui::ElementType::P,Some("许可证由服务器签发，手环独立验签。插件不持有签发私钥，消息发送完成不代表设备已激活。"))).size(12);
    ui::render(&root, page);
}

async fn load_devices() {
    let devices = device::get_connected_device_list().await;
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        if s.pending.is_none() {
            s.selected = None;
            s.devices = devices.into_iter().map(|d| (d.addr, d.name)).collect();
        }
    });
    render();
}
fn accept_link(input: &str) {
    if busy() {
        return;
    }
    match parse_handoff(input) {
        Ok(handoff) => STATE.with(|state| {
            let mut s = state.borrow_mut();
            s.handoff = Some(handoff);
            s.pending = None;
            s.message = "请核对授权服务域名，并选择需要激活的设备。".into();
        }),
        Err(error) => {
            fail(error);
            return;
        }
    }
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
    if interconnect::send_qaic_message(&pending.addr, &issued.product_id, &data)
        .await
        .is_err()
    {
        fail("许可证传输失败。请打开手环应用、检查连接，然后重试当前激活。");
        return;
    }
    timer::set_timeout(30_000, &format!("install:{}", pending.id)).await;
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
        fail("请先读取有效激活链接，并选择设备。");
        return;
    };
    render();
    if register::register_interconnect_recv(&addr, &handoff.product_id)
        .await
        .is_err()
    {
        fail("无法订阅设备回执，请授予消息接收权限后重试。");
        return;
    }
    let message = json!({"v":1,"id":id,"type":"hello"}).to_string();
    if interconnect::send_qaic_message(&addr, &handoff.product_id, &message)
        .await
        .is_err()
    {
        fail(format!(
            "无法连接{}。请确认已安装新版应用并在手环上打开。",
            handoff.product_name
        ));
        return;
    }
    timer::set_timeout(20_000, &format!("hello:{id}")).await;
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

impl lifecycle::Guest for Kovela {
    fn on_load() {
        astrobox_ng_wit::spawn(async {
            if register::register_deeplink_action().await.is_err() {
                fail("无法注册网页唤起，请允许 Deeplink 权限或手动粘贴激活链接。");
            }
            load_devices().await;
        });
    }
}
impl event_v3::Guest for Kovela {
    fn on_event(kind: EventType, payload: String) -> FutureReader<String> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<String>(String::new);
        astrobox_ng_wit::spawn(async move {
            match kind {
                EventType::DeeplinkAction => {
                    accept_link(&payload);
                    load_devices().await;
                }
                EventType::InterconnectMessage => on_device_message(&payload).await,
                EventType::Timer => {
                    if let Ok(value) = serde_json::from_str::<Value>(&payload) {
                        if let Some(payload) = value.get("payload").and_then(Value::as_str) {
                            let waiting = STATE.with(|state| {
                                let s = state.borrow();
                                s.pending.as_ref().is_some_and(|p| {
                                    (p.phase == Phase::Hello
                                        && payload == format!("hello:{}", p.id))
                                        || (p.phase == Phase::Installing
                                            && payload == format!("install:{}", p.id))
                                })
                            });
                            if waiting {
                                fail(
                                    "等待设备回执超时。请保持手环应用打开并重试；尚未确认激活成功。",
                                );
                            }
                        }
                    }
                }
                _ => {}
            }
            let _ = writer.write(String::new()).await;
        });
        reader
    }
    fn on_ui_event_v3(id: String, event: ui::Event, payload: String) -> FutureReader<String> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<String>(String::new);
        astrobox_ng_wit::spawn(async move {
            if matches!(event, ui::Event::Input)
                && id == "handoff-input"
                && !busy()
                && payload.len() <= 8192
            {
                let parsed = serde_json::from_str::<Value>(&payload).ok();
                let text = parsed
                    .as_ref()
                    .and_then(|v| {
                        v.get("value")
                            .and_then(Value::as_str)
                            .or_else(|| v.as_str())
                    })
                    .unwrap_or(&payload);
                STATE.with(|state| state.borrow_mut().input = text.into());
            }
            if matches!(event, ui::Event::Click) && !busy() {
                match id.as_str() {
                    "load-link" => {
                        let input = STATE.with(|state| state.borrow().input.clone());
                        accept_link(&input);
                        load_devices().await;
                    }
                    "refresh" => load_devices().await,
                    "activate" => start_activation().await,
                    _ => {
                        if let Some(index) = id
                            .strip_prefix("device:")
                            .and_then(|s| s.parse::<usize>().ok())
                        {
                            STATE.with(|state| {
                                let mut s = state.borrow_mut();
                                if s.pending.is_none() && index < s.devices.len() {
                                    s.selected = Some(index);
                                }
                            });
                            render();
                        }
                    }
                }
            }
            let _ = writer.write(String::new()).await;
        });
        reader
    }
    fn on_ui_render(id: String) -> FutureReader<()> {
        let (writer, reader) = astrobox_ng_wit::wit_future::new::<()>(|| ());
        STATE.with(|state| state.borrow_mut().root = Some(id));
        render();
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
astrobox_ng_wit::export!(Kovela);

#[cfg(test)]
mod tests {
    use super::parse_handoff;

    const BODY: &str = r#"{"v":2,"serverOrigin":"https://kovela.komoridevs.icu","handoffToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","productId":"com.komoridev.billiard","productName":"口袋台球"}"#;

    fn link(pairs: &[(&str, &str)]) -> String {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(pairs)
            .finish();
        format!("astrobox://open?{query}")
    }

    #[test]
    fn accepts_payload_json_from_the_host_event() {
        let handoff = parse_handoff(BODY).unwrap();
        assert_eq!(handoff.product_id, "com.komoridev.billiard");
        assert_eq!(handoff.product_name, "口袋台球");
    }

    #[test]
    fn accepts_plugdata_link() {
        let handoff = parse_handoff(&link(&[
            ("source", "plugdata"),
            ("name", "Kovela"),
            ("payload", BODY),
        ]))
        .unwrap();
        assert_eq!(handoff.server_origin, "https://kovela.komoridevs.icu");
    }

    #[test]
    fn still_accepts_legacy_open_plugin_link() {
        let handoff = parse_handoff(&link(&[
            ("source", "openPlugin"),
            ("pluginName", "Kovela"),
            ("data", BODY),
        ]))
        .unwrap();
        assert_eq!(handoff.handoff_token.len(), 64);
    }

    #[test]
    fn rejects_a_different_plugin_name() {
        let error = parse_handoff(&link(&[
            ("source", "plugdata"),
            ("name", "Other"),
            ("payload", BODY),
        ]))
        .unwrap_err();
        assert!(error.contains("Kovela"));
    }
}
