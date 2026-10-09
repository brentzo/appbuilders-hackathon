import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

/// The pairing screen (OBJ-27.5, SPEC-08 r1): a QR code the phone scans, then "Paired with
/// <device name>".
struct PairingView: View {
    let phone: PhoneLink
    let close: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            if let device = phone.pairedDevice {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.green)
                    .accessibilityHidden(true)
                Text("Paired with \(device.name)")
                    .font(.title3.weight(.semibold))
                Button("Done", action: close)
                    .keyboardShortcut(.defaultAction)
            } else if let code = phone.pairingCode {
                Text("Scan this code with Yumi on your phone")
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                QRCodeImage(payload: code.payload)
                    .frame(width: 220, height: 220)
                    .padding(12)
                    .background(.white, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Pairing code")
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if context.date < code.expiresAt {
                        Text("The code works for \(Self.remaining(until: code.expiresAt, from: context.date)).")
                            .foregroundStyle(.secondary)
                    } else {
                        Text("This code expired.")
                            .foregroundStyle(.secondary)
                    }
                }
                HStack {
                    Button("Cancel") {
                        phone.cancelPairing()
                        close()
                    }
                    .keyboardShortcut(.cancelAction)
                    Button("New code") { phone.startPairing() }
                }
            } else {
                ProgressView()
                    .controlSize(.large)
                Text("Getting a pairing code…")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(28)
        .frame(width: 360)
        .fixedSize(horizontal: false, vertical: true)
        .task {
            if phone.pairedDevice == nil, phone.pairingCode == nil { phone.startPairing() }
            // The harness reports a new pairing through bridgeStateChanged; this also notices it
            // if that event is missed.
            while !Task.isCancelled, phone.pairedDevice == nil {
                try? await Task.sleep(for: .seconds(2))
                phone.refreshDevices()
            }
        }
    }

    static func remaining(until end: Date, from now: Date) -> String {
        let seconds = max(0, Int(end.timeIntervalSince(now).rounded()))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// A sharp QR code: generated at module size 1, then drawn without smoothing.
private struct QRCodeImage: View {
    let payload: String

    var body: some View {
        if let image = Self.render(payload) {
            Image(nsImage: image)
                .interpolation(.none)
                .resizable()
                .aspectRatio(contentMode: .fit)
        } else {
            Image(systemName: "qrcode")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .foregroundStyle(.black)
        }
    }

    static func render(_ payload: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage,
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return NSImage(cgImage: cgImage, size: output.extent.size)
    }
}

/// Opens the pairing window, one at a time.
@MainActor
enum PairingWindow {
    private static var window: NSWindow?

    static func show(phone: PhoneLink = .shared) {
        if let window {
            NSApp.activate()
            window.makeKeyAndOrderFront(nil)
            return
        }
        let created = NSWindow(contentViewController: NSHostingController(rootView: PairingView(phone: phone) {
            PairingWindow.window?.close()
        }))
        created.title = "Pair your phone"
        created.styleMask = [.titled, .closable]
        created.isReleasedWhenClosed = false
        created.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: created, queue: .main) { _ in
            MainActor.assumeIsolated {
                if phone.pairedDevice == nil { phone.cancelPairing() }
                PairingWindow.window = nil
            }
        }
        window = created
        NSApp.activate()
        created.makeKeyAndOrderFront(nil)
    }
}
