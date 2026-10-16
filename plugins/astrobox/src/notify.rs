//! 设备通知与实时活动（Level 4，`astrobox:psys-host-v4/notification`）。
//!
//! 全部调用都是尽力而为：设备不支持小米通知协议、用户没给 `notification`
//! 权限、传输失败，都只影响这一条通知，不影响激活本身。成功也只表示已入队，
//! 不等于设备已经显示。
//!
//! 宿主导入在宿主目标上不存在，所以单元测试（`cargo test`）里这些函数是空
//! 操作，真机行为以 api4 构建为准——与仓库里其它宿主调用同样的处理。

/// 实时活动的通知 ID：同一个插件内 id 相同即更新，撤回也用这个 id。
#[cfg(all(feature = "api4", not(test)))]
pub(crate) const LIVE_ID: u32 = 1;
/// 激活结果通知的 ID（与实时活动分开，避免结果被后续更新覆盖）。
#[cfg(all(feature = "api4", not(test)))]
const RESULT_ID: u32 = 2;

/// 激活的四段动作，和插件里的进度条一一对应。
#[cfg(feature = "api4")]
const STEPS: [&str; 4] = ["连接设备", "签发许可证", "写入设备", "提交回执"];

/// 焦点通知（focus）的 style 是协议原值，官方文档明确要求「使用目标设备已经
/// 确认支持的取值」，跨型号没有保证。真机确认前先用 0；换机型或设备固件升级
/// 后只改这一行，不必动调用点。
#[cfg(all(feature = "api4", not(test)))]
const FOCUS_STYLE: u32 = 0;

#[cfg(all(feature = "api4", not(test)))]
mod host {
    use super::{FOCUS_STYLE, LIVE_ID, RESULT_ID, STEPS};
    use crate::astrobox::psys_host_v4::notification;

    fn text(chars: &str) -> notification::Text {
        notification::Text { chars: chars.to_string(), color: None }
    }

    /// 开始或更新实时活动：同一 id 反复调用即为更新，`sequence` 需要递增。
    pub(crate) async fn live(addr: &str, product: &str, step: usize, note: &str, sequence: u32) {
        let index = step.min(STEPS.len() - 1);
        let message = notification::Message {
            id: LIVE_ID,
            app_name: "Kovela".into(),
            title: product.to_string(),
            sub_title: String::new(),
            body: note.to_string(),
            timestamp_ms: None,
            live_activity: Some(notification::LiveActivity::Focus(notification::Focus {
                style: FOCUS_STYLE,
                title: text(product),
                content: text(STEPS[index]),
                desc: text(note),
                progress: Some(notification::Progress {
                    section_count: STEPS.len() as u32,
                    progress: index as u32,
                    color: None,
                }),
                // 每次都要声明可更新并递增 sequence，否则宿主按新通知处理。
                updatable: true,
                sequence,
            })),
        };
        let _ = notification::send(addr.to_string(), message).await;
    }

    /// 撤回实时活动。
    pub(crate) async fn clear(addr: &str) {
        let _ = notification::remove(addr.to_string(), LIVE_ID).await;
    }

    /// 激活成功的设备通知，随后撤回实时活动。
    pub(crate) async fn activated(addr: &str, product: &str) {
        let message = notification::Message {
            id: RESULT_ID,
            app_name: "Kovela".into(),
            title: format!("{product}已激活"),
            sub_title: String::new(),
            body: "许可证已保存在手环上，可离线使用".into(),
            timestamp_ms: None,
            live_activity: None,
        };
        let _ = notification::send(addr.to_string(), message).await;
        clear(addr).await;
    }
}

#[cfg(all(feature = "api4", not(test)))]
pub(crate) use host::{activated, clear, live};

#[cfg(any(not(feature = "api4"), test))]
pub(crate) async fn live(_addr: &str, _product: &str, _step: usize, _note: &str, _sequence: u32) {}
#[cfg(any(not(feature = "api4"), test))]
pub(crate) async fn clear(_addr: &str) {}
#[cfg(any(not(feature = "api4"), test))]
pub(crate) async fn activated(_addr: &str, _product: &str) {}

#[cfg(all(test, feature = "api4"))]
mod tests {
    use super::STEPS;

    #[test]
    fn step_labels_cover_the_activation_progress() {
        // 进度条与实时活动的分段数一致：越界的步骤会落到最后一段，不 panic。
        assert_eq!(STEPS.len(), 4);
        assert_eq!(STEPS[3.min(STEPS.len() - 1)], "提交回执");
        assert_eq!(7.min(STEPS.len() - 1), 3);
    }
}
