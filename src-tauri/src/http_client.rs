// =================================================================
// Shared reqwest clients (connect + read timeouts)
// =================================================================

use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct LoomHttp(pub Arc<reqwest::Client>);

impl LoomHttp {
    pub fn client(&self) -> &reqwest::Client {
        &self.0
    }
}

pub fn build_loom_http() -> Result<LoomHttp, String> {
    let client = reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller/1.0 (local analytics tool; contact: github.com/mhsenkow/Loom_story_teller)")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(LoomHttp(Arc::new(client)))
}

/// Long-lived SSE reads — no overall timeout; connect capped separately.
pub fn build_loom_sse_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller/1.0 (local analytics tool; contact: github.com/mhsenkow/Loom_story_teller)")
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}
