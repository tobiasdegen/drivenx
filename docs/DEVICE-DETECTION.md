# Device discovery and data sources

This document describes device discovery and connection reporting in the current DriveNX implementation. It does not prescribe controller-specific behavior.

## Sources

| Source                                     | Used for                                              | Limitations                                                              |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `smartctl --scan -j`                       | Candidate device paths and suggested access modes     | A suggested mode is not proof of the underlying protocol.                |
| `smartctl --scan-open -j`                  | Confirm selected candidate access types where safe    | May block or reset some ambiguous USB bridges.                           |
| `smartctl -a/-x/-i -j`                     | Device identity, SMART details, self-test information | Unsupported or incomplete readings remain unknown.                       |
| Windows CIM/PnP                            | OS bus, capacity, USB topology and identity hints     | May arrive asynchronously; never overrides verified smartctl access.     |
| macOS diskutil/IORegistry/system_profiler  | Physical disk metadata and connection chain           | Seeing a device does not establish SMART access.                         |
| Linux sysfs and system `smartctl`          | Device metadata and SMART collection                  | Device permissions and kernel/driver support vary.                       |
| USB-ID index (`vendor/usb-ids/index.json`) | Human-readable USB manufacturer and product names     | Descriptive only: not proof of bridge chipset, protocol or capabilities. |

## Discovery rules

1. Start with the non-opening smartctl scan. If the candidates are unambiguous, a safe `--scan-open` result can refine the access mode.
2. If Windows reports an unconfirmed USB-NVMe (`snt*`) selector, do not probe the device as NVMe automatically. Require an explicit supported access-mode choice first. This is driven by the reported smartctl access type, **not** a controller model or VID/PID.
3. Never infer a physical device identity from a vendor name. Merge aliases only if the physical identity is reliable; keep RAID members and separate NVMe namespaces distinct when uncertain.
4. Authorize the `name`/`type` pair only for the current scan generation. A rescanned or changed device invalidates earlier reports and pending actions.
5. Show bus, USB product descriptions and link-speed values only when backed by the correct source. SATA interface speed is not USB negotiated link speed.
6. If a query fails or times out, retain only supported information. Do not report a successful health assessment from missing data.

DriveNX may pass vendor-named `smartctl -d` selectors (such as supported `snt*` variants) because those are **smartctl protocol driver names**. They are not hardcoded exceptions based on a specific USB vendor/product ID. Recognition and access decisions must work for unfamiliar adapters exposing the same supported driver behavior.

## USB-ID index generation

`vendor/usb-ids/usb.ids` is the development-time source. `npm run usbids:generate` produces `vendor/usb-ids/index.json`; `npm run usbids:check` verifies that the existing index matches the source without rewriting it. Package builds include the generated index and its BSD-3-Clause license notice, not the original database.

USB-ID product descriptions may be missing, ambiguous or outdated. Display only available metadata; do not invent controller families to fill gaps.
