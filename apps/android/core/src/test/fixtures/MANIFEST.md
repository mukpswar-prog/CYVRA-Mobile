# CYVRA FIXTURE MANIFEST — TASK Q (hash manifest; CONTENT WITHHELD)

Status: hash manifest only. Ruling: Chief Engineer, 09-Oct-2026.
Branch: `feature/core-engine-matrix-v1`.

This repository is PUBLIC. All fixture **content** remains in the local
evidence locker and never egresses (governed doc section 9 — fixtures stay
local; no egress). Basis: State 1/2 `wifi.txt` carry real BSSID/MAC values
(neighbourhood Wi-Fi fingerprint = location data) and `packages.txt` carries
a 378-app personal inventory (personal data, DPDP Act 2023).

Purpose: existence, size and integrity of every fixture file are verifiable
from this manifest without disclosing content.

**PROHIBITED IN THIS FILE:** device serial numbers. Target identity is
recorded as state label + model + API level + ABI only.

Verification: `Get-FileHash -Algorithm SHA256 <path>` must equal the value below.

## EMULATOR_API36

| provenance | value |
|---|---|
| captured_at_utc | 2026-10-09T07:55:44Z |
| state_label | EMULATOR_API36 |
| model | sdk_gphone64_x86_64 |
| api_level | 36 |
| abi | x86_64 |
| probe_target_usable | unknown |
| files | 13 |
| total_bytes | 70879 |

| path | bytes | sha256 | status |
|---|---:|---|---|
| `apps/android/core/src/test/fixtures/emulator_api36/adb_devices.txt` | 275 | `90c3b333370061266fc35b3c262c25b6e146e0a652a37a0b45734b44f1323eb9` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/battery.txt` | 670 | `d8b266f7f9384d7563a893d6bd0bba0a25a0389bfb58f92e73cc187cd42c345a` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/cid.txt` | 556 | `aace5049d207fb72f8a3dae5a5500d3266cbea5392289364683b3ac30bbf3856` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/df.txt` | 5429 | `654fe5660a608e2be5f34bb768d6e18777b9aa8f813e8746a6c054ce4c8354e1` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/diskstats.txt` | 286 | `7aec713beca64458754172978b254f76776a29f801cbf2beed81a70e79fb5478` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/display.txt` | 29345 | `fdd40d9ac4aa258c6426d7595daae2bcd1155fee832260117d5ed90adfbc17df` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/getprop.txt` | 641 | `3066327ef7350acdaeef3bcae40d700c1a7c6e5e0ce797bdcd502a64663cda2f` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/manifest.txt` | 3167 | `473c6950c1e944723597db85b9c337257057c5355788c7ebdba1cc2be2594aa0` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/packages.txt` | 11050 | `6eeb9605a6682b7ba7654aca8a3a59ccde2669fa207c94d05913bf1dc9cda8af` | **withheld — no egress** (app inventory, DPDP) |
| `apps/android/core/src/test/fixtures/emulator_api36/provenance.txt` | 1750 | `56a91795b569b0e157e7decb211fe8c16b1ece8c939f00a4b9104df143639ba6` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/sensors.txt` | 9840 | `fe1cab5974065cecdff4a23cf9a5f683d6b4081a71d4e9a03da86c9a446de307` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/emulator_api36/wifi.txt` | 7823 | `aa10529e7f6f91e5460aade70b82565ef90cb8e7220c89564154d6077d9a1514` | **withheld — no egress** (BSSID/MAC) |
| `apps/android/core/src/test/fixtures/emulator_api36/wm.txt` | 47 | `925449c6b316d88de96b075ab0f867bebf11df5c6e89e79b3b03ed55eb04b1a9` | **withheld — no egress** |

## STATE_1_UNLOCKED_DEBUGON

| provenance | value |
|---|---|
| captured_at_utc | 2026-10-09T07:58:53Z |
| state_label | STATE_1_UNLOCKED_DEBUGON |
| model | SM-A107F |
| api_level | 30 |
| abi | armeabi-v7a |
| probe_target_usable | unknown |
| files | 13 |
| total_bytes | 1777635 |

