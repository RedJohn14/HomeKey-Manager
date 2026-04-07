# HomeKey Manager

Custom integration for Home Assistant to manage Apple HomeKey NFC keys.

## Features

- Automatic key detection when scanned via NFC reader
- Key management (rename, delete, track)
- Live connection status
- Scan tracking (last scan, scan count, active today)
- Search and filter keys
- Configurable NFC lock entity via Settings panel
- No token or manual YAML configuration required

## Installation

### HACS (Custom Repository)

1. Open HACS > Integrations > Custom Repositories
2. Add this repository URL, select **Integration**
3. Install **HomeKey Manager**
4. Restart Home Assistant
5. Go to **Settings > Devices & Services > Add Integration** and search for **HomeKey Manager**

### Manual

1. Copy `custom_components/homekey_manager` into your HA `config/custom_components/` directory
2. Restart Home Assistant
3. Go to **Settings > Devices & Services > Add Integration** and search for **HomeKey Manager**

## ESPHome Configuration

HomeKey Manager works with an ESP32 running [ESPHome](https://esphome.io/) and a PN532 NFC reader. Below is an example configuration to get Apple HomeKey working with your ESP32.

### Text Sensors for Key Tracking

These sensors expose the last scan result, issuer ID, and endpoint ID to Home Assistant:

```yaml
text_sensor:
  - platform: template
    name: "Last HK Issuer ID"
    id: last_issuer_id

  - platform: template
    name: "Last HK Endpoint ID"
    id: last_endpoint_id

  - platform: template
    name: "Last HK Result"
    id: last_hk_result
```

### SPI Bus for PN532

```yaml
spi:
  clk_pin: GPIO18
  miso_pin: GPIO19
  mosi_pin: GPIO23
```

### PN532 NFC Reader

```yaml
pn532_spi:
  id: nfc_spi_module
  cs_pin: GPIO5
  update_interval: 100ms
```

### HomeKit Bridge

```yaml
homekit_base:
  setup_code: '123-45-678'
  setup_id: "MKEY"
  meta:
    name: "YourDeviceName"
    manufacturer: "DIY"
    model: "ESP32-HomeKey"
    serial_number: "00000001"
    fw_rev: "1.0.0"
```

### HomeKit Lock with HomeKey NFC

This is where the magic happens. On a successful HomeKey authentication, the issuer and endpoint IDs are published to the text sensors and the lock is unlocked:

```yaml
homekit:
  lock:
    - id: my_lock
      nfc_id: nfc_spi_module
      hk_hw_finish: "SILVER"
      on_hk_success:
        lambda: |-
          ESP_LOGI("HomeKey", "Auth OK - Issuer: %s", x.c_str());
          id(last_issuer_id).publish_state(x);
          id(last_endpoint_id).publish_state(y);
          id(last_hk_result).publish_state("success");
          id(my_lock).unlock();
      on_hk_fail:
        lambda: |-
          ESP_LOGI("HomeKey", "Auth FAILED");
          id(last_hk_result).publish_state("fail");
```

### Factory Reset Button (optional)

```yaml
button:
  - platform: homekit_base
    factory_reset:
      name: "Reset HomeKit Pairings"
```

> **Note:** Adjust the pin configuration and device names to match your hardware setup. The sensor names in ESPHome determine the entity IDs in Home Assistant.

## Setup

After installation the **HomeKey Manager** panel appears in the sidebar. Click the **Einstellungen** (Settings) button in the top-right corner to configure which NFC lock entity sensors to use.

The sensor entity IDs depend on how you named your ESPHome text sensors. For example, if your ESPHome device is called `magickey` and the sensor is `Last HK Result`, the entity ID in Home Assistant will be `sensor.magickey_last_hk_result`.

### Default sensor configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Result sensor | `sensor.<device>_last_hk_result` | Scan result (`success` / `fail`) |
| Issuer sensor | `sensor.<device>_last_hk_issuer_id` | UUID of the scanned key |
| Endpoint sensor | `sensor.<device>_last_hk_endpoint_id` | Endpoint identifier |

> Replace `<device>` with the name of your ESPHome device (e.g. `magickey`, `frontdoor`, `nfc_lock`).

## Usage

- **Automatic scanning** — Hold iPhone or Apple Watch near the NFC reader. The key appears automatically.
- **Rename** — Click "Umbenennen" on any key card.
- **Delete** — Click "Loschen" to remove a key.
- **Manual add** — Use "+ Key hinzufugen" to register a key by its issuer ID.
- **Settings** — Configure NFC lock entity sensors via the Einstellungen button.

## Compatibility

- Home Assistant OS (HassIO)
- Home Assistant Container (Docker / docker-compose)
- Home Assistant Supervised
- Home Assistant Core

## License

MIT
