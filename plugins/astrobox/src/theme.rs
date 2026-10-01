//! Material Design 3（M3）令牌与插件 UI 的控件构造器。
//!
//! 宿主把插件页面固定在深色容器里渲染：前端组件写死 `appearance="dark"`、
//! `bg-[#191919]`、`text-white`，容器本身不跟随 `os.appearance()`——那个接口
//! 返回的是宿主应用级主题，用在插件页上会在应用处于浅色时画出一张亮卡片。
//! 因此这里只实现 M3 深色方案，配色取 Material 3 baseline 紫（色相与品牌
//! #7C3AED 一致，深浅两档都能保证与白/深色文字的对比度）。
//!
//! 宿主用 Radix Themes 渲染这些元素，`bg`/`text-color`/`radius`/`border` 等
//! 都会变成行内样式，因此行内样式能压过组件默认样式；复合控件（TEXTAREA、
//! PROGRESS 之类）的样式落在组件根节点上，不是内部的原生控件。

use crate::{ServiceStatus, SERVICE_STATUS_EVENT, ui};

/// M3 深色配色角色，名称沿用 Material 3 的 token 名。
pub(crate) mod color {
    pub(crate) const PRIMARY: &str = "#d0bcff";
    pub(crate) const ON_PRIMARY: &str = "#381e72";
    pub(crate) const SECONDARY_CONTAINER: &str = "#4a4458";
    pub(crate) const ON_SECONDARY_CONTAINER: &str = "#e8def8";
    pub(crate) const SURFACE_CONTAINER_LOW: &str = "#1d1b20";
    pub(crate) const SURFACE_CONTAINER: &str = "#211f26";
    pub(crate) const SURFACE_CONTAINER_HIGH: &str = "#2b2930";
    pub(crate) const ON_SURFACE: &str = "#e6e0e9";
    pub(crate) const ON_SURFACE_VARIANT: &str = "#cac4d0";
    pub(crate) const OUTLINE_VARIANT: &str = "#49454f";
    pub(crate) const TRANSPARENT: &str = "transparent";
    pub(crate) const SUCCESS_CONTAINER: &str = "#1f3b2a";
    pub(crate) const ON_SUCCESS_CONTAINER: &str = "#b7f7c8";
    pub(crate) const ERROR_CONTAINER: &str = "#5a1f25";
    pub(crate) const ON_ERROR_CONTAINER: &str = "#ffdada";
}

/// M3 圆角等级（4 / 8 / 12 / 16 / 20 dp）。
pub(crate) mod shape {
    pub(crate) const EXTRA_SMALL: u32 = 4;
    pub(crate) const SMALL: u32 = 8;
    pub(crate) const MEDIUM: u32 = 12;
    pub(crate) const LARGE: u32 = 16;
    /// M3 标准按钮是全圆角药丸形。
    pub(crate) const FULL: u32 = 20;
}

/// 用到的 M3 字号（dp）：titleLarge / titleMedium / bodyMedium / labelMedium。
pub(crate) mod type_scale {
    pub(crate) const TITLE_LARGE: u32 = 22;
    pub(crate) const TITLE_MEDIUM: u32 = 16;
    pub(crate) const BODY_MEDIUM: u32 = 14;
    pub(crate) const LABEL_MEDIUM: u32 = 12;
}

/// M3 的 4dp 间距栅格。
pub(crate) mod space {
    pub(crate) const ONE: u32 = 4;
    pub(crate) const TWO: u32 = 8;
    pub(crate) const THREE: u32 = 12;
    pub(crate) const FOUR: u32 = 16;
}

/// M3 标准缓动（standard easing）下的颜色过渡。
const TRANSITION: &str = "background-color 200ms cubic-bezier(0.2, 0, 0, 1), \
                          color 200ms cubic-bezier(0.2, 0, 0, 1), \
                          border-color 200ms cubic-bezier(0.2, 0, 0, 1)";

const BUTTON_HEIGHT: u32 = 40;
const FIELD_HEIGHT: u32 = 56;
const PROGRESS_HEIGHT: u32 = 4;
const LINK_HEIGHT: u32 = 32;

/// 插件页面的最外层容器：内容卡片 + 卡片下方的页脚，贴着宿主的深色底。
pub(crate) fn shell() -> ui::Element {
    ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .flex_direction(ui::FlexDirection::Column)
        .gap(space::TWO)
        .width_full()
}

/// 内容卡片：M3 surface container（低）+ 描边。
pub(crate) fn page() -> ui::Element {
    ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .flex_direction(ui::FlexDirection::Column)
        .gap(space::THREE)
        .padding(space::FOUR)
        .width_full()
        .bg(color::SURFACE_CONTAINER_LOW)
        .radius(shape::LARGE)
        .border(1, color::OUTLINE_VARIANT)
}

/// M3 titleLarge：页面标题。
pub(crate) fn headline(text: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::P, Some(text))
        .size(type_scale::TITLE_LARGE)
        .text_color(color::ON_SURFACE)
}

/// M3 titleMedium：卡片标题。
pub(crate) fn section(text: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::P, Some(text))
        .size(type_scale::TITLE_MEDIUM)
        .text_color(color::ON_SURFACE)
}

