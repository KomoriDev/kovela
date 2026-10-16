//! Level 4 宿主标识与账号资料（`astrobox:psys-host-v4/account`、`/os`）。
//!
//! 只做「取到已绑定的爱发电账号 ID」这一件事：绑定状态由宿主每次向服务器
//! 实时确认，插件不缓存、也不把结果当成本地凭据。真正判定购买始终在服务端
//! 用爱发电现场复核（见 `/api/account/activate`）。
//!
//! 宿主导入在宿主目标上不存在，所以单元测试里这些函数是空操作，真机行为以
//! api4 构建为准。

/// 兼容构建没有账号接口：界面据此决定要不要显示「用 AstroBox 账号激活」。
pub(crate) const SUPPORTED: bool = cfg!(feature = "api4");

#[cfg(all(feature = "api4", not(test)))]
mod host {
    use crate::astrobox::psys_host_v4::{account, os};

    /// 宿主已登录账号里绑定的爱发电账号 ID（32 位十六进制，小写）。
    ///
    /// 未登录、未绑定、绑定查询失败都给明确原因：绑定查询失败时宿主把该项标成
    /// `unavailable`，此时不能退回「未绑定」的结论，否则用户会被引导去做无用的重绑。
    pub(crate) async fn afdian_user_id() -> Result<String, String> {
        let profile = account::get_current()
            .await?
            .ok_or("请先登录 AstroBox，并在账号设置中绑定爱发电")?;
        let binding = profile
            .bindings
            .into_iter()
            .find(|binding| binding.provider == "afdian")
            .ok_or("账号没有爱发电绑定资料")?;
        let id = match binding.status {
            account::BindingStatus::Linked => binding.id.ok_or("爱发电绑定资料缺少账号 ID")?,
            account::BindingStatus::Unlinked => {
                return Err("请在 AstroBox 账号设置中绑定购买商品的爱发电账号".into());
            }
            account::BindingStatus::Unavailable => {
                return Err("暂时无法确认爱发电绑定，请检查网络后重试".into());
            }
        };
        if id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("爱发电账号 ID 格式无效".into());
        }
        Ok(id.to_ascii_lowercase())
    }

    /// 运行 AstroBox 的这一份安装的标识（`ab-install-<32 位十六进制>`）。
    ///
    /// 不是硬件序列号，也不从 MAC、IMEI 派生；只用来把激活记录归到同一份安装，
    /// 供创作者排查同一安装反复激活不同账号这类情况。拿不到或格式异常就不上报。
    pub(crate) async fn host_device_id() -> Option<String> {
        let value = os::device_id().await.ok()?;
        let value = value.trim().to_ascii_lowercase();
        let hex = value.strip_prefix("ab-install-")?;
        if hex.len() != 32 || !hex.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        Some(value)
    }
}

#[cfg(all(feature = "api4", not(test)))]
pub(crate) use host::{afdian_user_id, host_device_id};

#[cfg(any(not(feature = "api4"), test))]
pub(crate) async fn afdian_user_id() -> Result<String, String> {
    #[cfg(feature = "api4")]
    {
        // 单元测试里不碰宿主导入：返回一个明确的未配置结论即可。
        Err("账号资料接口不可用".into())
    }
    #[cfg(not(feature = "api4"))]
    {
        Err("按账号激活需要 AstroBox 2.2 及以上版本".into())
    }
}

#[cfg(any(not(feature = "api4"), test))]
pub(crate) async fn host_device_id() -> Option<String> {
    None
}
