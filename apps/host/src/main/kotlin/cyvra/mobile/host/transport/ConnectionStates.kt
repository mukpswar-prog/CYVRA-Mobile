package cyvra.mobile.host.transport

import kotlinx.serialization.Serializable

/**
 * Host-internal physical USB connection state.
 */
@Serializable
enum class HostUsbState {
    USB_NOT_CONNECTED,
    USB_CONNECTED,
}

/**
 * Host-internal ADB communication state.
 * ADB visible is NOT ADB authorized.
 */
@Serializable
enum class HostAdbState {
    ADB_UNAVAILABLE,
    ADB_UNAUTHORIZED,
    ADB_OFFLINE,
    ADB_READY,
    DEVICE_RECONNECTING,
}

/**
 * Overall orchestrated connection state following §14 of the freeze guide:
 * NO_DEVICE -> USB_DETECTED -> ADB_DETECTED -> ADB_UNAUTHORIZED / ADB_AUTHORIZED -> ADB_READY
 */
@Serializable
enum class DeviceConnectionState {
    NO_DEVICE,
    USB_DETECTED,
    ADB_DETECTED,
    ADB_UNAUTHORIZED,
    ADB_AUTHORIZED,
    ADB_READY,
    SCANNING,
    SCAN_COMPLETE,
    DEVICE_DISCONNECTED,
    DEVICE_RECONNECTING,
}

/**
 * Maps host-internal USB and ADB states to frozen G4 vocabulary.
 * Does not widen Worker validation until the API freeze lifts.
 */
object G4IngestStateMapper {
    fun toG4UsbState(usb: HostUsbState, adb: HostAdbState): String {
        return when (usb) {
            HostUsbState.USB_NOT_CONNECTED -> "USB_DISCONNECTED"
            HostUsbState.USB_CONNECTED -> {
                when (adb) {
                    HostAdbState.ADB_READY -> "USB_CONNECTED_DATA"
                    HostAdbState.ADB_UNAUTHORIZED -> "USB_CONNECTED_DATA"
                    HostAdbState.ADB_OFFLINE -> "USB_CONNECTED_DATA"
                    HostAdbState.ADB_UNAVAILABLE -> "USB_CONNECTED_CHARGING"
                    HostAdbState.DEVICE_RECONNECTING -> "USB_CONNECTED_DATA"
                }
            }
        }
    }

    fun toG4AdbState(adb: HostAdbState): String {
        return when (adb) {
            HostAdbState.ADB_UNAVAILABLE -> "ADB_DISABLED"
            HostAdbState.ADB_UNAUTHORIZED -> "ADB_VISIBLE_UNAUTHORIZED"
            HostAdbState.ADB_OFFLINE -> "ADB_UNKNOWN"
            HostAdbState.ADB_READY -> "ADB_AUTHORIZED"
            HostAdbState.DEVICE_RECONNECTING -> "ADB_UNKNOWN"
        }
    }
}
