//! Windows Credential Manager reader. Native Win32, no PowerShell shim.
//!
//! Matches the same `migRaven.MAX-*` prefix used by the sibling project so
//! existing `migRaven.MAX-AI` and `migRaven.MAX-Neo4j` targets work as-is.

#[cfg(windows)]
mod win {
    use anyhow::{anyhow, Result};
    use std::ptr;
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    pub fn read(target: &str) -> Result<(String, String)> {
        let mut wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
        let mut p_cred: *mut CREDENTIALW = ptr::null_mut();
        unsafe {
            let ok = CredReadW(
                PCWSTR(wide.as_mut_ptr()),
                CRED_TYPE_GENERIC,
                0,
                &mut p_cred,
            );
            if ok.is_err() || p_cred.is_null() {
                return Err(anyhow!(
                    "Credential '{}' not found in Windows Credential Manager.",
                    target
                ));
            }
            let cred = &*p_cred;
            let username = if cred.UserName.is_null() {
                String::new()
            } else {
                let len = (0..).take_while(|&i| *cred.UserName.0.add(i) != 0).count();
                String::from_utf16_lossy(std::slice::from_raw_parts(cred.UserName.0, len))
            };
            let password = if cred.CredentialBlobSize > 0 && !cred.CredentialBlob.is_null() {
                let slice = std::slice::from_raw_parts(
                    cred.CredentialBlob as *const u16,
                    (cred.CredentialBlobSize / 2) as usize,
                );
                String::from_utf16_lossy(slice)
            } else {
                String::new()
            };
            CredFree(p_cred as *const _);
            if username.is_empty() || password.is_empty() {
                return Err(anyhow!("Credential '{}' has empty user or pass.", target));
            }
            Ok((username, password))
        }
    }
}

#[cfg(not(windows))]
mod win {
    use anyhow::{anyhow, Result};
    pub fn read(_target: &str) -> Result<(String, String)> {
        Err(anyhow!("Windows Credential Manager only available on Windows."))
    }
}

pub fn credential_prefix() -> String {
    std::env::var("MAX_CREDENTIAL_PREFIX")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "migRaven.MAX".to_string())
}

pub fn read_foundry_key() -> anyhow::Result<String> {
    if let Ok(key) = std::env::var("AZURE_FOUNDRY_KEY") {
        if !key.trim().is_empty() {
            return Ok(key);
        }
    }
    let target = format!("{}-AI", credential_prefix());
    let (_, password) = win::read(&target)?;
    Ok(password)
}

pub fn read_neo4j_credentials() -> anyhow::Result<(String, String)> {
    let target = std::env::var("NEO4J_CREDENTIAL_NAME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("{}-Neo4j", credential_prefix()));
    win::read(&target)
}