/// M3 bodyMedium：正文。
pub(crate) fn body(text: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::P, Some(text))
        .size(type_scale::BODY_MEDIUM)
        .text_color(color::ON_SURFACE)
}

/// M3 labelMedium：辅助说明。
pub(crate) fn label(text: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::P, Some(text))
        .size(type_scale::LABEL_MEDIUM)
        .text_color(color::ON_SURFACE_VARIANT)
}

/// 状态行：M3 surface container（高）底色的提示条。
pub(crate) fn status(text: &str) -> ui::Element {
    label(text)
        .padding(space::TWO)
        .width_full()
        .bg(color::SURFACE_CONTAINER_HIGH)
        .radius(shape::SMALL)
}

/// 横向排布的一行，用来让 chip 之类的元素按内容宽度收窄。
pub(crate) fn row(gap: u32) -> ui::Element {
    ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .gap(gap)
        .align_center()
        .width_full()
}

/// 步骤状态：已完成 / 当前 / 未开始。
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum StepState {
    Done,
    Current,
    Upcoming,
}

const STEP_LABELS: [&str; 2] = ["订单", "激活"];

/// 顶部步骤条：只表示流程位置，不承载交互。
pub(crate) fn steps(current: u32) -> ui::Element {
    let mut row = ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .gap(space::ONE)
        .align_center()
        .flex_grow(1.0);
    for (index, label) in STEP_LABELS.iter().enumerate() {
        let state = match (index as u32 + 1).cmp(&current) {
            std::cmp::Ordering::Less => StepState::Done,
            std::cmp::Ordering::Equal => StepState::Current,
            std::cmp::Ordering::Greater => StepState::Upcoming,
        };
        row = row.child(step(label, state));
    }
    row
}

/// 顶栏：步骤靠左，服务状态徽标固定在右侧。
pub(crate) fn top_bar(current: u32, service_badge: ui::Element) -> ui::Element {
    row(space::TWO)
        .child(steps(current).flex_grow(1.0))
        .child(service_badge)
}

/// 步骤条上的一格：已完成的带 ✓，当前步骤是主色实底。
fn step(text: &str, state: StepState) -> ui::Element {
    let (bg, fg) = match state {
        StepState::Done => (color::SECONDARY_CONTAINER, color::ON_SECONDARY_CONTAINER),
        StepState::Current => (color::PRIMARY, color::ON_PRIMARY),
        StepState::Upcoming => (color::SURFACE_CONTAINER_HIGH, color::ON_SURFACE_VARIANT),
    };
    let content = if state == StepState::Done {
        format!("✓ {text}")
    } else {
        text.to_string()
    };
    ui::Element::new(ui::ElementType::Span, Some(&content))
        .size(type_scale::LABEL_MEDIUM)
        .padding_top(space::ONE)
        .padding_bottom(space::ONE)
        .padding_left(space::TWO)
        .padding_right(space::TWO)
        .bg(bg)
        .text_color(fg)
        .radius(shape::SMALL)
        .transition(TRANSITION)
}

/// 激活过程里的子步骤：当前动作更大更亮，已完成带 ✓，未开始的压暗。
pub(crate) fn substep(text: &str, state: StepState) -> ui::Element {
    match state {
        StepState::Done => label(&format!("✓ {text}")),
        StepState::Current => body(text),
        StepState::Upcoming => label(text),
    }
}

/// M3 surface container：承载一组相关内容的卡片。
pub(crate) fn card() -> ui::Element {
    ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .flex_direction(ui::FlexDirection::Column)
        .gap(space::TWO)
        .padding(space::THREE)
        .width_full()
        .bg(color::SURFACE_CONTAINER)
        .radius(shape::MEDIUM)
}

/// M3 assist chip：标注绑定状态之类的短信息。
pub(crate) fn chip(text: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::Span, Some(text))
        .size(type_scale::LABEL_MEDIUM)
        .text_color(color::ON_SECONDARY_CONTAINER)
        .padding(space::ONE)
        .bg(color::SECONDARY_CONTAINER)
        .radius(shape::SMALL)
}

/// 固定尺寸的服务状态按钮，异常时可展开原因。
pub(crate) fn service_badge(status: ServiceStatus) -> ui::Element {
    let (text, background, foreground) = match status {
        ServiceStatus::Checking => (
            "检查服务…",
            color::SURFACE_CONTAINER_HIGH,
            color::ON_SURFACE_VARIANT,
        ),
        ServiceStatus::Healthy => (
            "服务正常",
            color::SUCCESS_CONTAINER,
            color::ON_SUCCESS_CONTAINER,
        ),
        ServiceStatus::Unavailable => (
            "服务异常",
            color::ERROR_CONTAINER,
            color::ON_ERROR_CONTAINER,
        ),
    };
    let badge = ui::Element::new(ui::ElementType::Badge, Some(text))
        .size(type_scale::LABEL_MEDIUM)
        .width(88)
        .height(28)
        .flex()
        .align_center()
        .justify_center()
        .bg(background)
        .text_color(foreground)
        .radius(shape::SMALL)
        .flex_shrink(0.0)
        .transition(TRANSITION);
    ui::Element::new(ui::ElementType::Button, None)
        .width(88)
        .height(28)
        .padding(0)
        .margin(0)
        .bg(color::TRANSPARENT)
        .radius(shape::SMALL)
        .flex_shrink(0.0)
        .prop("variant", "ghost")
        .prop("aria-label", text)
        .on(ui::Event::Click, SERVICE_STATUS_EVENT)
        .child(badge)
}

