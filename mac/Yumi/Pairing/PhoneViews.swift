import SwiftUI

/// The phone's connection state and the pairing entry in the menu bar menu (OBJ-27.6, SPEC-08 r10).
struct PhoneMenuItems: View {
    let phone: PhoneLink

    var body: some View {
        // A plain Text is shown as a disabled menu item: information, not an action.
        Text(Self.statusLine(connection: phone.connection, device: phone.pairedDevice))
        if phone.pairedDevice == nil {
            Button("Pair your phone…") { PairingWindow.show(phone: phone) }
        }
    }

    static func statusLine(connection: PhoneLink.Connection?, device: PhoneLink.Device?) -> String {
        guard let device else { return "Not paired" }
        switch connection {
        case .connected: return "\(device.name): connected"
        case .reconnecting: return "\(device.name): reconnecting…"
        case .offline, nil: return "\(device.name): offline"
        }
    }
}

/// "Unpair" in the settings window (OBJ-27.5, SPEC-08 r9).
struct PhoneSettingsSection: View {
    let phone: PhoneLink

    var body: some View {
        Section("Phone") {
            if let device = phone.pairedDevice {
                LabeledContent("Paired with \(device.name)") {
                    Button("Unpair") { phone.unpair(device) }
                }
            } else {
                LabeledContent("Not paired") {
                    Button("Pair your phone…") { PairingWindow.show(phone: phone) }
                }
            }
        }
        .onAppear { phone.refreshDevices() }
    }
}
