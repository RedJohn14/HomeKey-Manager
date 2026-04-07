"""HomeKey Manager - Apple HomeKey NFC key management for Home Assistant."""
import os
import json
import logging

from homeassistant.components import panel_custom
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

PANEL_FRONTEND_PATH = "homekey-manager"
PANEL_TITLE = "HomeKey Manager"
PANEL_ICON = "mdi:key-wireless"

DEFAULT_SETTINGS = {
    "sensor_result": "sensor.magickey_last_hk_result",
    "sensor_issuer": "sensor.magickey_last_hk_issuer_id",
    "sensor_endpoint": "sensor.magickey_last_hk_endpoint_id",
}


async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the HomeKey Manager component."""
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up HomeKey Manager from a config entry."""
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or {"keys": [], "settings": {}}
    if "settings" not in data:
        data["settings"] = {}
    hass.data[DOMAIN] = {"store": store, "data": data}

    integration_path = os.path.dirname(__file__)

    await hass.http.async_register_static_paths([
        StaticPathConfig(
            f"/{DOMAIN}/frontend",
            os.path.join(integration_path, "www"),
            False,
        ),
        StaticPathConfig(
            f"/brands/{DOMAIN}",
            os.path.join(integration_path, "brand"),
            True,
        ),
    ])

    manifest_path = os.path.join(integration_path, "manifest.json")
    with open(manifest_path) as f:
        manifest_version = json.load(f).get("version", "0")

    # Remove panel first if it already exists (e.g. after failed unload)
    try:
        async_remove_panel(hass, PANEL_FRONTEND_PATH)
    except Exception:
        pass

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="homekey-panel",
        frontend_url_path=PANEL_FRONTEND_PATH,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"/{DOMAIN}/frontend/homekey-panel.js?v={manifest_version}",
        config={"version": manifest_version},
    )

    hass.http.register_view(HomekeyKeysListView(hass))
    hass.http.register_view(HomekeyKeyDetailView(hass))
    hass.http.register_view(HomekeySettingsView(hass))

    _LOGGER.info("HomeKey Manager v%s loaded", manifest_version)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload HomeKey Manager config entry."""
    try:
        async_remove_panel(hass, PANEL_FRONTEND_PATH)
    except Exception:
        _LOGGER.warning("Could not remove panel during unload")
    hass.data.pop(DOMAIN, None)
    return True


async def _save(hass):
    """Persist data to storage."""
    store = hass.data[DOMAIN]["store"]
    await store.async_save(hass.data[DOMAIN]["data"])


class HomekeySettingsView(HomeAssistantView):
    """Handle GET/PUT /api/homekey_manager/settings."""

    url = f"/api/{DOMAIN}/settings"
    name = f"api:{DOMAIN}:settings"
    requires_auth = True

    def __init__(self, hass):
        self._hass = hass

    async def get(self, request):
        data = self._hass.data[DOMAIN]["data"]
        settings = {**DEFAULT_SETTINGS, **data.get("settings", {})}
        return self.json(settings)

    async def put(self, request):
        body = await request.json()
        data = self._hass.data[DOMAIN]["data"]
        settings = data.get("settings", {})
        for key in DEFAULT_SETTINGS:
            if key in body and body[key]:
                settings[key] = body[key]
        data["settings"] = settings
        await _save(self._hass)
        return self.json({**DEFAULT_SETTINGS, **settings})


class HomekeyKeysListView(HomeAssistantView):
    """Handle GET/POST /api/homekey_manager/keys."""

    url = f"/api/{DOMAIN}/keys"
    name = f"api:{DOMAIN}:keys"
    requires_auth = True

    def __init__(self, hass):
        self._hass = hass

    async def get(self, request):
        data = self._hass.data[DOMAIN]["data"]
        return self.json(data.get("keys", []))

    async def post(self, request):
        body = await request.json()
        data = self._hass.data[DOMAIN]["data"]
        keys = data.get("keys", [])

        existing = next(
            (k for k in keys if k["issuer"] == body.get("issuer")), None
        )
        if existing:
            existing["lastSeen"] = body.get("lastSeen", existing.get("lastSeen"))
            existing["scanCount"] = existing.get("scanCount", 0) + 1
            existing["active"] = True
            if body.get("endpoint"):
                existing["endpoint"] = body["endpoint"]
        else:
            keys.append(body)

        data["keys"] = keys
        await _save(self._hass)
        return self.json({"ok": True})


class HomekeyKeyDetailView(HomeAssistantView):
    """Handle PUT/DELETE /api/homekey_manager/keys/{issuer}."""

    url = f"/api/{DOMAIN}/keys/{{issuer}}"
    name = f"api:{DOMAIN}:key_detail"
    requires_auth = True

    def __init__(self, hass):
        self._hass = hass

    async def put(self, request, issuer):
        body = await request.json()
        data = self._hass.data[DOMAIN]["data"]
        keys = data.get("keys", [])

        key = next((k for k in keys if k["issuer"] == issuer), None)
        if not key:
            return self.json_message("Not found", status_code=404)

        key.update(body)
        await _save(self._hass)
        return self.json({"ok": True})

    async def delete(self, request, issuer):
        data = self._hass.data[DOMAIN]["data"]
        data["keys"] = [k for k in data.get("keys", []) if k["issuer"] != issuer]
        await _save(self._hass)
        return self.json({"ok": True})