pub(crate) fn service_reason(reason: &str) -> ui::Element {
    label(&format!("原因：{reason}"))
        .padding(space::TWO)
        .width_full()
        .bg(color::ERROR_CONTAINER)
        .text_color(color::ON_ERROR_CONTAINER)
        .radius(shape::SMALL)
}

/// M3 filled text field：容器用 surface container（高），文字用 bodyLarge（16dp）。
pub(crate) fn field(placeholder: &str, event: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::Textarea, None)
        .height(FIELD_HEIGHT)
        .width_full()
        .padding(space::TWO)
        .bg(color::SURFACE_CONTAINER_HIGH)
        .radius(shape::EXTRA_SMALL)
        .transition(TRANSITION)
        .prop("size", "3")
        .prop("placeholder", placeholder)
        .on(ui::Event::Input, event)
}

fn button(label: &str, event: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::Button, Some(label))
        .size(type_scale::BODY_MEDIUM)
        .height(BUTTON_HEIGHT)
        .width_full()
        .radius(shape::FULL)
        .transition(TRANSITION)
        .on(ui::Event::Click, event)
}

/// M3 filled button：一屏只有一个主动作。
pub(crate) fn filled_button(label: &str, event: &str) -> ui::Element {
    button(label, event)
        .bg(color::PRIMARY)
        .text_color(color::ON_PRIMARY)
}

/// M3 outlined button：次要动作。
pub(crate) fn outlined_button(label: &str, event: &str) -> ui::Element {
    button(label, event)
        .bg(color::TRANSPARENT)
        .text_color(color::PRIMARY)
        .border(1, color::PRIMARY)
}

/// M3 tonal button：已选中的选项。
pub(crate) fn tonal_button(label: &str, event: &str) -> ui::Element {
    button(label, event)
        .bg(color::SECONDARY_CONTAINER)
        .text_color(color::ON_SECONDARY_CONTAINER)
}

/// M3 text button：低强调动作。
pub(crate) fn text_button(label: &str, event: &str) -> ui::Element {
    button(label, event)
        .bg(color::TRANSPARENT)
        .text_color(color::ON_SURFACE_VARIANT)
}

/// 行内文本链接。用按钮承载，才能拿到宿主的指针光标与悬停反馈。
/// 左右内边距清零，间距统一交给页脚的间隔点控制。
pub(crate) fn link(label: &str, event: &str) -> ui::Element {
    ui::Element::new(ui::ElementType::Button, Some(label))
        .size(type_scale::LABEL_MEDIUM)
        .height(LINK_HEIGHT)
        .padding_left(0)
        .padding_right(0)
        .bg(color::TRANSPARENT)
        .text_color(color::PRIMARY)
        .radius(shape::FULL)
        .transition(TRANSITION)
        .on(ui::Event::Click, event)
}

/// 页脚：一排链接，间距由间隔点统一控制。
pub(crate) fn footer(links: &[(&str, &str)]) -> ui::Element {
    let mut footer = ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .justify_center()
        .align_center()
        .width_full();
    for (index, (label, event)) in links.iter().enumerate() {
        if index > 0 {
            footer = footer.child(link_separator());
        }
        footer = footer.child(link(label, event));
    }
    footer
}

/// 页脚链接之间的间隔点，纯展示、不可点。
fn link_separator() -> ui::Element {
    ui::Element::new(ui::ElementType::Span, Some("·"))
        .size(type_scale::LABEL_MEDIUM)
        .text_color(color::ON_SURFACE_VARIANT)
        .padding_left(space::TWO)
        .padding_right(space::TWO)
}

/// M3 线性进度条：轨道 + 按 flex-grow 分配比例的指示条。
pub(crate) fn progress(value: u32) -> ui::Element {
    let done = value.min(100) as f32;
    let track = ui::Element::new(ui::ElementType::Div, None)
        .flex()
        .width_full()
        .height(PROGRESS_HEIGHT)
        .radius(PROGRESS_HEIGHT / 2)
        .bg(color::SURFACE_CONTAINER_HIGH)
        .child(
            ui::Element::new(ui::ElementType::Div, None)
                .height_full()
                .radius(PROGRESS_HEIGHT / 2)
                .bg(color::PRIMARY)
                .flex_grow(done)
                .transition("flex-grow 300ms cubic-bezier(0.2, 0, 0, 1)"),
        );
    if done >= 100.0 {
        return track;
    }
    track.child(
        ui::Element::new(ui::ElementType::Div, None)
            .height_full()
            .flex_grow(100.0 - done),
    )
}
