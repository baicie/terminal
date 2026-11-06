# RSA Marvin 暴露评估（RUSTSEC-2023-0071）

> 日期：2026-11-03
> 基线：`44ae449`
> 结论口径：**依赖图可达 ≠ 漏洞触发路径可达**。本文把两者分开陈述。

## 1. 依赖事实

```text
src-tauri$ cargo tree -i rsa@0.10.0-rc.18 --all-features
rsa v0.10.0-rc.18
├── russh v0.65.0
│   └── terminal v0.0.1-dev.2
└── ssh-key v0.7.0-rc.11
    ├── russh v0.65.0
    └── terminal v0.0.1-dev.2
```

`rsa` 确实进入三平台构建图，不能把这条 advisory 说成“锁文件残留”。

```text
src-tauri$ cargo tree -e features -i rsa@0.10.0-rc.18
rsa feature "default"
├── russh feature "rsa"
└── rsa feature "encoding"
rsa feature "sha2"
└── ssh-key feature "rsa"
```

`ssh-key` 的 `encryption` feature 指加密私钥文件格式（PKCS#8/OpenSSH 容器），
不是 RSA PKCS#1 v1.5 解密。

## 2. 漏洞要求的操作

`RUSTSEC-2023-0071` 是 Marvin 攻击：攻击者需要对**同一个 RSA 私钥**反复提交
PKCS#1 v1.5 密文并观察解密失败/成功的时序差异。触发前提是产品提供一个
**PKCS#1 v1.5 解密 oracle**。

RSA 签名/验签不满足这个前提：私钥用于对已知摘要签名，攻击者不能把它当作
任意密文的解密接口。

## 3. 代码可达性

### 3.1 russh / ssh-key 没有调用 RSA 解密

```text
$ rg -n "Pkcs1v15Encrypt|decrypt\(" \
    ~/.cargo/registry/src/*/russh-0.65.0 \
    ~/.cargo/registry/src/*/ssh-key-0.7.0-rc.11
```

命中项只有：

- `russh/src/keys/format/pkcs8.rs`：解析/编码私钥文件；
- `ssh-key/src/private.rs`、`ppk.rs`：解密**加密私钥文件**（AES/ChaCha，不是 RSA）；
- SSH cipher 的 packet decrypt（AES/GCM/ChaCha，不是 RSA）。

没有 `rsa::Pkcs1v15Encrypt` 的解密调用。

### 3.2 rsa crate 内的命中不是产品调用

```text
$ rg -n "Pkcs1v15Encrypt" ~/.cargo/registry/src/*/rsa-0.10.0-rc.18
src/pkcs1v15.rs:56: pub struct Pkcs1v15Encrypt;
src/lib.rs:55-69: doc example
src/pkcs1v15.rs:333: unit test
benches/key.rs:10,105: benchmark
```

这些是 crate 自身的定义/文档/测试/基准，不是本产品调用。

### 3.3 二进制符号

```text
$ nm -C src-tauri/target/debug/terminal | rg -i "rsa::pkcs1v15|rsa::oaep"
# 0 matches
```

调试二进制里没有 RSA PKCS#1 v1.5 解密/ OAEP 解密的可链接符号。该结果与源码
调用面一致；它不是形式化证明，但排除了“产品代码直接调用”的解释。

### 3.4 SSH 的 RSA 用途

`ssh-key` 的 RSA 路径是 `Pkcs1v15Sign` / `RsaPublicKey::verify`：

```text
ssh-key/src/signature.rs:322  Self::Rsa(pk) => pk.verify(message, signature)
ssh-key/src/signature.rs:736  impl Verifier<Signature> for RsaPublicKey
```

`russh` 的默认 host-key 偏好顺序把 RSA 排在最后：

```text
Ed25519 -> ECDSA P-256 -> P-384 -> P-521
-> RSA-SHA512 -> RSA-SHA256 -> ssh-rsa
```

这是降低旧 RSA 暴露的补偿控制，不改变“RSA 密钥仍可用于签名”的兼容性。

## 4. 风险判定

| 问题 | 结论 |
| --- | --- |
| `rsa` 是否进入构建图 | **是**，三平台 |
| 是否存在 PKCS#1 v1.5 解密调用 | **未发现** |
| 是否能由 SSH 服务端或不可信输入触发 Marvin oracle | **当前代码路径不成立** |
| 是否可以把 advisory 从基线删除 | **不能**；锁文件仍含该版本 |
| 上游是否有修复版本 | **BLOCKED_EXTERNAL**：`patched = []` |

**状态：PASS（可达性评估）/ 残余风险接受（有条件）。**

这不是“没有风险”。准确表述是：当前产品只使用 RSA 签名/验签与私钥文件解析，
没有向不可信输入暴露 PKCS#1 v1.5 解密 oracle；在依赖不变的前提下，Marvin 攻击
缺少触发路径。

## 5. 处置与复核条件

保留 `RUSTSEC-2023-0071` 在 `src-tauri/security-baseline.json`，不删除、不伪造
修补版本。CI 继续把新 advisory 或版本变化判红。

满足任一条件必须重新评估：

1. `russh` / `ssh-key` 升级或改变 RSA 特性。
2. 产品新增 RSA 加密/解密、PKCS#1 v1.5 oracle 或密文导入功能。
3. `rsa` 发布修复版本并进入依赖图。
4. SSH 认证新增 RSA 解密类扩展。

本轮没有通过禁用安全检查拉绿；`cargo audit` 仍是阻塞门禁。
