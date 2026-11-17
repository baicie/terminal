//! The approval digest, reproduced from the frontend bit for bit.
//!
//! ## Why this exists twice
//!
//! The frontend builds an [`crate::ai::ApprovedContext`] from the text the user
//! selected, shows it in a preview, and records a digest of it. Moving the request
//! to Rust means the text crosses the IPC boundary — and a boundary that trusts the
//! digest it was handed proves nothing. The backend recomputes the digest over the
//! text it is about to send and refuses a mismatch, so "the text changed after the
//! user approved it" is detected on the side that actually sends it.
//!
//! That only works if the two implementations agree byte for byte. The frontend's
//! `content-hash.ts` walks **UTF-16 code units** (`text.charCodeAt(i)`), mixes them
//! with `Math.imul`, and folds in `text.length` (also UTF-16 units). Rust strings are
//! UTF-8, so this module converts with `encode_utf16()` before hashing. The KAT
//! vectors below were produced by running the TypeScript implementation, which is
//! what makes the agreement checkable rather than asserted.

const PRIME: u32 = 0x0100_0193;

fn lane(units: &[u16], seed: u32, stride: usize, offset: usize) -> u32 {
    let mut hash = seed;
    let mut index = offset;
    while index < units.len() {
        hash ^= u32::from(units[index]);
        hash = hash.wrapping_mul(PRIME);
        index += stride;
    }
    hash ^= units.len() as u32;
    hash.wrapping_mul(PRIME)
}

/// A 128-bit hex digest of `text`, identical to `createHashOf` in the frontend.
pub fn digest(text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    [
        lane(&units, 0x811c_9dc5, 1, 0),
        lane(&units, 0x7f4a_7c15, 1, 1),
        lane(&units, 0x2545_f491, 2, 0),
        lane(&units, 0x9e37_79b9, 2, 1),
    ]
    .iter()
    .map(|lane| format!("{lane:08x}"))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::digest;

    /// Produced by `node -e` with the TypeScript implementation
    /// (`packages/frontend/src/features/ai/content-hash.ts`). A drift on either side
    /// turns every request into `context-changed`, so these are the contract.
    #[test]
    fn matches_the_frontend_implementation_on_known_vectors() {
        let vectors = [
            ("", "050c5d1f7741550f3e200043ca549e3b"),
            ("kubectl get pods", "8a61127d2f3ae4964bdb62f43179c73c"),
            ("héllo 世界 🙂", "ba37bf1f44856c096ee7243f16576534"),
            (&"a".repeat(1000), "623c30ff425821f2f19e54a76143302f"),
        ];
        for (text, expected) in vectors {
            assert_eq!(digest(text), expected, "digest mismatch for {text:?}");
        }
    }

    /// The frontend hashes UTF-16 units, so a string outside the BMP must not be
    /// hashed as its UTF-8 bytes. This is the case a naive port gets wrong.
    #[test]
    fn hashes_utf16_units_not_utf8_bytes() {
        assert_eq!(digest("🙂"), digest("\u{1f642}"));
        assert_ne!(digest("🙂"), digest(""));
        // 😀 and 😁 share a high surrogate and differ in the low one.
        assert_ne!(digest("😀"), digest("😁"));
    }
}
