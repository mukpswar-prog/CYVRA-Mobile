package cyvra.mobile.host.transport

/**
 * Orchestrates connection diagnostics and transitions according to §14 and §15 of the freeze guide:
 * NO_DEVICE -> USB_DETECTED -> ADB_DETECTED -> ADB_UNAUTHORIZED / ADB_AUTHORIZED -> ADB_READY
 */
data class ConnectionDiagnosticSnapshot(
    val connectionState: DeviceConnectionState,
    val usbState: HostUsbState,
    val adbState: HostAdbState,
    val adbAvailable: Boolean,
    val deviceDescriptor: AdbDeviceDescriptor? = null,
    val statusMessage: String,
    val operatorActionRequired: String? = null,
    val readyToScan: Boolean = false,
)

class ConnectionStateMachine {
    fun evaluate(
        usbConnected: Boolean,
        adbClientAvailable: Boolean,
        discoveredDevices: List<AdbDeviceDescriptor>,
    ): ConnectionDiagnosticSnapshot {
        if (!usbConnected && discoveredDevices.isEmpty()) {
            return ConnectionDiagnosticSnapshot(
                connectionState = DeviceConnectionState.NO_DEVICE,
                usbState = HostUsbState.USB_NOT_CONNECTED,
                adbState = HostAdbState.ADB_UNAVAILABLE,
                adbAvailable = adbClientAvailable,
                deviceDescriptor = null,
                statusMessage = "No device connected. Connect Android device via USB.",
                operatorActionRequired = "Connect Android device with a data-capable USB cable.",
                readyToScan = false,
            )
        }

        if (usbConnected && (!adbClientAvailable || discoveredDevices.isEmpty())) {
            return ConnectionDiagnosticSnapshot(
                connectionState = DeviceConnectionState.USB_DETECTED,
                usbState = HostUsbState.USB_CONNECTED,
                adbState = HostAdbState.ADB_UNAVAILABLE,
                adbAvailable = adbClientAvailable,
                deviceDescriptor = null,
                statusMessage = "USB connection detected. ADB interface not visible.",
                operatorActionRequired = "Enable USB Debugging on the Android device in Developer Options.",
                readyToScan = false,
            )
        }

        val primaryDevice = discoveredDevices.first()

        return when (primaryDevice.state.lowercase()) {
            "unauthorized" -> {
                ConnectionDiagnosticSnapshot(
                    connectionState = DeviceConnectionState.ADB_UNAUTHORIZED,
                    usbState = HostUsbState.USB_CONNECTED,
                    adbState = HostAdbState.ADB_UNAUTHORIZED,
                    adbAvailable = true,
                    deviceDescriptor = primaryDevice,
                    statusMessage = "Device detected via ADB, but computer is unauthorized.",
                    operatorActionRequired = "Unlock the Android device and accept the 'Allow USB debugging' prompt.",
                    readyToScan = false,
                )
            }
            "offline" -> {
                ConnectionDiagnosticSnapshot(
                    connectionState = DeviceConnectionState.DEVICE_RECONNECTING,
                    usbState = HostUsbState.USB_CONNECTED,
                    adbState = HostAdbState.ADB_OFFLINE,
                    adbAvailable = true,
                    deviceDescriptor = primaryDevice,
                    statusMessage = "Device is offline or reconnecting.",
                    operatorActionRequired = "Check USB cable connection or re-plug the cable.",
                    readyToScan = false,
                )
            }
            "device" -> {
                ConnectionDiagnosticSnapshot(
                    connectionState = DeviceConnectionState.ADB_READY,
                    usbState = HostUsbState.USB_CONNECTED,
                    adbState = HostAdbState.ADB_READY,
                    adbAvailable = true,
                    deviceDescriptor = primaryDevice,
                    statusMessage = "Device connected and authorized via ADB.",
                    operatorActionRequired = null,
                    readyToScan = true,
                )
            }
            else -> {
                ConnectionDiagnosticSnapshot(
                    connectionState = DeviceConnectionState.ADB_DETECTED,
                    usbState = HostUsbState.USB_CONNECTED,
                    adbState = HostAdbState.ADB_UNAVAILABLE,
                    adbAvailable = true,
                    deviceDescriptor = primaryDevice,
                    statusMessage = "Device detected in state '${primaryDevice.state}'.",
                    operatorActionRequired = "Verify Android device state.",
                    readyToScan = false,
                )
            }
        }
    }
}