| path | bytes | sha256 | status |
|---|---:|---|---|
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/adb_devices.txt` | 161 | `a44549553e93c90ee0cb07269090162c3338d9cc76ec2c33feb531059ccf87fa` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/battery.txt` | 1200 | `63b10a35d0b8b92e086804e56e70823188ac708feb288e897c5c3489fa270214` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/cid.txt` | 540 | `8c36355bbee664e8f1fb9edf4bc604b25acf6122e7786bb1b5cff546b669a756` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/df.txt` | 824 | `4214230bdbccab9974c81144d57722037677b9735aec4cc0b59aaf9fa9463882` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/diskstats.txt` | 20942 | `90e8f5d523f0673615f17d76b501ad6587e1c362f7d2b86a60f9ce540c0ea322` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/display.txt` | 16767 | `61fe150f341bb237877743c733db586462ae154fff729d6b747e961048597f7a` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/getprop.txt` | 633 | `ac52dd44edbe890d317885aa33b7d28e702f06375d360320e0e98e5bcae2604d` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/manifest.txt` | 3176 | `50a6721cb8521424c13c0e4eabace9854de908468026964f6cd9d884c258500a` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/packages.txt` | 14979 | `51e5f2b0dbd6551ec8d6289c33f833750b8cbdaaed79a80caf231ec6b0c77b71` | **withheld — no egress** (app inventory, DPDP) |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/provenance.txt` | 1753 | `1a57ea2d64f798883e282d416cc7b8b639c1c2700b880c4d46408ea2cebc52ea` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/sensors.txt` | 92463 | `5c4e53124beb6f64dd69b38f3cd7341e4f37e413ce606e7462d1ba451564225c` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/wifi.txt` | 1624151 | `0996b72f76312febab13a92753d58dab38392b6ec24af1a488517e91571c4883` | **withheld — no egress** (BSSID/MAC) |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/wm.txt` | 46 | `0fbd97fdc9067c40ac678402de7f05e3951ab3384a2de97c7db6f0639f923e57` | **withheld — no egress** |

## STATE_2_LOCKED_DEBUGON

| provenance | value |
|---|---|
| captured_at_utc | 2026-10-09T08:18:56Z |
| state_label | STATE_2_LOCKED_DEBUGON |
| model | SM-A107F |
| api_level | 30 |
| abi | armeabi-v7a |
| probe_target_usable | unknown |
| files | 13 |
| total_bytes | 193059 |

| path | bytes | sha256 | status |
|---|---:|---|---|
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/adb_devices.txt` | 161 | `1652c38f1d2e11fc7da6db6e3cfdeb22ed412d926331e339ded035f3c1a95586` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/battery.txt` | 1200 | `06e0303e12e628299ecf24db4e7858cbbc5a27ba8beb3ddd636159bee90cfce0` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/cid.txt` | 540 | `8c36355bbee664e8f1fb9edf4bc604b25acf6122e7786bb1b5cff546b669a756` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/df.txt` | 824 | `954d1417d667f51bc00fade874f7ced2773bf2b3b345d48f368d9c6d9b2c8087` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/diskstats.txt` | 20942 | `a0b5a0d1545baba8f740cbe0d8f78038bd87df4d7038f795e4825f22d14bd77a` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/display.txt` | 17829 | `81fad3e2e5dfbddd577430be5a782ae89b4e1a18d07d36f133bac4f1eb49c109` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/getprop.txt` | 633 | `ac52dd44edbe890d317885aa33b7d28e702f06375d360320e0e98e5bcae2604d` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/manifest.txt` | 3175 | `2a5334b3088d1bb15284b08d0a88a1cbff6458250da3bc6a56c2b5ced8ee75bd` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/packages.txt` | 14979 | `51e5f2b0dbd6551ec8d6289c33f833750b8cbdaaed79a80caf231ec6b0c77b71` | **withheld — no egress** (app inventory, DPDP) |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/provenance.txt` | 1753 | `e8b347f5ae61330edf5f597131aa280d819dfae07c141fbb92b19e1246cf3635` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/sensors.txt` | 12578 | `cdd570bdd3769fb201e82ee07ed29add7ad86af4d55d4e57941439156f1ea25d` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/wifi.txt` | 118399 | `501e8701645d12f86264d322197d08161ceb51a63cbfb7bd736a17bca2ef43ad` | **withheld — no egress** (BSSID/MAC) |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/wm.txt` | 46 | `0fbd97fdc9067c40ac678402de7f05e3951ab3384a2de97c7db6f0639f923e57` | **withheld — no egress** |

## STATE_3_DEBUGOFF

| provenance | value |
|---|---|
| captured_at_utc | 2026-10-09T08:20:41Z |
| state_label | STATE_3_DEBUGOFF |
| model | unknown |
| api_level | 30 |
| abi | NOT AVAILABLE (target not readable) |
| probe_target_usable | unknown |
| files | 13 |
| total_bytes | 6368 |

| path | bytes | sha256 | status |
|---|---:|---|---|
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/adb_devices.txt` | 74 | `28a0bda0a448cd4d315b9f96c373f634c4ce00e0eb6bfc286c5e26af1b733622` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/battery.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/cid.txt` | 464 | `99dc6f500b7ae487b622ebb3251fbe7011c370b6052bfcd63cae1a16c0cbabaa` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/df.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/diskstats.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/display.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/getprop.txt` | 131 | `79b7a5f2f00fdb72589a832c2d5b3fd49a85732f9aacfe758fe1a3a3f5e93212` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/manifest.txt` | 3148 | `059243742fb9528782142e05ed1ef46e7dd40f458a3467c738e66190bd1a0f6c` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/packages.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** (app inventory, DPDP) |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/provenance.txt` | 2231 | `e2a83e304b0450a8ad6db21e390eeca4ff568a5e07c4f654c8d86226f37bce89` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/sensors.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/wifi.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** (BSSID/MAC) |
| `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/wm.txt` | 40 | `2917be613674256e80149ee79ba69e9952d48ceb34d6476296084d2d440a642f` | **withheld — no egress** |

---

**TOTAL: 52 files, 2047941 bytes.** All content withheld.

No file in this directory is tracked by git except this manifest
(`.gitignore`: `apps/android/core/src/test/fixtures/*` with an explicit
negation for `MANIFEST.md` only).

*End of manifest.*
